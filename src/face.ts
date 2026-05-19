// Face detection + embedding match wrapper around @vladmandic/face-api.
// Browser only. Models served from /models (public/models/).

import * as faceapi from "@vladmandic/face-api";

export interface FaceMatchResult {
  detected: boolean;
  matched: boolean;
  distance: number;
  /** Raw face-api landmarks (FaceLandmarks68) if detected, else null. Typed any per contract. */
  landmarks: any | null;
}

const DEFAULT_MODELS_PATH = "/models";
const DEFAULT_EMBEDDING_PATH = "/embedding.json";
const DEFAULT_MATCH_THRESHOLD = 0.4;

let modelsReady = false;
let modelsLoading: Promise<void> | null = null;

// Cache detector options once. SSD MobileNet v1 — stable over tinyFaceDetector per contract.
let detectorOptions: faceapi.SsdMobilenetv1Options | null = null;

function getDetectorOptions(): faceapi.SsdMobilenetv1Options {
  if (!detectorOptions) {
    detectorOptions = new faceapi.SsdMobilenetv1Options({
      minConfidence: 0.5,
      maxResults: 1,
    });
  }
  return detectorOptions;
}

/**
 * Load face-api models. Idempotent — safe to call multiple times.
 * Concurrent callers share the same in-flight load promise.
 */
export async function initFaceApi(modelsPath: string = DEFAULT_MODELS_PATH): Promise<void> {
  if (modelsReady) return;
  if (modelsLoading) return modelsLoading;

  modelsLoading = (async () => {
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(modelsPath),
      faceapi.nets.faceLandmark68Net.loadFromUri(modelsPath),
      faceapi.nets.faceRecognitionNet.loadFromUri(modelsPath),
    ]);
    modelsReady = true;
  })();

  try {
    await modelsLoading;
  } finally {
    modelsLoading = null;
  }
}

/**
 * Load the reference 128-dim embedding produced by setup.ts.
 * Throws on fetch failure or schema mismatch.
 */
export async function loadReferenceEmbedding(
  jsonPath: string = DEFAULT_EMBEDDING_PATH,
): Promise<Float32Array> {
  const res = await fetch(jsonPath);
  if (!res.ok) {
    throw new Error(`failed to load embedding from ${jsonPath}: ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as {
    version?: number;
    dim?: number;
    embedding?: number[];
  };

  if (!json || !Array.isArray(json.embedding)) {
    throw new Error("embedding.json missing 'embedding' array");
  }
  if (json.dim !== undefined && json.dim !== json.embedding.length) {
    throw new Error(
      `embedding.json dim mismatch: declared ${json.dim}, actual ${json.embedding.length}`,
    );
  }
  if (json.embedding.length !== 128) {
    throw new Error(
      `embedding.json wrong dimensionality: expected 128, got ${json.embedding.length}`,
    );
  }

  return Float32Array.from(json.embedding);
}

/**
 * Run a single detection + match pass on the current video frame.
 * Resolves with detected:false (never throws) when no face is in frame.
 */
export async function detectAndMatch(
  video: HTMLVideoElement,
  refEmbedding: Float32Array,
  matchThreshold: number = DEFAULT_MATCH_THRESHOLD,
): Promise<FaceMatchResult> {
  const detection = await faceapi
    .detectSingleFace(video, getDetectorOptions())
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    return {
      detected: false,
      matched: false,
      distance: 1,
      landmarks: null,
    };
  }

  // detection.descriptor is Float32Array from face-api; euclideanDistance accepts
  // ArrayLike<number>, so both Float32Array operands work directly.
  const distance = faceapi.euclideanDistance(detection.descriptor, refEmbedding);

  return {
    detected: true,
    matched: distance < matchThreshold,
    distance,
    landmarks: detection.landmarks,
  };
}
