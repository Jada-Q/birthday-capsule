// Birthday Capsule — entry (Klein-blue contemporary-art edition).
// Orchestrates the painted cake + face match + blow detection + capsule submit.

import {
  detectAndMatch,
  initFaceApi,
  loadReferenceEmbedding,
} from "./face";
import { createBlowDetector, type BlowDetector } from "./blow";
import {
  fetchPriorCapsules,
  submitCapsule,
  type CapsuleData,
} from "./capsule";
import { createMusic, mountMusicToggle } from "./music";

// --- config ---
const BIRTHDAY_MONTH = 5;
const BIRTHDAY_DAY = 20;
const AGE_BEFORE = "38";
const AGE_AFTER = "39";
const REPO = "Jada-Q/birthday-capsule";
const MATCH_THRESHOLD = 0.5;
const MAX_AUDIO_SECONDS = 30;
const TRANSITION_MS = 1200;

// --- url params ---
const params = new URLSearchParams(location.search);
const FORCE_BIRTHDAY = params.has("dev");
const DEBUG = params.has("debug");
const FAKE_YEAR = params.get("year");
// ?bypass=1 — for E2E smoke tests: skip cam/mic/face-match, tap-to-blow only.
// Production flow is unaffected.
const BYPASS = params.has("bypass");

// --- DOM mounts ---
const cakeMount = document.getElementById("cake-mount") as HTMLDivElement;
const ui = document.getElementById("ui") as HTMLDivElement;
const balloonsLayer = document.getElementById("balloons") as HTMLDivElement;
const footerText = document.getElementById("footer-text") as HTMLSpanElement;
const headerMetaMode = document.getElementById("header-meta-mode") as HTMLDivElement;
const headerMetaSub = document.getElementById("header-meta-sub") as HTMLDivElement;

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

function daysUntilBirthday(): number {
  const now = new Date();
  const year = now.getFullYear();
  let target = new Date(year, BIRTHDAY_MONTH - 1, BIRTHDAY_DAY);
  if (target.getTime() < now.getTime()) {
    target = new Date(year + 1, BIRTHDAY_MONTH - 1, BIRTHDAY_DAY);
  }
  return Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDate(): string {
  const d = new Date();
  const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  return `${months[d.getMonth()]} ${d.getDate()} · ${d.getFullYear()}`;
}

function setUI(html: string): void { ui.innerHTML = html; }

function setHeader(mode: string, sub: string): void {
  headerMetaMode.textContent = mode;
  headerMetaSub.textContent = sub;
}

function setFooter(text: string): void { footerText.textContent = text; }

function showModal(html: string): HTMLDivElement {
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `<div class="modal-content">${html}</div>`;
  document.body.appendChild(modal);
  return modal;
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

// --- CAKE PAINTING (mounted ONCE, then toggle classes; never re-render <img>) ---
let cakeLit = true;
let cakeAge: string = AGE_BEFORE;
let cakeClickHandler: (() => void) | null = null;

// Cake DOM is INLINED in index.html — browser starts img download during HTML
// parse (no JS-driven mount = no flash of empty cream frame). Here we only:
//   1. Attach a permanent delegated click listener
//   2. Reveal the painting (opacity 0 → 1) once the img is decoded
function initCake(): void {
  const stage = document.getElementById("cake-stage-el");
  stage?.addEventListener("click", () => cakeClickHandler?.());

  const painting = document.getElementById("painting-el");
  const img = painting?.querySelector("img");
  if (!painting || !img) return;
  const reveal = () => painting.classList.add("is-ready");
  if (img.complete && img.naturalWidth > 0) {
    // Already decoded (preload/cache) — reveal next frame to avoid layout race
    requestAnimationFrame(reveal);
  } else {
    img.addEventListener("load", reveal, { once: true });
    img.addEventListener("error", reveal, { once: true }); // fail-open so user isn't stuck
  }
}

/**
 * 3-state cake visual:
 *   "dormant" — painting at full color, NO flame overlay (waiting to be lit)
 *   "lit"     — painting + warm glow halo + rising sparks
 *   "blown"   — painting desaturated + rising smoke (post-blow)
 */
type CakeState = "dormant" | "lit" | "blown";
function setCakeState(state: CakeState): void {
  cakeLit = state === "lit";
  const painting = document.getElementById("painting-el");
  const glow = document.getElementById("painting-glow");
  const sparks = document.getElementById("painting-sparks");
  const smoke = document.getElementById("painting-smoke");
  if (!painting) return;
  painting.classList.toggle("painting--out", state === "blown");
  if (glow)   glow.style.display   = state === "lit" ? "" : "none";
  if (sparks) sparks.style.display = state === "lit" ? "" : "none";
  if (smoke)  smoke.style.display  = state === "blown" ? "" : "none";
}

function setCakeClickable(clickable: boolean, handler: (() => void) | null = null): void {
  cakeClickHandler = clickable ? handler : null;
  const stage = document.getElementById("cake-stage-el");
  if (!stage) return;
  stage.classList.toggle("cake-stage--clickable", clickable);
  if (clickable) {
    stage.setAttribute("role", "button");
    stage.setAttribute("tabindex", "0");
    stage.setAttribute("aria-label", "blow out the candle");
  } else {
    stage.removeAttribute("role");
    stage.removeAttribute("tabindex");
    stage.removeAttribute("aria-label");
  }
}

function setCakeAge(age: string): void {
  cakeAge = age;
  const ageEl = document.getElementById("cake-age");
  if (ageEl) ageEl.textContent = age;
}

function blowOutCake(): void {
  if (!cakeLit) return;
  setCakeState("blown");
  // Crossfade age digit: fade out current → swap text → fade in new value.
  const ageEl = document.getElementById("cake-age");
  if (!ageEl) return;
  ageEl.style.transition = "opacity 600ms ease";
  ageEl.style.opacity = "0";
  setTimeout(() => {
    setCakeAge(AGE_AFTER);
    requestAnimationFrame(() => {
      ageEl.style.opacity = "0.55";
    });
  }, 600);
}

// --- BALLOONS (sparse pre-blow, celebratory post-blow) ---
function renderBalloons(postBlow: boolean): void {
  type B = { shape: "round" | "heart" | "star"; left: string; delay: number; duration: number };
  const sparse: B[] = [
    { shape: "round", left: "4%",  delay: -6,  duration: 32 },
    { shape: "heart", left: "90%", delay: -22, duration: 36 },
  ];
  const burst: B[] = [
    { shape: "round", left: "3%",  delay: -2,  duration: 13 },
    { shape: "heart", left: "88%", delay: -5,  duration: 15 },
    { shape: "star",  left: "14%", delay: -9,  duration: 16 },
    { shape: "heart", left: "76%", delay: -3,  duration: 14 },
    { shape: "round", left: "22%", delay: -12, duration: 17 },
    { shape: "star",  left: "94%", delay: -7,  duration: 13 },
  ];
  const set = postBlow ? burst : sparse;
  balloonsLayer.innerHTML = set.map(b => `
    <div class="bg-balloon" style="left:${b.left};--bg-delay:${b.delay}s;--bg-dur:${b.duration}s">
      <img src="/assets/balloon-gold-${b.shape}.png" alt="" draggable="false" />
    </div>
  `).join("");
}

// --- MUSIC ---
const music = createMusic();
mountMusicToggle(music);
function autoStartMusicOnce(): void {
  // Browser autoplay gate: only call after a user gesture (button click).
  if (!music.isPlaying()) music.start();
}

// --- BOOT ---
initCake();
renderBalloons(false);

function runDailyMode(): void {
  const days = daysUntilBirthday();
  setHeader("DAILY MODE", `${formatDate()} · the cake won't go out today`);
  setFooter(`come back on may 20 · ${days} day${days === 1 ? "" : "s"} to go`);
  setUI("");
  setCakeState("lit");
  setCakeAge(AGE_BEFORE);
  setCakeClickable(false);
  renderBalloons(false);
}

async function runBirthdayMode(): Promise<void> {
  setHeader("BIRTHDAY MODE", `${formatDate()} · today's the day`);
  setFooter("happy birthday ✦");
  setCakeState("dormant"); // candle unlit until user clicks "light it up"
  setCakeAge(AGE_BEFORE);
  renderBalloons(false);

  setUI(`
    <div class="hero-title">today's <em>the day.</em></div>
    <p class="hero-sub">we'll need your camera + mic for a moment.</p>
    <button id="start-btn" class="btn btn--cherry">light it up</button>
  `);
  const btn = document.getElementById("start-btn") as HTMLButtonElement;
  btn.addEventListener("click", () => {
    btn.disabled = true;
    setCakeState("lit"); // 🔥 the click is the lighting moment
    autoStartMusicOnce();
    void enterFaceMatchPhase();
  });
}

async function enterFaceMatchPhase(): Promise<void> {
  setUI(`<div class="status-text">warming up the lens</div>`);

  // E2E bypass: skip cam/mic/face — straight to blow phase (tap-only path).
  if (BYPASS) {
    const fakeVideo = document.getElementById("cam") as HTMLVideoElement;
    const fakeStream = new MediaStream();
    await enterBlowPhase(fakeVideo, new Float32Array(128), fakeStream, fakeStream);
    return;
  }

  const video = document.getElementById("cam") as HTMLVideoElement;
  let stream: MediaStream;
  let videoOnlyStream: MediaStream;
  let audioOnlyStream: MediaStream;
  try {
    // Request camera + mic in ONE prompt. Disable AGC/noise/echo so blowing
    // bursts aren't dampened by the audio pipeline.
    stream = await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    // Split into separate streams: iOS Safari conflicts when the same audio track
    // is consumed by <video> AND an AudioContext analyser simultaneously.
    videoOnlyStream = new MediaStream(stream.getVideoTracks());
    audioOnlyStream = new MediaStream(stream.getAudioTracks());
    video.srcObject = videoOnlyStream;
    await video.play();
  } catch {
    setUI(`<div class="modal-status is-error">camera or mic blocked — refresh and allow access</div>`);
    return;
  }

  setUI(`<div class="status-text">loading the eyes that know you</div>`);
  await initFaceApi("/models");
  let refEmbedding: Float32Array;
  try {
    refEmbedding = await loadReferenceEmbedding("/embedding.json");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    setUI(`<div class="modal-status is-error">no embedding yet — <a href="/setup.html" style="color:var(--bc-yellow)">open setup</a> · ${escapeHtml(msg)}</div>`);
    return;
  }

  setUI(`<div class="status-text">look at me</div>`);
  let consecutiveMatches = 0;
  let consecutiveMisses = 0;

  await new Promise<void>((resolve, reject) => {
    const checkInterval = window.setInterval(async () => {
      try {
        const res = await detectAndMatch(video, refEmbedding, MATCH_THRESHOLD);
        if (DEBUG) {
          setFooter(`detected=${res.detected} matched=${res.matched} dist=${res.distance.toFixed(3)}`);
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
      } catch {/* transient */}
    }, 400);
  }).catch((e) => {
    if (e.message === "not-jada") {
      setUI(`<div class="modal-status is-error">this cake isn't for you · only the birthday person can light it</div>`);
      stopAllStreams(stream);
      setTimeout(() => runDailyMode(), 5000);
      return Promise.reject(e);
    }
    return Promise.reject(e);
  });

  await showPriorCapsulesIfAny();
  await enterBlowPhase(video, refEmbedding, stream, audioOnlyStream);
}

async function showPriorCapsulesIfAny(): Promise<void> {
  let priors: CapsuleData[] = [];
  try {
    priors = await fetchPriorCapsules({ repo: REPO });
  } catch {/* skip */}
  const currentYear = todayParts().year;
  const earlier = priors.filter((c) => c.year < currentYear);
  if (earlier.length === 0) return;

  let idx = 0;
  return new Promise<void>((resolve) => {
    const modal = showModal("");
    const render = (): void => {
      const c = earlier[idx]!;
      const audioBlock = c.audioDataUrl ? `
        <div class="prior-block">
          <div class="prior-label">the voice</div>
          <audio controls src="${c.audioDataUrl}" style="width:100%"></audio>
        </div>
      ` : "";
      const isLast = idx >= earlier.length - 1;
      modal.querySelector(".modal-content")!.innerHTML = `
        <div class="modal-eyebrow">A LETTER FROM PAST YOU</div>
        <div class="modal-title">${c.year} <em>said</em></div>
        <div class="prior-block">
          <div class="prior-label"><span class="prior-label__n">1</span>proudest of</div>
          <div class="prior-q">${escapeHtml(c.q1 || "—")}</div>
        </div>
        <div class="prior-block">
          <div class="prior-label"><span class="prior-label__n prior-label__n--2">2</span>a warning</div>
          <div class="prior-q">${escapeHtml(c.q2 || "—")}</div>
        </div>
        <div class="prior-block">
          <div class="prior-label"><span class="prior-label__n prior-label__n--3">3</span>a wish</div>
          <div class="prior-q">${escapeHtml(c.q3 || "—")}</div>
        </div>
        ${audioBlock}
        <div class="prior-meta">
          <span>${idx + 1} of ${earlier.length}</span>
          <button id="next-btn" class="btn btn--cream">${isLast ? "open the cake →" : "next letter →"}</button>
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
    render();
  });
}

async function enterBlowPhase(
  video: HTMLVideoElement,
  refEmbedding: Float32Array,
  stream: MediaStream,
  audioStream: MediaStream,
): Promise<void> {
  // iOS Safari & touch devices: face-api landmark detection is too flaky
  // for pucker AND auto-AGC squashes mic bursts. So make tap-to-blow the
  // primary path; mic detection still runs as a bonus with looser thresholds.
  const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;

  setUI(`
    <div class="blow-prompt">blow it out.</div>
    <p class="blow-hint">${isTouch || BYPASS ? "tap the cake ↑" : "or click the cake if you're shy"}</p>
  `);
  setCakeClickable(true, () => {
    if (cakeLit) blowOutCake();
  });

  // E2E bypass: no mic detector, no face-api tick. Tap-to-blow only.
  // A lightweight watcher polls cakeLit and fires the post-blow cleanup.
  if (BYPASS) {
    const watcher = window.setInterval(() => {
      if (!cakeLit) {
        clearInterval(watcher);
        renderBalloons(true);
        setCakeClickable(false);
        setUI(`
          <div class="hero-title"><em>39.</em></div>
          <p class="hero-sub">that's a wrap on thirty-eight. now leave a note for next year.</p>
          <button id="write-btn" class="btn btn--yellow">write the letter</button>
        `);
        const writeBtn = document.getElementById("write-btn") as HTMLButtonElement;
        writeBtn.addEventListener("click", () => void enterCapsulePhase());
      }
    }, 100);
    return;
  }

  const blow: BlowDetector = createBlowDetector({
    micThreshold: isTouch ? 0.06 : 0.12,
    cooldownMs: 350,
    requireFaceMouth: !isTouch, // mobile: skip pucker entirely, rely on mic + tap
  });

  try {
    // Reuse the audio-only stream passed in from enterFaceMatchPhase (single permission prompt).
    await blow.start(audioStream);
  } catch {
    setUI(`<div class="modal-status is-error">mic blocked — refresh and allow access</div>`);
    return;
  }

  let priorAllOut = false;
  blow.onBlow(() => {
    if (cakeLit) blowOutCake();
  });

  const tick = async (): Promise<void> => {
    if (!cakeLit && !priorAllOut) {
      priorAllOut = true;
      blow.stop();
      stopAllStreams(stream);
      // iOS deactivates the shared audio session when mic stream closes;
      // explicitly nudge the music context so it keeps playing through the celebration.
      void music.resume();
      renderBalloons(true); // celebratory balloons
      setCakeClickable(false);
      setUI(`
        <div class="hero-title"><em>39.</em></div>
        <p class="hero-sub">that's a wrap on thirty-eight. now leave a note for next year.</p>
        <button id="write-btn" class="btn btn--yellow">write the letter</button>
      `);
      const writeBtn = document.getElementById("write-btn") as HTMLButtonElement;
      writeBtn.addEventListener("click", () => void enterCapsulePhase());
      return;
    }
    try {
      const res = await detectAndMatch(video, refEmbedding, MATCH_THRESHOLD);
      blow.updateFaceLandmarks(res.landmarks);
      if (DEBUG) {
        const dbg = blow.getDebugState();
        setFooter(`mic=${dbg.micEnergy.toFixed(3)} pucker=${dbg.puckered} open=${dbg.mouthOpen}`);
      }
    } catch {/* transient */}
    // Always schedule next tick — the cleanup branch above handles termination
    // (returns early after priorAllOut flips). Previously gated on `cakeLit`,
    // which broke: blow flips cakeLit→false mid-tick, end-of-tick skips
    // scheduling, cleanup branch never gets a chance to fire.
    if (!priorAllOut) setTimeout(() => void tick(), 100);
  };
  void tick();
}

async function enterCapsulePhase(): Promise<void> {
  const year = todayParts().year;
  const nextYear = year + 1;
  const modal = showModal(`
    <div class="modal-eyebrow">SEALED FOR ${nextYear}</div>
    <div class="modal-title">a letter to <em>next-year you</em></div>

    <div class="prompt-block">
      <label class="prompt-label" for="q1"><span class="prompt-label__num">1</span>what are you proudest of this year?</label>
      <textarea id="q1" class="bc-textarea" placeholder="the one thing you'd brag about…"></textarea>
    </div>
    <div class="prompt-block">
      <label class="prompt-label" for="q2"><span class="prompt-label__num prompt-label__num--2">2</span>a warning for next-year you</label>
      <textarea id="q2" class="bc-textarea" placeholder="don't fall for this one again…"></textarea>
    </div>
    <div class="prompt-block">
      <label class="prompt-label" for="q3"><span class="prompt-label__num prompt-label__num--3">3</span>a wish you'd put on the cake</label>
      <textarea id="q3" class="bc-textarea" placeholder="if a candle would grant it…"></textarea>
    </div>

    <div class="prompt-block">
      <span class="prompt-label">your voice <span style="font-family:var(--font-body);font-style:italic;font-size:0.9rem;color:var(--bc-ink-soft);text-transform:none">(optional · 30s max)</span></span>
      <div class="recorder-row">
        <button id="rec-btn" class="btn-record"><span class="dot"></span><span class="rec-label">record</span></button>
        <span id="rec-status" class="rec-status">not recorded yet</span>
      </div>
      <audio id="rec-playback" controls style="display:none;width:100%;margin-top:8px"></audio>
    </div>

    <div class="modal-footer">
      <span id="status" class="modal-status">tap seal when you're ready · can't be opened until ${nextYear}-05-20</span>
      <button id="submit-btn" class="btn btn--cherry">seal it</button>
    </div>
  `);

  let audioDataUrl = "";
  setupRecorder(modal, (url) => { audioDataUrl = url; });

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

    // Payload guard: GitHub Issue body limit is ~64KB. If audio pushes us over,
    // strip it client-side so the text + recording aren't both lost.
    const MAX_PAYLOAD_CHARS = 60000;
    let finalAudio = audioDataUrl;
    let droppedAudio = false;
    const previewSize = JSON.stringify({ year, q1, q2, q3, audioDataUrl }).length;
    if (previewSize > MAX_PAYLOAD_CHARS && audioDataUrl) {
      finalAudio = "";
      droppedAudio = true;
    }

    try {
      const url = await submitCapsule({ year, q1, q2, q3, audioDataUrl: finalAudio });
      burstConfetti();
      const audioNote = droppedAudio
        ? `<div class="sealed__sub" style="color:var(--bc-cherry);font-size:0.95rem">voice was too long to fit — only the text was sealed</div>`
        : "";
      modal.querySelector(".modal-content")!.innerHTML = `
        <div class="sealed">
          <img class="sealed__env" src="/assets/envelope-sealed.svg" alt="sealed envelope" />
          <div class="sealed__title">sealed.</div>
          <div class="sealed__sub">see you on may 20, ${nextYear} ✦</div>
          ${audioNote}
          <a class="sealed__link" href="${url}" target="_blank" rel="noopener">
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

function setupRecorder(modal: HTMLDivElement, onComplete: (dataUrl: string) => void): void {
  const recBtn = modal.querySelector("#rec-btn") as HTMLButtonElement;
  const recLabel = recBtn.querySelector(".rec-label") as HTMLSpanElement;
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
      recStatus.textContent = "mic blocked";
      return;
    }
    // 12kbps opus — 30s ≈ 45KB binary ≈ 60KB base64, fits under GitHub Issue body limit (65KB).
    const opts: MediaRecorderOptions = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 12000 }
      : {};
    mediaRecorder = new MediaRecorder(stream, opts);
    chunks = [];
    mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream?.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: mediaRecorder?.mimeType ?? "audio/webm" });
      const dataUrl = await blobToDataUrl(blob);
      playback.src = dataUrl;
      playback.style.display = "block";
      const kb = (blob.size / 1024).toFixed(1);
      recStatus.textContent = `recorded · ${kb} KB`;
      recLabel.textContent = "re-record";
      recBtn.classList.remove("is-recording");
      onComplete(dataUrl);
    };
    mediaRecorder.start();
    recLabel.textContent = "stop";
    recBtn.classList.add("is-recording");
    recStatus.textContent = "recording…";
    stopTimer = window.setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
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

function stopAllStreams(stream: MediaStream): void {
  stream.getTracks().forEach((t) => t.stop());
}

function burstConfetti(): void {
  const burst = document.createElement("div");
  burst.className = "confetti-burst";
  const colors = ["#ec3a2f", "#f5c419", "#bee0c4", "#f5e9c8", "#2e44b8"];
  const PIECES = 36;
  for (let i = 0; i < PIECES; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    const dx = (Math.random() - 0.5) * 1200;
    const dy = Math.random() * window.innerHeight * 1.1 + 200;
    const dr = (Math.random() - 0.5) * 1440;
    const color = colors[i % colors.length];
    piece.setAttribute("style",
      `background:${color};--dx:${dx}px;--dy:${dy}px;--dr:${dr}deg;animation-delay:${(Math.random() * 0.3).toFixed(2)}s;`
    );
    burst.appendChild(piece);
  }
  document.body.appendChild(burst);
  setTimeout(() => burst.remove(), 2600);
}

// --- test hooks ---
if (params.get("test") === "blow") {
  setTimeout(() => blowOutCake(), 2000);
}
if (params.get("test") === "post-blow") {
  setCakeState("blown");
  setCakeAge(AGE_AFTER);
  renderBalloons(true);
}

// --- boot ---
if (isBirthdayToday()) {
  void runBirthdayMode();
} else {
  runDailyMode();
}
