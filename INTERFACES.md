# Birthday Capsule — Module Interfaces

> Contracts that all 4 modules MUST match exactly. Parent (main.ts) wires them together.
> Implementation lives in `src/*.ts`. Browser-only ESM. TypeScript strict.

## Project shape (already scaffolded)

```
birthday-capsule/
  package.json       (vite + @vladmandic/face-api)
  tsconfig.json
  vite.config.ts     (multi-page: index.html + setup.html)
  index.html         (main app, has <canvas id="stage" w=640 h=640>, <video id="cam">, <div id="ui">, <footer id="footer">)
  setup.html         (one-time embedding gen, done)
  src/
    main.ts          (parent, will wire modules)
    setup.ts         (done — generates embedding.json)
    styles.css       (done — palette: --bg #0a0a0f, --warm #ffb060, --text #e8e0d0)
    cake.ts          ← agent A
    face.ts          ← agent B
    blow.ts          ← agent C
    capsule.ts       ← agent D
  public/
    models/          (face-api weight files, parent copies post-install)
    embedding.json   (generated via setup.html, parent handles)
```

## Hard constraints (all modules)

- **Browser only.** No Node APIs.
- **TypeScript strict.** No `any` in exports. Internal `any` ok if needed for 3rd-party untyped APIs.
- **No new dependencies** beyond what's in package.json. `@vladmandic/face-api` is available.
- **No console.log in production paths.** Use `console.debug` if needed.
- **Functions must be testable in isolation.** Don't reach into DOM globals; accept inputs explicitly.
- **No top-level side effects.** Export classes/functions; let main.ts call them.

---

## src/cake.ts — Agent A

Pixel-art canvas render of a 2-layer round birthday cake with N candles arranged in a ring on the top tier. Flame is a 2-frame idle animation. When a candle is blown out it shows a 3-frame smoke wisp that fades over ~1s.

```ts
export interface CakeOptions {
  candleCount: number;       // 39
  size: number;              // canvas width=height, e.g. 640
}

export class Cake {
  constructor(canvas: HTMLCanvasElement, opts: CakeOptions);

  /** Call once per frame (use requestAnimationFrame). t = performance.now() */
  render(t: number): void;

  /** Blow out a random still-lit candle. Returns true if a candle was blown out, false if all already out. */
  blowOut(): boolean;

  /** Re-light all candles instantly */
  reset(): void;

  /** True when all candles are out AND smoke animations have finished */
  get allOut(): boolean;

  /** Number of still-lit candles */
  get litCount(): number;
}
```

**Visual notes:**
- Cake: 2 round tiers (bigger bottom, smaller top), cream/white body, hint of strawberry pink/red detail
- Candles: vertical pixel sticks, slight color variation (whites/pastels), 4×8 sprite-ish
- Flame: 2-frame idle, warm yellow→orange flicker at ~5fps
- Smoke: 3 puff frames rising + fading over ~1000ms after blowOut
- Background: transparent (stage already has gradient bg via CSS)
- Use `ctx.imageSmoothingEnabled = false` for pixel-perfect

**Performance:** 60fps target. Keep per-frame work O(candleCount). Pre-compute candle positions once.

**Test scaffold:** include a `if (import.meta.url === ...)` block at bottom that, when imported by a tiny demo page, mounts a Cake and renders. (Optional, not required for ship.)

---

## src/face.ts — Agent B

Wraps `@vladmandic/face-api` for face detection + embedding match. Loads models from `/models` (served from public/models/). Loads reference embedding from `/embedding.json`.

```ts
export interface FaceMatchResult {
  detected: boolean;       // a face was found
  matched: boolean;        // matches reference within threshold
  distance: number;        // euclidean distance, lower = closer (face-api convention)
  /** Raw landmarks if detected, for blow.ts to read mouth shape. Type from face-api. */
  landmarks: any | null;
}

/** Load face-api models. Call once at startup. */
export async function initFaceApi(modelsPath?: string): Promise<void>;

/** Load reference embedding from a URL. Returns 128-dim Float32Array. */
export async function loadReferenceEmbedding(jsonPath?: string): Promise<Float32Array>;

/**
 * Run detection + match against a reference embedding.
 * Returns immediately with detected:false if no face is in frame.
 * Uses ssdMobilenetv1 detector for stability over tinyFaceDetector.
 */
export async function detectAndMatch(
  video: HTMLVideoElement,
  refEmbedding: Float32Array,
  matchThreshold?: number,  // default 0.4 (face-api convention: <0.6 = same person)
): Promise<FaceMatchResult>;
```

**Notes:**
- Models in `/models`: `ssd_mobilenetv1_model-*`, `face_landmark_68_model-*`, `face_recognition_model-*`
- `matchThreshold` default 0.4 (stricter than face-api default 0.6, because reference is from same lighting/device)
- Don't throw on no-face; return `{ detected: false, matched: false, distance: 1, landmarks: null }`
- Reuse detector options across calls (perf)

---

## src/blow.ts — Agent C

Detects a "blow" gesture by combining mic energy + face mouth shape. Either signal alone is too noisy; AND of both is robust.

```ts
export interface BlowDetectorOptions {
  /** RMS mic energy (0..1) above which is "windy". Default 0.12 */
  micThreshold?: number;
  /** Min ms between consecutive blow events. Default 350 */
  cooldownMs?: number;
  /** If true, mouth must be open + puckered to count. Default true. Set false to bypass face check. */
  requireFaceMouth?: boolean;
}

export interface BlowDetector {
  /** Request mic permission and start audio analysis. */
  start(): Promise<void>;
  /** Stop mic and remove listeners. */
  stop(): void;
  /** Register a callback fired once per detected blow event. */
  onBlow(handler: () => void): void;
  /**
   * Caller updates this every frame from face.ts landmarks.
   * Pass the landmarks object (or null if no face). blow.ts derives pucker internally.
   */
  updateFaceLandmarks(landmarks: any | null): void;
  /** Debug: current mic energy (0..1) and pucker score (0..1). */
  getDebugState(): { micEnergy: number; puckered: boolean; mouthOpen: boolean };
}

export function createBlowDetector(opts?: BlowDetectorOptions): BlowDetector;
```

**Pucker detection (from 68-landmark model):**
- Mouth landmarks are indices 48-67 in the 68-point model
- Outer mouth: 48-59. Inner mouth: 60-67
- "Pucker" = mouth width (49→55 x-distance) is unusually small relative to face width, AND lips form a small O (inner mouth height > 0)
- Heuristic: `puckered = (mouthWidth / faceWidth) < 0.18 && innerMouthHeight > 4px`
- Tune thresholds; err on lenient — manual click fallback exists

**Mic energy:**
- `AudioContext` → `getUserMedia({audio:true})` → `MediaStreamAudioSourceNode` → `AnalyserNode`
- Sample `getByteTimeDomainData`, compute RMS, normalize 0..1
- `micThreshold` default 0.12 (real blow ≈ 0.2-0.4; talking ≈ 0.05-0.1)

**Blow event:**
- Fire `onBlow` when `(micEnergy > threshold)` AND `(!requireFaceMouth || puckered)` for ≥ 2 consecutive frames, then enter cooldown.

---

## src/capsule.ts — Agent D

Reads/writes capsules to GitHub Issues. Repo is **public**. Token is a fine-grained PAT with `issues:write` for one repo, injected via Vite env var.

```ts
export interface CapsuleData {
  year: number;           // e.g. 2026
  q1: string;             // 这一年最骄傲的 1 件事
  q2: string;             // 给明年的你 1 个 warning
  q3: string;             // 给明年的你 1 个 wish
  /** Full data URL including `data:audio/webm;base64,...` prefix. May be empty string. */
  audioDataUrl: string;
}

export interface CapsuleSubmitOpts {
  repo: string;           // "Jada-Q/birthday-capsule"
  token: string;          // GitHub PAT (issues:write)
}

export interface CapsuleFetchOpts {
  repo: string;
  token?: string;         // optional for public repo reads
}

/** Submit a capsule. Returns the new issue's HTML URL. Throws on API failure. */
export async function submitCapsule(
  data: CapsuleData,
  opts: CapsuleSubmitOpts,
): Promise<string>;

/** Fetch all prior capsules sorted ascending by year. */
export async function fetchPriorCapsules(
  opts: CapsuleFetchOpts,
): Promise<CapsuleData[]>;
```

**Implementation notes:**
- Endpoint: `POST https://api.github.com/repos/{repo}/issues` with `{ title, body, labels }`
- Title: `Capsule ${year}`
- Labels: `[\`capsule-${year}\`]`
- Body: a fenced ```json code block containing the full CapsuleData JSON, plus a human-readable header above it
- Fetch: `GET /repos/{repo}/issues?labels=capsule-2026,capsule-2027,...&state=all` — but easier: `?state=all` and filter by label client-side, OR list each year's label separately
- Parse fetched issues by extracting the ```json``` block
- `audioDataUrl` size: keep under 1MB. GitHub Issue body limit is 65,536 chars; 1MB base64 ≈ 1.4M chars → exceeds. **Must compress/limit upstream (caller's responsibility to cap audio recording)**. If body > 60k chars, throw `Error("payload too large")`.
- Use native `fetch`. Handle non-2xx as thrown Error with status + body.

---

## Wiring (parent does this in main.ts, you don't need to)

```ts
// pseudocode for context:
const isBirthday = /* date check */;
if (!isBirthday) { cake.render loop; return; }

await initFaceApi();
const ref = await loadReferenceEmbedding();
// open cam, request mic
const blow = createBlowDetector();
await blow.start();
blow.onBlow(() => cake.blowOut());

// per-frame loop:
const res = await detectAndMatch(video, ref);
if (!res.matched) { /* show "not you" */ }
blow.updateFaceLandmarks(res.landmarks);
cake.render(t);

if (cake.allOut) { /* show capsule prompt → submitCapsule */ }
```

You don't implement wiring. Just expose the contract above.
