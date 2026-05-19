// Setup page — load me.jpg, generate 128-dim embedding, download as embedding.json.
// Run locally only. Not deployed.

import * as faceapi from "@vladmandic/face-api";

const fileInput = document.getElementById("file") as HTMLInputElement;
const previewDiv = document.getElementById("preview") as HTMLDivElement;
const outputPre = document.getElementById("output") as HTMLPreElement;
const downloadBtn = document.getElementById("download") as HTMLButtonElement;

let embeddingJson: string | null = null;

async function init() {
  outputPre.textContent = "loading face-api models...";
  const MODELS = "/models";
  await faceapi.nets.ssdMobilenetv1.loadFromUri(MODELS);
  await faceapi.nets.faceLandmark68Net.loadFromUri(MODELS);
  await faceapi.nets.faceRecognitionNet.loadFromUri(MODELS);
  outputPre.textContent = "models loaded. drop me.jpg →";
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  const url = URL.createObjectURL(file);
  previewDiv.innerHTML = `<img src="${url}" alt="ref" />`;

  outputPre.textContent = "detecting face...";
  const img = await faceapi.fetchImage(url);
  const detection = await faceapi
    .detectSingleFace(img)
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!detection) {
    outputPre.textContent = "ERROR: no face detected. try another photo.";
    return;
  }

  const embedding = Array.from(detection.descriptor);
  embeddingJson = JSON.stringify(
    {
      version: 1,
      generated: new Date().toISOString(),
      model: "@vladmandic/face-api faceRecognitionNet",
      dim: embedding.length,
      embedding,
    },
    null,
    2,
  );

  outputPre.textContent = embeddingJson;
  downloadBtn.disabled = false;
});

downloadBtn.addEventListener("click", () => {
  if (!embeddingJson) return;
  const blob = new Blob([embeddingJson], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "embedding.json";
  a.click();
});

init().catch((e) => {
  outputPre.textContent = `ERROR: ${e.message}`;
});
