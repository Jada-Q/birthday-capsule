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

// --- CAKE PAINTING (replaces canvas Cake class) ---
let cakeLit = true;
let cakeClickable = false;
let cakeAge: string = AGE_BEFORE;
let onCakeClick: (() => void) | null = null;

function renderCake(): void {
  const stageClass = "cake-stage" + (cakeClickable ? " cake-stage--clickable" : "");
  const paintingClass = "painting" + (cakeLit ? "" : " painting--out");
  const ariaLabel = cakeClickable ? 'aria-label="blow out the candle" role="button" tabindex="0"' : "";

  const litExtras = cakeLit ? `
    <div class="painting__glow" aria-hidden="true"></div>
    <div class="painting__sparks" aria-hidden="true">
      <span class="spark spark--1"></span>
      <span class="spark spark--2"></span>
      <span class="spark spark--3"></span>
      <span class="spark spark--4"></span>
      <span class="spark spark--5"></span>
    </div>
  ` : "";

  const smoke = cakeLit ? "" : `
    <svg class="painting__smoke" viewBox="0 0 100 100" aria-hidden="true">
      <g opacity="0.85" style="animation: smoke-drift 2.4s ease-in-out infinite">
        <ellipse cx="50" cy="22" rx="4" ry="5" fill="#f5e9c8" stroke="#1a1410" stroke-width="1.5"/>
        <ellipse cx="56" cy="12" rx="3.5" ry="4" fill="#f5e9c8" stroke="#1a1410" stroke-width="1.5"/>
        <ellipse cx="48" cy="4" rx="2.5" ry="3" fill="#f5e9c8" stroke="#1a1410" stroke-width="1.5"/>
      </g>
    </svg>
  `;

  cakeMount.innerHTML = `
    <div class="${stageClass}" ${ariaLabel}>
      <div class="cake-stage__age" aria-hidden="true">${cakeAge}</div>
      <div class="${paintingClass}">
        <img src="/assets/cake-painted.png" alt="birthday cake oil painting" draggable="false" />
        ${litExtras}
        ${smoke}
      </div>
    </div>
  `;

  if (cakeClickable && onCakeClick) {
    const stage = cakeMount.querySelector(".cake-stage") as HTMLDivElement;
    stage.addEventListener("click", onCakeClick);
  }
}

function setCakeClickable(clickable: boolean, handler: (() => void) | null = null): void {
  cakeClickable = clickable;
  onCakeClick = handler;
  renderCake();
}

function blowOutCake(): void {
  if (!cakeLit) return;
  cakeLit = false;
  // Crossfade age digit
  const ageEl = cakeMount.querySelector(".cake-stage__age") as HTMLElement | null;
  if (ageEl) {
    ageEl.style.opacity = "0";
    setTimeout(() => {
      cakeAge = AGE_AFTER;
      renderCake();
      const newAgeEl = cakeMount.querySelector(".cake-stage__age") as HTMLElement | null;
      if (newAgeEl) {
        newAgeEl.style.opacity = "0";
        requestAnimationFrame(() => {
          newAgeEl.style.opacity = "0.55";
        });
      }
    }, TRANSITION_MS / 2);
  } else {
    renderCake();
  }
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
renderCake();
renderBalloons(false);

function runDailyMode(): void {
  const days = daysUntilBirthday();
  setHeader("DAILY MODE", `${formatDate()} · the cake won't go out today`);
  setFooter(`come back on may 20 · ${days} day${days === 1 ? "" : "s"} to go`);
  setUI("");
  cakeLit = true;
  cakeAge = AGE_BEFORE;
  setCakeClickable(false);
  renderBalloons(false);
}

async function runBirthdayMode(): Promise<void> {
  setHeader("BIRTHDAY MODE", `${formatDate()} · today's the day`);
  setFooter("happy birthday ✦");
  cakeLit = true;
  cakeAge = AGE_BEFORE;
  renderCake();
  renderBalloons(false);

  setUI(`
    <button id="start-btn" class="btn btn--cherry">light it up</button>
    <p class="blow-hint">we'll need your camera + mic for a moment</p>
  `);
  const btn = document.getElementById("start-btn") as HTMLButtonElement;
  btn.addEventListener("click", () => {
    btn.disabled = true;
    autoStartMusicOnce();
    void enterFaceMatchPhase();
  });
}

async function enterFaceMatchPhase(): Promise<void> {
  setUI(`<div class="status-text">warming up the lens</div>`);

  const video = document.getElementById("cam") as HTMLVideoElement;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    await video.play();
  } catch {
    setUI(`<div class="modal-status is-error">camera blocked — refresh and allow access</div>`);
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
  await enterBlowPhase(video, refEmbedding, stream);
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
): Promise<void> {
  setUI(`
    <div class="blow-prompt">blow it out.</div>
    <p class="blow-hint">or click the cake if you're shy</p>
  `);
  setCakeClickable(true, () => {
    if (cakeLit) blowOutCake();
  });

  const blow: BlowDetector = createBlowDetector({
    micThreshold: 0.12,
    cooldownMs: 350,
    requireFaceMouth: true,
  });

  try {
    await blow.start();
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
      renderBalloons(true); // celebratory balloons
      setCakeClickable(false);
      setUI(`
        <div class="hero-title">happy <em>39</em></div>
        <p class="hero-sub">now write a letter to next-year you</p>
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
    if (cakeLit) setTimeout(() => void tick(), 100);
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

    try {
      const url = await submitCapsule({ year, q1, q2, q3, audioDataUrl });
      burstConfetti();
      modal.querySelector(".modal-content")!.innerHTML = `
        <div class="sealed">
          <img class="sealed__env" src="/assets/envelope-sealed.svg" alt="sealed envelope" />
          <div class="sealed__title">sealed.</div>
          <div class="sealed__sub">see you on may 20, ${nextYear} ✦</div>
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
    const opts: MediaRecorderOptions = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 24000 }
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
  cakeLit = false;
  cakeAge = AGE_AFTER;
  renderCake();
  renderBalloons(true);
}

// --- boot ---
if (isBirthdayToday()) {
  void runBirthdayMode();
} else {
  runDailyMode();
}
