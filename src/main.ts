// Birthday Capsule — entry. Orchestrates cake/face/blow/capsule.

import { Cake } from "./cake";
import {
  detectAndMatch,
  initFaceApi,
  loadReferenceEmbedding,
  type FaceMatchResult,
} from "./face";
import { createBlowDetector, type BlowDetector } from "./blow";
import {
  fetchPriorCapsules,
  submitCapsule,
  type CapsuleData,
} from "./capsule";

// --- config ---
const BIRTHDAY_MONTH = 5; // May
const BIRTHDAY_DAY = 20;
const AGE_BEFORE = "38"; // age shown before blowing (the year you're leaving)
const AGE_AFTER = "39"; // age that appears after blowing (your new age)
const REPO = "Jada-Q/birthday-capsule";
const MATCH_THRESHOLD = 0.5; // lenient — single user, controlled lighting
const MAX_AUDIO_SECONDS = 30;

// --- url params ---
const params = new URLSearchParams(location.search);
const FORCE_BIRTHDAY = params.has("dev"); // ?dev=1 → treat any day as birthday
const DEBUG = params.has("debug"); // ?debug=1 → show face/mic metrics overlay
const FAKE_YEAR = params.get("year"); // ?year=2027 → simulate future year

// --- DOM ---
const stage = document.getElementById("stage") as HTMLCanvasElement;
const ui = document.getElementById("ui") as HTMLDivElement;
const footer = document.getElementById("footer") as HTMLElement;

// --- helpers ---
function todayParts(): { year: number; month: number; day: number } {
  const d = new Date();
  return {
    year: FAKE_YEAR ? Number(FAKE_YEAR) : d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
  };
}

function isBirthdayToday(): boolean {
  if (FORCE_BIRTHDAY) return true;
  const { month, day } = todayParts();
  return month === BIRTHDAY_MONTH && day === BIRTHDAY_DAY;
}

function setUI(html: string): void {
  ui.innerHTML = html;
}

function setFooter(text: string): void {
  footer.textContent = text;
}

function showModal(html: string): HTMLDivElement {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `<div class="modal-content">${html}</div>`;
  document.body.appendChild(modal);
  return modal;
}

// --- cake setup (shared by both modes) ---
const cake = new Cake(stage, {
  candleCount: 1,
  size: 640,
  numberLabel: AGE_BEFORE,
  numberLabelAfter: AGE_AFTER,
});

// ?test=blow → simulate a blow 2s after load for visual testing
if (params.get("test") === "blow") {
  setTimeout(() => cake.blowOut(), 2000);
}
let rafHandle = 0;
function startRenderLoop() {
  const loop = (t: number) => {
    cake.render(t);
    rafHandle = requestAnimationFrame(loop);
  };
  rafHandle = requestAnimationFrame(loop);
}
function stopRenderLoop() {
  cancelAnimationFrame(rafHandle);
}

// --- DAILY MODE ---
function runDailyMode() {
  startRenderLoop();
  setFooter("只在 5/20 听吹气");
  setUI("");
}

// --- BIRTHDAY MODE ---
async function runBirthdayMode() {
  startRenderLoop();
  setFooter("happy birthday");

  setUI(`
    <button id="start-btn">今天是你的生日 — 开启摄像头</button>
    <div style="font-size:11px;color:var(--dim);margin-top:8px">将请求摄像头 + 麦克风权限</div>
  `);

  const btn = document.getElementById("start-btn") as HTMLButtonElement;
  btn.addEventListener("click", () => {
    btn.disabled = true;
    void enterFaceMatchPhase();
  });
}

async function enterFaceMatchPhase() {
  setUI(`<div>开机中…</div>`);

  // 1. start camera
  const video = document.getElementById("cam") as HTMLVideoElement;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    setUI(`<div style="color:var(--accent)">摄像头权限被拒。刷新重试。</div>`);
    return;
  }

  // 2. load face-api + reference embedding
  setUI(`<div>加载 face 模型…</div>`);
  await initFaceApi("/models");
  let refEmbedding: Float32Array;
  try {
    refEmbedding = await loadReferenceEmbedding("/embedding.json");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setUI(`<div style="color:var(--accent)">embedding 加载失败：${msg}<br/>
      访问 <a href="/setup.html" style="color:var(--warm)">/setup.html</a> 生成 embedding.json，放到 public/。</div>`);
    return;
  }

  // 3. start match loop until we confirm it's Jada (3 consecutive matches)
  setUI(`<div>识别中… 看镜头</div>`);
  let consecutiveMatches = 0;
  let consecutiveMisses = 0;
  let lastResult: FaceMatchResult | null = null;

  await new Promise<void>((resolve, reject) => {
    const checkInterval = window.setInterval(async () => {
      try {
        const res = await detectAndMatch(video, refEmbedding, MATCH_THRESHOLD);
        lastResult = res;
        if (DEBUG) {
          const litStr = `${cake.litCount} lit lit`;
          setFooter(
            `detected=${res.detected} matched=${res.matched} dist=${res.distance.toFixed(3)} · ${litStr}`,
          );
        }
        if (res.matched) {
          consecutiveMatches++;
          consecutiveMisses = 0;
          if (consecutiveMatches >= 3) {
            clearInterval(checkInterval);
            resolve();
          }
        } else if (res.detected && !res.matched) {
          consecutiveMisses++;
          consecutiveMatches = 0;
          if (consecutiveMisses >= 5) {
            clearInterval(checkInterval);
            reject(new Error("not-jada"));
          }
        }
      } catch (e) {
        // ignore transient errors
      }
    }, 400);
  }).catch((e) => {
    if (e.message === "not-jada") {
      setUI(`<div style="color:var(--accent)">今天不是你的生日</div>`);
      stopAllStreams(stream);
      setTimeout(() => runDailyMode(), 5000);
      return Promise.reject(e);
    }
    return Promise.reject(e);
  });

  // 4. show prior capsules if any
  await showPriorCapsulesIfAny();

  // 5. enter blow phase
  await enterBlowPhase(video, refEmbedding, stream);
}

async function showPriorCapsulesIfAny() {
  let priors: CapsuleData[] = [];
  try {
    priors = await fetchPriorCapsules({ repo: REPO });
  } catch {
    // network issue — silently skip
  }
  const currentYear = todayParts().year;
  const earlier = priors.filter((c) => c.year < currentYear);
  if (earlier.length === 0) return;

  // simple slideshow modal — one capsule at a time, "下一封" button
  let idx = 0;
  return new Promise<void>((resolve) => {
    const render = () => {
      const c = earlier[idx]!;
      const audioTag = c.audioDataUrl
        ? `<audio controls src="${c.audioDataUrl}" style="width:100%;margin-top:12px"></audio>`
        : "";
      const isLast = idx >= earlier.length - 1;
      modal.querySelector(".modal-content")!.innerHTML = `
        <div class="prompt-label">${c.year} 年的你说</div>
        <div class="prompt-block"><div class="prompt-label">最骄傲</div><div>${escapeHtml(c.q1)}</div></div>
        <div class="prompt-block"><div class="prompt-label">warning</div><div>${escapeHtml(c.q2)}</div></div>
        <div class="prompt-block"><div class="prompt-label">wish</div><div>${escapeHtml(c.q3)}</div></div>
        ${audioTag}
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:24px">
          <span style="color:var(--dim);font-size:11px">${idx + 1} / ${earlier.length}</span>
          <button id="next-btn">${isLast ? "开蛋糕 →" : "下一封 →"}</button>
        </div>
      `;
      modal.querySelector("#next-btn")!.addEventListener("click", () => {
        if (isLast) {
          modal.remove();
          resolve();
        } else {
          idx++;
          render();
        }
      });
    };
    const modal = showModal("");
    render();
  });
}

async function enterBlowPhase(
  video: HTMLVideoElement,
  refEmbedding: Float32Array,
  stream: MediaStream,
) {
  setUI(`<div style="color:var(--warm)">吹蜡烛</div>`);

  const blow: BlowDetector = createBlowDetector({
    micThreshold: 0.12,
    cooldownMs: 350,
    requireFaceMouth: true,
  });

  try {
    await blow.start();
  } catch (e) {
    setUI(`<div style="color:var(--accent)">麦克风权限被拒。刷新重试。</div>`);
    return;
  }

  let priorAllOut = false;
  const onBlowEvent = () => {
    cake.blowOut();
  };
  blow.onBlow(onBlowEvent);

  // per-frame: feed landmarks to blow detector, check allOut
  const tick = async () => {
    if (cake.allOut && !priorAllOut) {
      priorAllOut = true;
      blow.stop();
      stopAllStreams(stream);
      void enterCapsulePhase();
      return;
    }
    try {
      const res = await detectAndMatch(video, refEmbedding, MATCH_THRESHOLD);
      blow.updateFaceLandmarks(res.landmarks);
      if (DEBUG) {
        const dbg = blow.getDebugState();
        setFooter(
          `mic=${dbg.micEnergy.toFixed(3)} pucker=${dbg.puckered} open=${dbg.mouthOpen} · ${cake.litCount} lit`,
        );
      } else {
        setFooter(cake.litCount > 0 ? "吹" : "");
      }
    } catch {
      // ignore
    }
    setTimeout(tick, 100);
  };
  void tick();

  // also expose manual click fallback in case blow detection misses
  stage.style.cursor = "pointer";
  stage.addEventListener("click", () => {
    if (!cake.allOut) cake.blowOut();
  });
}

async function enterCapsulePhase() {
  setUI("");
  setFooter("");
  stage.style.cursor = "default";

  const year = todayParts().year;
  const modal = showModal(`
    <div class="prompt-label">给明年的你</div>
    <div class="prompt-block">
      <div class="prompt-label">Q1 · 这一年最骄傲的 1 件事</div>
      <textarea id="q1" placeholder="…"></textarea>
    </div>
    <div class="prompt-block">
      <div class="prompt-label">Q2 · 给明年的你 1 个 warning</div>
      <textarea id="q2" placeholder="…"></textarea>
    </div>
    <div class="prompt-block">
      <div class="prompt-label">Q3 · 给明年的你 1 个 wish</div>
      <textarea id="q3" placeholder="…"></textarea>
    </div>
    <div class="prompt-block">
      <div class="prompt-label">30s 录音（可选）</div>
      <div style="display:flex;gap:8px;align-items:center">
        <button id="rec-btn">● 录制</button>
        <span id="rec-status" style="color:var(--dim);font-size:11px">未录</span>
      </div>
      <audio id="rec-playback" controls style="display:none;width:100%;margin-top:8px"></audio>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px">
      <span id="status" style="font-size:11px;color:var(--dim)"></span>
      <button id="submit-btn">封存</button>
    </div>
  `);

  let audioDataUrl = "";
  setupRecorder(modal, (url) => {
    audioDataUrl = url;
  });

  const submitBtn = modal.querySelector("#submit-btn") as HTMLButtonElement;
  const statusEl = modal.querySelector("#status") as HTMLSpanElement;

  submitBtn.addEventListener("click", async () => {
    const q1 = (modal.querySelector("#q1") as HTMLTextAreaElement).value.trim();
    const q2 = (modal.querySelector("#q2") as HTMLTextAreaElement).value.trim();
    const q3 = (modal.querySelector("#q3") as HTMLTextAreaElement).value.trim();
    if (!q1 && !q2 && !q3) {
      statusEl.textContent = "至少写一个吧";
      statusEl.style.color = "var(--accent)";
      return;
    }
    submitBtn.disabled = true;
    statusEl.style.color = "var(--dim)";
    statusEl.textContent = "封存中…";

    try {
      const url = await submitCapsule({ year, q1, q2, q3, audioDataUrl });
      modal.querySelector(".modal-content")!.innerHTML = `
        <div style="text-align:center">
          <div style="font-size:48px;margin-bottom:16px">🔒</div>
          <div class="prompt-label">封存。明年 5/20 再来。</div>
          <a href="${url}" target="_blank" style="color:var(--dim);font-size:11px;display:block;margin-top:16px">
            issue: ${url.replace("https://github.com/", "")}
          </a>
        </div>
      `;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      statusEl.textContent = `失败：${msg}`;
      statusEl.style.color = "var(--accent)";
      submitBtn.disabled = false;
    }
  });
}

function setupRecorder(
  modal: HTMLDivElement,
  onComplete: (dataUrl: string) => void,
) {
  const recBtn = modal.querySelector("#rec-btn") as HTMLButtonElement;
  const recStatus = modal.querySelector("#rec-status") as HTMLSpanElement;
  const playback = modal.querySelector("#rec-playback") as HTMLAudioElement;
  let mediaRecorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];
  let stream: MediaStream | null = null;
  let stopTimer = 0;

  recBtn.addEventListener("click", async () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      window.clearTimeout(stopTimer);
      mediaRecorder.stop();
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      recStatus.textContent = "麦克风权限被拒";
      return;
    }
    const opts: MediaRecorderOptions = MediaRecorder.isTypeSupported(
      "audio/webm;codecs=opus",
    )
      ? { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 24000 }
      : {};
    mediaRecorder = new MediaRecorder(stream, opts);
    chunks = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.onstop = async () => {
      stream?.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: mediaRecorder?.mimeType ?? "audio/webm" });
      const dataUrl = await blobToDataUrl(blob);
      playback.src = dataUrl;
      playback.style.display = "block";
      const kb = (blob.size / 1024).toFixed(1);
      recStatus.textContent = `已录 · ${kb} KB`;
      recBtn.textContent = "● 重录";
      onComplete(dataUrl);
    };
    mediaRecorder.start();
    recBtn.textContent = "■ 停";
    recStatus.textContent = "录制中…";
    stopTimer = window.setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === "recording")
        mediaRecorder.stop();
    }, MAX_AUDIO_SECONDS * 1000);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

function stopAllStreams(stream: MediaStream) {
  stream.getTracks().forEach((t) => t.stop());
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}

// --- boot ---
if (isBirthdayToday()) {
  void runBirthdayMode();
} else {
  runDailyMode();
}
