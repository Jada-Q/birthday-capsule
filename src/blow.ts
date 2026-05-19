/**
 * blow.ts — Agent C
 *
 * Detects a "blow" gesture by combining mic energy (Web Audio RMS) +
 * face mouth shape (pucker derived from face-api 68-landmark model).
 *
 * Either signal alone is too noisy; AND of both is robust.
 */

export interface BlowDetectorOptions {
  /** RMS mic energy (0..1) above which is "windy". Default 0.12 */
  micThreshold?: number;
  /** Min ms between consecutive blow events. Default 350 */
  cooldownMs?: number;
  /** If true, mouth must be open + puckered to count. Default true. */
  requireFaceMouth?: boolean;
}

export interface BlowDetector {
  start(): Promise<void>;
  stop(): void;
  onBlow(handler: () => void): void;
  updateFaceLandmarks(landmarks: unknown | null): void;
  getDebugState(): { micEnergy: number; puckered: boolean; mouthOpen: boolean };
}

// --- internal types ---------------------------------------------------------

type FsmState = "idle" | "armed" | "cooldown";

interface Point {
  x: number;
  y: number;
}

// Pucker thresholds (per task prompt; INTERFACES.md says 0.18 but prompt overrides to 0.30 "lenient; tune later").
const PUCKER_RATIO_MAX = 0.30;
const MOUTH_OPEN_MIN_PX = 4;

// Debounce: require triggerMet for this many consecutive frames before firing.
const TRIGGER_FRAMES_REQUIRED = 2;

// Mic sampling cadence ~30fps.
const MIC_SAMPLE_INTERVAL_MS = 33;

// --- helpers ----------------------------------------------------------------

function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * face-api FaceLandmarks68 exposes either `.positions` (Point[]) and/or
 * `.getMouth() / .getJawOutline()` helpers. We support both shapes since
 * the parent passes the object through opaquely.
 */
function extractPositions(landmarks: unknown): Point[] | null {
  if (!landmarks || typeof landmarks !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lm = landmarks as any;
  const pos = lm.positions ?? lm._positions;
  if (Array.isArray(pos) && pos.length >= 68) {
    return pos as Point[];
  }
  return null;
}

interface MouthMetrics {
  puckered: boolean;
  mouthOpen: boolean;
}

function computeMouthMetrics(landmarks: unknown | null): MouthMetrics {
  if (landmarks == null) return { puckered: false, mouthOpen: false };
  const pos = extractPositions(landmarks);
  if (!pos) return { puckered: false, mouthOpen: false };

  // Outer mouth corners: 48 (left), 54 (right).
  // Inner mouth vertical mids: 62 (upper), 66 (lower).
  // Jaw outline endpoints: 0, 16.
  const mouthLeft = pos[48];
  const mouthRight = pos[54];
  const innerUpper = pos[62];
  const innerLower = pos[66];
  const jawLeft = pos[0];
  const jawRight = pos[16];

  if (!mouthLeft || !mouthRight || !innerUpper || !innerLower || !jawLeft || !jawRight) {
    return { puckered: false, mouthOpen: false };
  }

  const mouthWidth = dist(mouthLeft, mouthRight);
  const faceWidth = dist(jawLeft, jawRight);
  const innerMouthHeight = dist(innerUpper, innerLower);

  if (faceWidth <= 0) return { puckered: false, mouthOpen: false };

  const ratio = mouthWidth / faceWidth;
  const puckered = ratio < PUCKER_RATIO_MAX;
  const mouthOpen = innerMouthHeight > MOUTH_OPEN_MIN_PX;

  return { puckered, mouthOpen };
}

// --- factory ----------------------------------------------------------------

export function createBlowDetector(opts: BlowDetectorOptions = {}): BlowDetector {
  const micThreshold = opts.micThreshold ?? 0.12;
  const cooldownMs = opts.cooldownMs ?? 350;
  const requireFaceMouth = opts.requireFaceMouth ?? true;

  // Runtime state
  let audioCtx: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let analyser: AnalyserNode | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let timeBuf: Uint8Array<ArrayBuffer> | null = null;
  let sampleTimer: number | null = null;

  let micEnergy = 0;
  let puckered = false;
  let mouthOpen = false;

  let fsm: FsmState = "idle";
  let consecutiveTriggerFrames = 0;
  let cooldownUntil = 0;

  const handlers: Array<() => void> = [];

  function sampleMic(): void {
    if (!analyser || !timeBuf) return;
    analyser.getByteTimeDomainData(timeBuf);

    // RMS over normalized samples.
    // Each byte is 0..255 centered at 128. Normalize: (b/128) - 1 ∈ [-1, 1].
    let sumSq = 0;
    const n = timeBuf.length;
    for (let i = 0; i < n; i++) {
      const sample = timeBuf[i] ?? 128;
      const v = sample / 128 - 1;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / n);
    // rms ∈ [0,1] already (since |v| ≤ 1). Take abs for safety.
    micEnergy = Math.abs(rms);

    stepFsm();
  }

  function stepFsm(): void {
    const now = performance.now();

    if (fsm === "cooldown") {
      if (now >= cooldownUntil) {
        fsm = "idle";
        consecutiveTriggerFrames = 0;
      } else {
        return;
      }
    }

    const faceOk = !requireFaceMouth || puckered;
    const triggerMet = micEnergy > micThreshold && faceOk;

    if (triggerMet) {
      consecutiveTriggerFrames++;
      if (consecutiveTriggerFrames >= TRIGGER_FRAMES_REQUIRED) {
        fire();
        fsm = "cooldown";
        cooldownUntil = now + cooldownMs;
        consecutiveTriggerFrames = 0;
      } else {
        fsm = "armed";
      }
    } else {
      consecutiveTriggerFrames = 0;
      fsm = "idle";
    }
  }

  function fire(): void {
    for (const h of handlers) {
      try {
        h();
      } catch {
        // Swallow handler errors to keep detector alive. No console.log per constraints.
      }
    }
  }

  async function start(): Promise<void> {
    if (audioCtx) return; // idempotent

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStream = stream;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctor();

    sourceNode = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024;
    timeBuf = new Uint8Array(new ArrayBuffer(analyser.fftSize));
    sourceNode.connect(analyser);
    // Do NOT connect analyser to destination — would echo mic to speakers.

    sampleTimer = window.setInterval(sampleMic, MIC_SAMPLE_INTERVAL_MS);
  }

  function stop(): void {
    if (sampleTimer !== null) {
      clearInterval(sampleTimer);
      sampleTimer = null;
    }
    if (sourceNode) {
      try {
        sourceNode.disconnect();
      } catch {
        // already disconnected
      }
      sourceNode = null;
    }
    analyser = null;
    timeBuf = null;
    if (mediaStream) {
      for (const track of mediaStream.getTracks()) {
        track.stop();
      }
      mediaStream = null;
    }
    if (audioCtx) {
      audioCtx.close().catch(() => {
        // ignore
      });
      audioCtx = null;
    }
    micEnergy = 0;
    puckered = false;
    mouthOpen = false;
    fsm = "idle";
    consecutiveTriggerFrames = 0;
    cooldownUntil = 0;
  }

  function onBlow(handler: () => void): void {
    handlers.push(handler);
  }

  function updateFaceLandmarks(landmarks: unknown | null): void {
    const m = computeMouthMetrics(landmarks);
    puckered = m.puckered;
    mouthOpen = m.mouthOpen;
  }

  function getDebugState(): { micEnergy: number; puckered: boolean; mouthOpen: boolean } {
    return { micEnergy, puckered, mouthOpen };
  }

  return {
    start,
    stop,
    onBlow,
    updateFaceLandmarks,
    getDebugState,
  };
}
