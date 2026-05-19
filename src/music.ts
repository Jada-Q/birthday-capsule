// Music — synthesizes the "Happy Birthday" melody via Web Audio API.
// Melody is public domain (2016). Notes are triangle-wave tones + sine octave-up
// shimmer + soft envelopes, music-box style. Loops with a 1.5s rest.
//
// Browsers block autoplay until a user gesture — caller must invoke `start()`
// in response to a click/tap, not on page load.

const NOTES: { f: number; d: number }[] = [
  // bar 1: "happy birth-day to you"
  { f: 392, d: 0.5 }, { f: 392, d: 0.5 }, { f: 440, d: 1 },
  { f: 392, d: 1 },   { f: 523, d: 1 },   { f: 494, d: 2 },
  // bar 2: "happy birth-day to you"
  { f: 392, d: 0.5 }, { f: 392, d: 0.5 }, { f: 440, d: 1 },
  { f: 392, d: 1 },   { f: 587, d: 1 },   { f: 523, d: 2 },
  // bar 3: "happy birth-day dear ___"
  { f: 392, d: 0.5 }, { f: 392, d: 0.5 }, { f: 784, d: 1 },
  { f: 659, d: 1 },   { f: 523, d: 1 },   { f: 494, d: 1 },
  { f: 440, d: 2 },
  // bar 4: "happy birth-day to you"
  { f: 698, d: 0.5 }, { f: 698, d: 0.5 }, { f: 659, d: 1 },
  { f: 523, d: 1 },   { f: 587, d: 1 },   { f: 523, d: 2 },
];

const BPM = 100;
const REST_SECONDS = 1.5;

export interface MusicController {
  start(): void;
  stop(): void;
  isPlaying(): boolean;
  toggle(): boolean; // returns new isPlaying state
}

export function createMusic(): MusicController {
  let ctx: AudioContext | null = null;
  let cancelled = false;
  let loopTimer = 0;

  const beat = 60 / BPM;
  const songLenSec = NOTES.reduce((s, n) => s + n.d, 0) * beat;

  function start(): void {
    if (ctx) return;
    const Ctx = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
    if (!Ctx) return;
    ctx = new Ctx();
    cancelled = false;

    const master = ctx.createGain();
    master.gain.value = 0.16;
    master.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2400;
    filter.Q.value = 0.7;
    filter.connect(master);

    const scheduleSong = (startTime: number): void => {
      if (!ctx) return;
      let t = startTime;
      for (const n of NOTES) {
        if (cancelled) return;
        const dur = n.d * beat * 0.92;
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = n.f;
        const osc2 = ctx.createOscillator();
        osc2.type = "sine";
        osc2.frequency.value = n.f * 2;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(1.0, t + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

        const gain2 = ctx.createGain();
        gain2.gain.setValueAtTime(0, t);
        gain2.gain.linearRampToValueAtTime(0.35, t + 0.02);
        gain2.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.8);

        osc.connect(gain).connect(filter);
        osc2.connect(gain2).connect(filter);
        osc.start(t);
        osc2.start(t);
        osc.stop(t + dur + 0.05);
        osc2.stop(t + dur + 0.05);
        t += n.d * beat;
      }
    };

    const t0 = ctx.currentTime + 0.15;
    scheduleSong(t0);

    const loop = (): void => {
      if (cancelled || !ctx) return;
      const nextStart = ctx.currentTime + REST_SECONDS;
      scheduleSong(nextStart);
      loopTimer = window.setTimeout(loop, (songLenSec + REST_SECONDS) * 1000);
    };
    loopTimer = window.setTimeout(loop, (songLenSec + REST_SECONDS) * 1000);
  }

  function stop(): void {
    cancelled = true;
    if (loopTimer) {
      clearTimeout(loopTimer);
      loopTimer = 0;
    }
    if (ctx) {
      try { void ctx.close(); } catch {}
      ctx = null;
    }
  }

  function isPlaying(): boolean {
    return ctx != null;
  }

  function toggle(): boolean {
    if (isPlaying()) stop();
    else start();
    return isPlaying();
  }

  return { start, stop, isPlaying, toggle };
}

/** Attach a music toggle button to the DOM (bottom-right pill). */
export function mountMusicToggle(controller: MusicController): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "music-toggle";
  btn.setAttribute("aria-label", "toggle music");
  btn.innerHTML = `
    <span class="music-toggle__icon" aria-hidden="true">♪</span>
    <span class="music-toggle__label">play the tune</span>
  `;
  const labelEl = btn.querySelector(".music-toggle__label") as HTMLSpanElement;

  function render(): void {
    const playing = controller.isPlaying();
    btn.classList.toggle("music-toggle--on", playing);
    labelEl.textContent = playing ? "playing · happy birthday" : "play the tune";
  }

  btn.addEventListener("click", () => {
    controller.toggle();
    render();
  });

  document.body.appendChild(btn);
  return btn;
}
