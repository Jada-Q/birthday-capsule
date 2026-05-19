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
  const { month, day } = todayParts();
  const daysUntil = daysUntilBirthday();
  let footerText = `come back on may 20 · ${daysUntil} day${daysUntil === 1 ? "" : "s"} to go`;
  if (month === 5 && day === 20) footerText = "today's the day ✦";
  setFooter(footerText);
  setUI("");
}

function daysUntilBirthday(): number {
  const now = new Date();
  const year = now.getFullYear();
  let target = new Date(year, BIRTHDAY_MONTH - 1, BIRTHDAY_DAY);
  if (target.getTime() < now.getTime()) target = new Date(year + 1, BIRTHDAY_MONTH - 1, BIRTHDAY_DAY);
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// --- BIRTHDAY MODE ---
async function runBirthdayMode() {
  startRenderLoop();
  setFooter("happy birthday ✦");

  setUI(`
    <button id="start-btn" class="btn-primary btn-primary--cherry">light it up</button>
    <p class="ui-hint">we'll need your camera + mic for a moment</p>
  `);

  const btn = document.getElementById("start-btn") as HTMLButtonElement;
  btn.addEventListener("click", () => {
    btn.disabled = true;
    void enterFaceMatchPhase();
  });
}

async function enterFaceMatchPhase() {
  setUI(`<div class="ui-status">warming up the lens…</div>`);

  // 1. start camera
  const video = document.getElementById("cam") as HTMLVideoElement;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    await video.play();
  } catch (e) {
    setUI(`<div class="ui-error">camera blocked — refresh and allow access</div>`);
    return;
  }

  // 2. load face-api + reference embedding
  setUI(`<div class="ui-status">loading the eyes that know you…</div>`);
  await initFaceApi("/models");
  let refEmbedding: Float32Array;
  try {
    refEmbedding = await loadReferenceEmbedding("/embedding.json");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setUI(`<div class="ui-error">no embedding yet — <a href="/setup.html" style="color:inherit">open setup</a> to generate one<br/><span style="font-size:0.75rem;font-family:var(--font-body);font-weight:normal">(${escapeHtml(msg)})</span></div>`);
    return;
  }

  // 3. start match loop until we confirm it's Jada (3 consecutive matches)
  setUI(`<div class="ui-status">look at me ◡̈</div>`);
  let consecutiveMatches = 0;
  let consecutiveMisses = 0;
  let lastResult: FaceMatchResult | null = null;

  await new Promise<void>((resolve, reject) => {
    const checkInterval = window.setInterval(async () => {
      try {
        const res = await detectAndMatch(video, refEmbedding, MATCH_THRESHOLD);
        lastResult = res;
        if (DEBUG) {
          setFooter(
            `detected=${res.detected} matched=${res.matched} dist=${res.distance.toFixed(3)} · ${cake.litCount} lit`,
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
      setUI(`<div class="ui-error">this cake isn't for you · only the birthday person can light it</div>`);
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

  let idx = 0;
  return new Promise<void>((resolve) => {
    const render = () => {
      const c = earlier[idx]!;
      const audioTag = c.audioDataUrl
        ? `<div class="prior-block"><div class="prompt-label">your voice</div><audio controls src="${c.audioDataUrl}"></audio></div>`
        : "";
      const isLast = idx >= earlier.length - 1;
      modal.querySelector(".modal-content")!.innerHTML = `
        <div class="modal-eyebrow">a letter from past you</div>
        <h2 class="modal-title">${c.year} <em>said</em></h2>
        <div class="prior-block">
          <div class="prompt-label"><span class="prompt-label__num">1</span>proudest of</div>
          <div class="prior-quote">${escapeHtml(c.q1 || "—")}</div>
        </div>
        <div class="prior-block">
          <div class="prompt-label"><span class="prompt-label__num prompt-label__num--2">2</span>a warning</div>
          <div class="prior-quote">${escapeHtml(c.q2 || "—")}</div>
        </div>
        <div class="prior-block">
          <div class="prompt-label"><span class="prompt-label__num prompt-label__num--3">3</span>a wish</div>
          <div class="prior-quote">${escapeHtml(c.q3 || "—")}</div>
        </div>
        ${audioTag}
        <div class="prior-meta">
          <span>${idx + 1} of ${earlier.length}</span>
          <button id="next-btn" class="btn-primary btn-primary--mint">${isLast ? "open the cake →" : "next letter →"}</button>
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
  setUI(`<div class="ui-blow-prompt">blow it out ✦</div>
         <div class="ui-hint">or click the cake if you're shy</div>`);

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
        setFooter(cake.litCount > 0 ? "·   ·   ·" : "✦");
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
  const nextYear = year + 1;
  const modal = showModal(`
    <div class="modal-eyebrow">sealed for ${nextYear}</div>
    <h2 class="modal-title">a letter to <em>next-year you</em></h2>

    <div class="prompt-block">
      <label class="prompt-label" for="q1"><span class="prompt-label__num">1</span>what are you proudest of this year?</label>
      <textarea id="q1" placeholder="the one thing you'd brag about…"></textarea>
    </div>

    <div class="prompt-block">
      <label class="prompt-label" for="q2"><span class="prompt-label__num prompt-label__num--2">2</span>a warning for next-year you</label>
      <textarea id="q2" placeholder="don't fall for this one again…"></textarea>
    </div>

    <div class="prompt-block">
      <label class="prompt-label" for="q3"><span class="prompt-label__num prompt-label__num--3">3</span>a wish you'd put on the cake</label>
      <textarea id="q3" placeholder="if a candle would grant it…"></textarea>
    </div>

    <div class="prompt-block">
      <span class="prompt-label">your voice <span style="font-size:0.85rem;color:var(--ink-faint)">(optional · 30s max)</span></span>
      <div class="recorder-row">
        <button id="rec-btn" class="btn-record"><span class="dot"></span><span class="rec-label">record</span></button>
        <span id="rec-status" class="rec-status">not recorded yet</span>
      </div>
      <audio id="rec-playback" controls style="display:none"></audio>
    </div>

    <div class="modal-footer">
      <span id="status" class="modal-status">tap seal when you're ready · this can't be opened until ${nextYear}-05-20</span>
      <button id="submit-btn" class="btn-primary btn-primary--cherry">seal it ✦</button>
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
      statusEl.textContent = "fill in at least one ↑";
      statusEl.classList.add("is-error");
      return;
    }
    submitBtn.disabled = true;
    statusEl.classList.remove("is-error");
    statusEl.textContent = "sealing…";

    try {
      const url = await submitCapsule({ year, q1, q2, q3, audioDataUrl });
      burstConfetti();
      modal.querySelector(".modal-content")!.innerHTML = `
        <div class="sealed-card">
          <div class="sealed-card__icon">🔒</div>
          <div class="sealed-card__title">sealed.</div>
          <div class="sealed-card__sub">see you on may 20, ${nextYear} ✦</div>
          <a class="sealed-card__link" href="${url}" target="_blank" rel="noopener">
            ${url.replace("https://github.com/", "")}
          </a>
        </div>
      `;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      statusEl.textContent = `couldn't seal: ${msg}`;
      statusEl.classList.add("is-error");
      submitBtn.disabled = false;
    }
  });
}

function burstConfetti(): void {
  const burst = document.createElement("div");
  burst.className = "confetti-burst";
  const colors = ["#c8302a", "#f7d030", "#bee0c4", "#f6c0d0", "#3f86e6"];
  const PIECES = 36;
  for (let i = 0; i < PIECES; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    const dx = (Math.random() - 0.5) * 1200;
    const dy = Math.random() * window.innerHeight * 1.1 + 200;
    const dr = (Math.random() - 0.5) * 1440;
    const color = colors[i % colors.length];
    piece.setAttribute("style",
      `background:${color};` +
      `--dx:${dx}px;--dy:${dy}px;--dr:${dr}deg;` +
      `animation-delay:${(Math.random() * 0.3).toFixed(2)}s;` +
      `border:1.5px solid #1a1410;`
    );
    burst.appendChild(piece);
  }
  document.body.appendChild(burst);
  setTimeout(() => burst.remove(), 2600);
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

  const recLabel = recBtn.querySelector(".rec-label") as HTMLSpanElement;

  recBtn.addEventListener("click", async () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      window.clearTimeout(stopTimer);
      mediaRecorder.stop();
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      recStatus.textContent = "mic blocked";
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
      recStatus.textContent = `recorded · ${kb} KB`;
      recLabel.textContent = "re-record";
      recBtn.classList.remove("recording");
      onComplete(dataUrl);
    };
    mediaRecorder.start();
    recLabel.textContent = "stop";
    recBtn.classList.add("recording");
    recStatus.textContent = "recording…";
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
