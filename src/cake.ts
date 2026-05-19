// Pixel-art birthday cake renderer. 2 round tiers, N candles in a ring on top.
// Per-frame O(n). Candle geometry precomputed in constructor.
//
// Visual: chunky 2-tier chocolate-frosted cake. Each tier has dark chocolate
// frosting on top that drips down in uneven wavy drips. Below the frosting the
// side shows a layered cross-section (sponge / pink cream / sponge alternating).
// Top tier has a ring of small red cherries around the central numeral candle.
// Whole cake sits on a light grey-cream round plate.

export interface CakeOptions {
  candleCount: number;
  size: number;
  /** Number shown floating above the flame BEFORE blowing (e.g. "38" — age you're leaving behind). Forces candleCount → 1. */
  numberLabel?: string;
  /** Number that appears AFTER blowing (e.g. "39" — your new age). Transitions in with a fade. Defaults to numberLabel. */
  numberLabelAfter?: string;
}

// 4×6 pixel font for digits 0-9
const DIGIT_FONT: Record<string, readonly string[]> = {
  "0": ["XXXX", "X..X", "X..X", "X..X", "X..X", "XXXX"],
  "1": [".XX.", "XXX.", ".XX.", ".XX.", ".XX.", "XXXX"],
  "2": ["XXXX", "...X", "XXXX", "X...", "X...", "XXXX"],
  "3": ["XXXX", "...X", ".XXX", "...X", "...X", "XXXX"],
  "4": ["X..X", "X..X", "XXXX", "...X", "...X", "...X"],
  "5": ["XXXX", "X...", "XXXX", "...X", "...X", "XXXX"],
  "6": ["XXXX", "X...", "XXXX", "X..X", "X..X", "XXXX"],
  "7": ["XXXX", "...X", "...X", "..X.", ".X..", "X..."],
  "8": ["XXXX", "X..X", "XXXX", "X..X", "X..X", "XXXX"],
  "9": ["XXXX", "X..X", "XXXX", "...X", "...X", "XXXX"],
};
const DIGIT_W = 4;
const DIGIT_H = 6;
const DIGIT_SPACING = 2;

interface CandlePos {
  x: number;
  y: number;
  bodyColor: string;
  stripeColor: string;
  flickerOffset: number; // phase offset so flames don't sync
}

interface SmokeState {
  startTime: number; // performance.now() at blowout
  x: number;
  y: number;
  seed: number; // for slight horizontal drift
}

const SMOKE_DURATION_MS = 1000;
const FLAME_FRAME_MS = 200; // ~5fps
const PX = 4; // logical-px to canvas-px scale (cake drawn at 1/PX resolution, scaled up)

// --- Palette ---
// Plate
const COLOR_PLATE = "#d0ccc4";
const COLOR_PLATE_EDGE = "#8a8680";

// Mint frosting (top + drips) — cartoon style
const COLOR_CHOC = "#b8dcc0";
const COLOR_CHOC_SHADOW = "#7aae90";
const COLOR_CHOC_HIGHLIGHT = "#d4ecd8";

// Body (cream-white)
const COLOR_SPONGE = "#fafaf2";
const COLOR_SPONGE_SHADOW = "#dcd6c8";

// Pink cream filling (kept for compatibility; now near-white)
const COLOR_CREAM_PINK = "#f4eee0";
const COLOR_CREAM_PINK_SHADOW = "#d8d0c0";

// Silhouette outline
const COLOR_OUTLINE = "#2a1408";

// Cherry palette
const COLOR_CHERRY = "#cc2030";
const COLOR_CHERRY_SHADOW = "#8a1020";
const COLOR_CHERRY_HIGHLIGHT = "#ffd0d0";
const COLOR_CHERRY_STEM = "#3a5818";

// Candle highlights (used by numeral candle)
const COLOR_CREAM_HIGHLIGHT = "#ffffff";

const CANDLE_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ["#fff4dc", "#ffd0a8"], // cream
  ["#ffe8e8", "#ffb0b8"], // pink
  ["#e8f0ff", "#b0c8e8"], // pale blue
  ["#fff0d0", "#ffc888"], // butter
  ["#f0e8ff", "#c8b8e8"], // lavender
  ["#ffffff", "#e0e0e0"], // white
];

const FLAME_OUTER_A = "#ffcc40";
const FLAME_OUTER_B = "#ff8030";
const FLAME_INNER_A = "#fff4a0";
const FLAME_INNER_B = "#ffd060";
const WICK = "#3a2418";

const SMOKE_COLOR = "#a89888";

export class Cake {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private readonly candleCount: number;
  private readonly candles: CandlePos[];
  private readonly lit: boolean[];
  private readonly smokes: Map<number, SmokeState>;

  // precomputed cake geometry (logical px, before PX scale)
  private readonly logicalSize: number;
  private readonly bottomCx: number;
  private readonly bottomCy: number;
  private readonly bottomRx: number;
  private readonly bottomRy: number;
  private readonly bottomH: number;
  private readonly topCx: number;
  private readonly topCy: number; // top of upper tier (where candles base sits)
  private readonly topRx: number;
  private readonly topRy: number;
  private readonly topH: number;
  private readonly candleRingRx: number;
  private readonly candleRingRy: number;

  private readonly candleH: number;
  private readonly candleW: number;
  private readonly isNumeral: boolean;
  private readonly numberLabel: string;
  private readonly numberLabelAfter: string;
  private blewAt: number | null = null; // performance.now() when blowOut() fired (numeral mode)

  // Cherry positions on top tier surface, precomputed.
  private readonly cherries: ReadonlyArray<{ x: number; y: number; stemDir: -1 | 0 | 1 }>;
  // Cherry positions on bottom tier top surface (around the base of top tier), precomputed.
  private readonly bottomCherries: ReadonlyArray<{ x: number; y: number; stemDir: -1 | 0 | 1 }>;

  constructor(canvas: HTMLCanvasElement, opts: CakeOptions) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("cake: 2d context unavailable");
    this.ctx = ctx;
    this.size = opts.size;
    canvas.width = opts.size;
    canvas.height = opts.size;
    ctx.imageSmoothingEnabled = false;

    // Numeral mode: one thin candle, number floats above the flame.
    // numberLabel is the BEFORE-blow value; numberLabelAfter (defaults to numberLabel) appears after blowing.
    this.isNumeral = !!opts.numberLabel;
    this.numberLabel = opts.numberLabel ?? "";
    this.numberLabelAfter = opts.numberLabelAfter ?? this.numberLabel;
    this.candleCount = this.isNumeral ? 1 : opts.candleCount;
    this.candleW = this.isNumeral ? 5 : 4;
    this.candleH = this.isNumeral ? 22 : 8;
    this.lit = new Array(this.candleCount).fill(true);
    this.smokes = new Map();

    // Work in logical pixels (size / PX), then upscale via setTransform per frame.
    this.logicalSize = Math.floor(opts.size / PX);
    const L = this.logicalSize;

    // Cake proportions (in logical px) — chunky 2-tier.
    // Bottom tier: ~62% width, ellipse for fake 3/4 view.
    this.bottomCx = Math.floor(L / 2);
    this.bottomCy = Math.floor(L * 0.70); // vertical center of bottom tier ellipse
    this.bottomRx = Math.floor(L * 0.32);
    this.bottomRy = Math.floor(L * 0.07);
    this.bottomH = Math.floor(L * 0.15);

    // Top tier: ~42% width, sits on bottom tier's top.
    this.topRx = Math.floor(L * 0.22);
    this.topRy = Math.floor(L * 0.055);
    this.topH = Math.floor(L * 0.12);
    this.topCx = this.bottomCx;
    // Top tier bottom rim is at topCy + topH + topRy.
    // Bottom tier top rim is at bottomCy - bottomRy.
    // Place top tier so its bottom rim overlaps bottom tier top by ~2 logical px (folded).
    this.topCy = this.bottomCy - this.bottomRy - this.topH - this.topRy + 2;

    // Candle base sits on the back edge of the top ellipse (looks "planted" in 3/4 view).
    const candleBaseY = this.topCy - this.topRy;
    // Cherry ring sits at the CENTER of the top ellipse — all cherries stay within
    // the visible top surface, none float above the silhouette.
    const cherryRingCy = this.topCy;
    this.candleRingRx = Math.max(4, this.topRx - 3);
    // Cherry vertical radius capped to topRy so back-cherries don't exceed top edge.
    this.candleRingRy = Math.max(2, this.topRy - 1);

    this.candles = this.computeCandlePositions(candleBaseY);
    this.cherries = this.computeCherries(cherryRingCy);
    // Bottom-tier cherries: ring around the visible top surface of the bottom tier,
    // distributed outside the top tier's footprint (don't crowd under the top tier).
    this.bottomCherries = this.computeBottomCherries();
  }

  private computeCandlePositions(ringCy: number): CandlePos[] {
    // Numeral mode: single chunky candle centered on top tier.
    if (this.isNumeral) {
      return [
        {
          x: this.topCx,
          y: ringCy,
          bodyColor: "#fff4dc",
          stripeColor: "#d06840", // warm terracotta for digit imprint
          flickerOffset: 0,
        },
      ];
    }

    const out: CandlePos[] = [];
    const n = this.candleCount;
    for (let i = 0; i < n; i++) {
      // Distribute angle. Start at top (-PI/2), go clockwise.
      const theta = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const x = this.topCx + Math.cos(theta) * this.candleRingRx;
      const y = ringCy + Math.sin(theta) * this.candleRingRy;
      const pal = CANDLE_PALETTE[i % CANDLE_PALETTE.length]!;
      out.push({
        x: Math.round(x),
        y: Math.round(y),
        bodyColor: pal[0]!,
        stripeColor: pal[1]!,
        flickerOffset: (i * 53) % 1000, // pseudo-random phase
      });
    }
    // Sort back-to-front so candles in front draw last (painter's algorithm).
    // Larger y = further down = closer to viewer.
    out.sort((a, b) => a.y - b.y);
    return out;
  }

  // Cherries on bottom tier's visible top surface. Skip the back-center (covered by top tier)
  // and front-center (would be cropped by top tier shadow). Distribute on the sides.
  private computeBottomCherries(): ReadonlyArray<{ x: number; y: number; stemDir: -1 | 0 | 1 }> {
    const out: { x: number; y: number; stemDir: -1 | 0 | 1 }[] = [];
    const n = 6;
    // Ring centered on bottom tier's top ellipse center (= bottomCy), inset slightly.
    const rx = this.bottomRx - 4;
    const ry = this.bottomRy - 1;
    for (let i = 0; i < n; i++) {
      // Distribute on the FRONT half of the ring (theta from 0 to π), skipping the back
      // which is hidden under the top tier.
      const theta = (i / (n - 1)) * Math.PI; // 0 → π, left side to right side via front
      const x = Math.round(this.bottomCx - Math.cos(theta) * rx); // left to right
      const y = Math.round(this.bottomCy + Math.sin(theta) * ry * 0.5); // shallow arc, on top surface
      const sd: -1 | 0 | 1 = (i % 3 === 0 ? -1 : i % 3 === 1 ? 0 : 1);
      out.push({ x, y, stemDir: sd });
    }
    return out;
  }

  private computeCherries(ringCy: number): ReadonlyArray<{ x: number; y: number; stemDir: -1 | 0 | 1 }> {
    // 3 cherry mounds on top tier — wedding-cake-style stripe stacks with a cherry on top.
    // Place them on the visible top surface, distributed left / right (skip back where candle sits).
    const out: { x: number; y: number; stemDir: -1 | 0 | 1 }[] = [];
    const positions = [
      { theta: -2.2, sd: -1 as const }, // back-left
      { theta: 2.2,  sd:  1 as const }, // back-right
      { theta: Math.PI / 2, sd: 0 as const }, // front-center
    ];
    const rx = this.candleRingRx;
    const ry = this.candleRingRy;
    for (const p of positions) {
      const x = Math.round(this.topCx + Math.cos(p.theta) * rx);
      const y = Math.round(ringCy + Math.sin(p.theta) * ry);
      out.push({ x, y, stemDir: p.sd });
    }
    return out;
  }

  render(t: number): void {
    const ctx = this.ctx;
    // Clear in device px first, then switch to logical-px transform.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(PX, 0, 0, PX, 0, 0);

    // Background age number — drawn FIRST so cake sits on top of it.
    this.drawBackgroundNumber(ctx, t);
    this.drawPlate(ctx);
    this.drawBottomTier(ctx);
    this.drawTopTier(ctx);
    this.drawCherryMounds(ctx);
    this.drawCandlesAndFlames(ctx, t);
    this.drawSmoke(ctx, t);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  private drawPlate(ctx: CanvasRenderingContext2D): void {
    // Light grey-cream plate, slightly wider than bottom tier. Sits just under it.
    const cy = this.bottomCy + this.bottomH + 1;
    const rx = this.bottomRx + 5;
    const ry = Math.max(2, this.bottomRy + 1);
    // Edge / underside shadow
    this.fillEllipse(ctx, this.bottomCx, cy + 1, rx, ry, COLOR_PLATE_EDGE);
    // Plate top
    this.fillEllipse(ctx, this.bottomCx, cy, rx - 1, Math.max(1, ry - 1), COLOR_PLATE);
  }

  private drawBottomTier(ctx: CanvasRenderingContext2D): void {
    this.drawTier(
      ctx,
      this.bottomCx,
      this.bottomCy,
      this.bottomRx,
      this.bottomRy,
      this.bottomH,
    );
  }

  private drawTopTier(ctx: CanvasRenderingContext2D): void {
    this.drawTier(ctx, this.topCx, this.topCy, this.topRx, this.topRy, this.topH);
  }

  // Draws a chocolate-frosted layered tier:
  //   1. Layered side (sponge / pink cream / sponge / pink cream / sponge)
  //   2. Bottom rounded cap (matches lowest sponge stripe)
  //   3. Chocolate frosting band along the top portion of the side
  //   4. Wavy chocolate drips hanging down from frosting band
  //   5. Chocolate top surface (ellipse) with a subtle highlight crescent
  //   6. 1px silhouette outline on left / right edges of the side
  private drawTier(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    h: number,
  ): void {
    const topY = cy - ry;          // top rim y (= top of side rectangle)
    const bottomY = cy + h;        // bottom rim y (= where rounded cap is centered)
    const sideLeft = cx - rx;
    const sideRight = cx + rx;
    const sideW = rx * 2;

    // --- 1. Layered side ---
    // The "side" is the rect from (sideLeft, cy) → (sideRight, cy + h).
    // Bottom ~70% of the side is the layered sponge/pink cross-section.
    // Top ~30% will be covered by chocolate frosting band (drawn after).
    this.drawLayeredSide(ctx, sideLeft, cy, sideW, h);

    // --- 2. Bottom rounded cap (matches bottom sponge color) ---
    this.fillEllipse(ctx, cx, bottomY, rx, ry, COLOR_SPONGE);
    // Underside crescent shadow
    this.fillEllipseArc(ctx, cx, bottomY + 1, rx - 1, ry, COLOR_SPONGE_SHADOW, "bottom");

    // --- 3. Chocolate frosting band (covers top portion of side) ---
    // Band height ≈ 35% of tier h, min 3px.
    const bandH = Math.max(3, Math.floor(h * 0.35));
    ctx.fillStyle = COLOR_CHOC;
    ctx.fillRect(sideLeft, cy, sideW, bandH);
    // Band highlight: thin lighter band 1px below the rim
    ctx.fillStyle = COLOR_CHOC_HIGHLIGHT;
    ctx.fillRect(sideLeft + 1, cy + 1, sideW - 2, 1);
    // Band bottom shadow: 1px line where band meets layered side
    ctx.fillStyle = COLOR_CHOC_SHADOW;
    ctx.fillRect(sideLeft, cy + bandH - 1, sideW, 1);

    // --- 4. Wavy chocolate drips hanging below the frosting band ---
    this.drawDrips(ctx, cx, cy + bandH, rx);

    // --- 5. Chocolate top surface ---
    this.fillEllipse(ctx, cx, topY + ry, rx, ry, COLOR_CHOC);
    // Top highlight crescent — subtle lighter brown
    this.fillEllipseArc(
      ctx,
      cx,
      topY + ry - 1,
      rx - 2,
      Math.max(1, ry - 1),
      COLOR_CHOC_HIGHLIGHT,
      "top",
    );
    // (Removed back-rim shadow line — after pink repalette it read as a hard red bar.)

    // --- 6. Silhouette outline on left/right edges of side ---
    ctx.fillStyle = COLOR_OUTLINE;
    ctx.fillRect(sideLeft, cy, 1, h);
    ctx.fillRect(sideRight - 1, cy, 1, h);
  }

  // Layered cross-section: alternating horizontal stripes of sponge and pink cream.
  // Pattern from top → bottom: sponge | pink | sponge | pink | sponge.
  // Heights are roughly proportional to h.
  private drawLayeredSide(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    // Stripe weights (relative): sponge 3 / pink 1 / sponge 3 / pink 1 / sponge 3
    const weights = [3, 1, 3, 1, 3];
    const colors = [
      COLOR_SPONGE,
      COLOR_CREAM_PINK,
      COLOR_SPONGE,
      COLOR_CREAM_PINK,
      COLOR_SPONGE,
    ];
    const shadowColors = [
      COLOR_SPONGE_SHADOW,
      COLOR_CREAM_PINK_SHADOW,
      COLOR_SPONGE_SHADOW,
      COLOR_CREAM_PINK_SHADOW,
      COLOR_SPONGE_SHADOW,
    ];
    const totalWeight = weights.reduce((a, b) => a + b, 0);

    // Compute integer stripe heights that sum to h.
    const heights: number[] = [];
    let allocated = 0;
    for (let i = 0; i < weights.length; i++) {
      if (i === weights.length - 1) {
        heights.push(h - allocated);
      } else {
        const sh = Math.max(1, Math.floor((weights[i]! / totalWeight) * h));
        heights.push(sh);
        allocated += sh;
      }
    }

    let cursor = y;
    for (let i = 0; i < heights.length; i++) {
      const sh = heights[i]!;
      if (sh <= 0) continue;
      ctx.fillStyle = colors[i]!;
      ctx.fillRect(x, cursor, w, sh);
      // 1-px shadow line under each stripe for layer separation (except last)
      if (i < heights.length - 1 && sh >= 2) {
        ctx.fillStyle = shadowColors[i]!;
        ctx.fillRect(x, cursor + sh - 1, w, 1);
      }
      cursor += sh;
    }

    // Subtle left-edge vertical shading on the whole side (deeper shadow)
    ctx.fillStyle = COLOR_SPONGE_SHADOW;
    ctx.fillRect(x + 1, y, 1, h);
  }

  // Uneven wavy chocolate drips along the bottom of the frosting band.
  // Each drip is a 1-2 px wide vertical column of variable length, with a small
  // rounded tip (drop) at the bottom. Uses pseudo-random but deterministic
  // lengths based on x position.
  private drawDrips(
    ctx: CanvasRenderingContext2D,
    cx: number,
    bandBottomY: number,
    rx: number,
  ): void {
    const sideLeft = cx - rx;
    const sideRight = cx + rx;
    // Aim for ~1 drip every 2 logical px, with some gaps.
    let x = sideLeft + 1;
    let i = 0;
    while (x < sideRight - 1) {
      // Pseudo-random length 1..5 based on i and x (deterministic per cake).
      const seed = (i * 7 + x * 3 + rx) % 11;
      // Distribution: ~30% short (1px), ~40% medium (2-3px), ~30% long (4-5px)
      let len: number;
      if (seed < 3) len = 1;
      else if (seed < 7) len = 2 + (seed % 2); // 2 or 3
      else len = 4 + (seed % 2);                // 4 or 5

      // Drip body — 1px wide. Some wider 2px columns for the longer drips.
      const wide = len >= 4 && seed % 2 === 0;
      ctx.fillStyle = COLOR_CHOC;
      if (wide) {
        ctx.fillRect(x, bandBottomY, 2, len);
        // Subtle highlight on the left edge of wide drip
        ctx.fillStyle = COLOR_CHOC_HIGHLIGHT;
        ctx.fillRect(x, bandBottomY, 1, 1);
        ctx.fillStyle = COLOR_CHOC;
      } else {
        ctx.fillRect(x, bandBottomY, 1, len);
      }

      // Rounded tip (drop) at the bottom: a 1-px shadow dot just below.
      ctx.fillStyle = COLOR_CHOC_SHADOW;
      ctx.fillRect(x, bandBottomY + len, wide ? 2 : 1, 1);

      // Advance — gap of 1-2 px between drips to make spacing uneven.
      const gap = 1 + (seed % 2);
      x += (wide ? 2 : 1) + gap;
      i++;
    }
  }

  // Cherry mounds on top tier — wedding-cake-style: 4-stripe stack + cherry on top.
  private drawCherryMounds(ctx: CanvasRenderingContext2D): void {
    for (const c of this.cherries) this.drawCherryMound(ctx, c.x, c.y, c.stemDir);
  }

  private drawCherryMound(
    ctx: CanvasRenderingContext2D,
    x: number,
    baseY: number,
    stemDir: -1 | 0 | 1,
  ): void {
    // Pyramid stack: 4 stripes tapering up (white / soft beige / white / soft beige)
    const stripes = [
      { w: 9, h: 2, color: "#ffffff" },
      { w: 7, h: 2, color: "#e8e0d0" },
      { w: 5, h: 2, color: "#ffffff" },
      { w: 4, h: 1, color: "#e8e0d0" },
    ];
    let curY = baseY;
    for (const s of stripes) {
      const left = x - Math.floor(s.w / 2);
      const top = curY - s.h;
      // Fill
      ctx.fillStyle = s.color;
      ctx.fillRect(left, top, s.w, s.h);
      // Outline on side edges
      ctx.fillStyle = COLOR_OUTLINE;
      ctx.fillRect(left - 1, top, 1, s.h);
      ctx.fillRect(left + s.w, top, 1, s.h);
      // Bottom outline on each stripe (creates the layered separation)
      if (s !== stripes[stripes.length - 1]) {
        ctx.fillRect(left - 1, curY, s.w + 2, 1);
      }
      curY -= s.h;
    }
    // Stem
    ctx.fillStyle = COLOR_CHERRY_STEM;
    ctx.fillRect(x + stemDir, curY - 2, 1, 1);
    ctx.fillRect(x, curY - 1, 1, 1);

    // Cherry — bigger 5x4 chunky (centered on x, sits at curY)
    const cyTop = curY;
    // Outline
    ctx.fillStyle = COLOR_OUTLINE;
    ctx.fillRect(x - 1, cyTop, 5, 1);
    ctx.fillRect(x - 1, cyTop + 3, 5, 1);
    ctx.fillRect(x - 2, cyTop + 1, 1, 2);
    ctx.fillRect(x + 4, cyTop + 1, 1, 2);
    // Body
    ctx.fillStyle = COLOR_CHERRY;
    ctx.fillRect(x - 1, cyTop + 1, 5, 2);
    ctx.fillRect(x, cyTop, 3, 1);
    ctx.fillRect(x, cyTop + 3, 3, 1);
    // Shadow on lower-right
    ctx.fillStyle = COLOR_CHERRY_SHADOW;
    ctx.fillRect(x + 2, cyTop + 2, 2, 1);
    ctx.fillRect(x + 1, cyTop + 3, 2, 1);
    // Highlight
    ctx.fillStyle = COLOR_CHERRY_HIGHLIGHT;
    ctx.fillRect(x, cyTop + 1, 1, 1);
  }

  private drawCherries(ctx: CanvasRenderingContext2D): void {
    this.drawCherriesArray(ctx, this.cherries);
  }

  // Cherries — chunky red blob with outline + small green stem. Used by both tiers.
  private drawCherriesArray(
    ctx: CanvasRenderingContext2D,
    arr: ReadonlyArray<{ x: number; y: number; stemDir: -1 | 0 | 1 }>,
  ): void {
    for (const c of arr) {
      // Stem first (drawn behind body) — small 2-pixel green stem curving away
      ctx.fillStyle = COLOR_CHERRY_STEM;
      ctx.fillRect(c.x + c.stemDir, c.y - 3, 1, 1);
      ctx.fillRect(c.x, c.y - 2, 1, 1);

      // Outline (1 px dark border around the cherry — makes them pop)
      ctx.fillStyle = COLOR_OUTLINE;
      ctx.fillRect(c.x - 1, c.y, 5, 1);     // top row
      ctx.fillRect(c.x - 1, c.y + 3, 5, 1); // bottom row
      ctx.fillRect(c.x - 2, c.y + 1, 1, 2); // left
      ctx.fillRect(c.x + 4, c.y + 1, 1, 2); // right
      // (corners notched implicitly by not extending)

      // Body — 4×2 + 2×1 + 1×1 stepped circle (chunky cherry)
      ctx.fillStyle = COLOR_CHERRY;
      ctx.fillRect(c.x - 1, c.y + 1, 5, 2); // wide middle band
      ctx.fillRect(c.x, c.y, 3, 1);          // top band
      ctx.fillRect(c.x, c.y + 3, 3, 1);      // bottom band

      // Dark shadow on bottom-right quadrant
      ctx.fillStyle = COLOR_CHERRY_SHADOW;
      ctx.fillRect(c.x + 2, c.y + 2, 2, 1);
      ctx.fillRect(c.x + 1, c.y + 3, 2, 1);

      // White highlight on top-left (single bright pixel)
      ctx.fillStyle = COLOR_CHERRY_HIGHLIGHT;
      ctx.fillRect(c.x, c.y + 1, 1, 1);
    }
  }

  private drawCandlesAndFlames(ctx: CanvasRenderingContext2D, t: number): void {
    const frame = Math.floor(t / FLAME_FRAME_MS);
    for (let i = 0; i < this.candles.length; i++) {
      const c = this.candles[i]!;
      const isLit = this.lit[i];
      const isSmoking = this.smokes.has(i);
      // Numeral mode keeps the candle drawn even after blow (just no flame), to anchor the number
      const drawBody = isLit || isSmoking || this.isNumeral;
      if (!drawBody) continue;
      if (this.isNumeral) this.drawNumeralCandle(ctx, c);
      else this.drawCandle(ctx, c);
      if (isLit) {
        const localFrame = (frame + Math.floor(c.flickerOffset / 200)) % 2;
        if (this.isNumeral) this.drawBigFlame(ctx, c.x, c.y - this.candleH - 1, localFrame);
        else this.drawFlame(ctx, c.x, c.y - 1, localFrame);
      }
    }
    // Background-number is drawn separately at the top of render() (behind cake).
  }

  // Big Mario-style age number rendered as the cake's BACKGROUND (behind plate + cake).
  // Pre-blow: numberLabel ("38"). Post-blow: crossfades to numberLabelAfter ("39") over ~1.2s.
  // Per-digit color cycle (red/yellow/green/blue keyed by the digit's value) + thick black
  // outline + drop shadow for the chunky cartoon look.
  private drawBackgroundNumber(
    ctx: CanvasRenderingContext2D,
    t: number,
  ): void {
    if (!this.isNumeral) return;
    const FADE_MS = 600;
    let alphaBefore = 1;
    let alphaAfter = 0;

    if (this.blewAt != null) {
      const elapsed = t - this.blewAt;
      if (elapsed < FADE_MS) {
        alphaBefore = 1 - elapsed / FADE_MS;
      } else if (elapsed < FADE_MS * 2) {
        alphaBefore = 0;
        alphaAfter = (elapsed - FADE_MS) / FADE_MS;
      } else {
        alphaBefore = 0;
        alphaAfter = 1;
      }
    }

    // Switch to device-px transform for crisp anti-aliased text.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    const cx = this.size / 2;
    const cy = this.size * 0.42;
    if (alphaBefore > 0.01) {
      ctx.globalAlpha = alphaBefore;
      this.drawMarioText(ctx, this.numberLabel, cx, cy);
    }
    if (alphaAfter > 0.01) {
      ctx.globalAlpha = alphaAfter;
      this.drawMarioText(ctx, this.numberLabelAfter, cx, cy);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    // restore() rolls back the transform; render() set PX-transform before this call,
    // and the next drawPlate() will run with that PX transform.
    ctx.imageSmoothingEnabled = false;
  }

  // Chunky Mario-style digits: per-digit color, thick black outline, drop shadow.
  private drawMarioText(
    ctx: CanvasRenderingContext2D,
    text: string,
    cx: number,
    cy: number,
  ): void {
    const SIZE = 260;
    const SHADOW_OFFSET = 10;
    const OUTLINE_WIDTH = 16;
    const LETTER_SPACING = 6;
    const SHADOW = "#1a0a04";
    const OUTLINE = "#1a0a04";
    // Mario-ish primary palette keyed by digit value.
    const DIGIT_COLOR: Record<string, string> = {
      "0": "#e63d3d", "1": "#f7d030", "2": "#42b54e", "3": "#3f86e6",
      "4": "#e63d3d", "5": "#f7d030", "6": "#42b54e", "7": "#3f86e6",
      "8": "#e63d3d", "9": "#f7d030",
    };

    ctx.font = `900 ${SIZE}px Impact, "Arial Black", "Helvetica Neue", system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;

    // Measure each char width once.
    const widths: number[] = [];
    let totalW = 0;
    for (const ch of text) {
      const w = ctx.measureText(ch).width;
      widths.push(w);
      totalW += w;
    }
    totalW += (text.length - 1) * LETTER_SPACING;

    let x = cx - totalW / 2;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      const color = DIGIT_COLOR[ch] ?? "#e63d3d";
      // Drop shadow (offset down-right, no outline)
      ctx.fillStyle = SHADOW;
      ctx.fillText(ch, x + SHADOW_OFFSET, cy + SHADOW_OFFSET);
      // Thick black outline
      ctx.lineWidth = OUTLINE_WIDTH;
      ctx.strokeStyle = OUTLINE;
      ctx.strokeText(ch, x, cy);
      // Color fill
      ctx.fillStyle = color;
      ctx.fillText(ch, x, cy);
      x += (widths[i] ?? 0) + LETTER_SPACING;
    }
  }

  // Draws DIGIT_FONT text scaled up by `scale`. Each glyph cell becomes scale × scale logical px.
  // Text is centered on (cx, cy).
  private drawScaledPixelText(
    ctx: CanvasRenderingContext2D,
    text: string,
    cx: number,
    cy: number,
    scale: number,
    color: string,
  ): void {
    const cellW = DIGIT_W * scale;
    const cellH = DIGIT_H * scale;
    const gapPx = DIGIT_SPACING * scale;
    const totalW = text.length * cellW + (text.length - 1) * gapPx;
    const startX = cx - Math.floor(totalW / 2);
    const startY = cy - Math.floor(cellH / 2);
    ctx.fillStyle = color;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      const glyph = DIGIT_FONT[ch];
      if (!glyph) continue;
      const left = startX + i * (cellW + gapPx);
      for (let row = 0; row < DIGIT_H; row++) {
        const line = glyph[row]!;
        for (let col = 0; col < DIGIT_W; col++) {
          if (line[col] === "X")
            ctx.fillRect(left + col * scale, startY + row * scale, scale, scale);
        }
      }
    }
  }

  // Thin tall candle in numeral mode. Body is striped cream/pink like a classic
  // birthday candle; the actual age number floats above (drawPixelText).
  private drawNumeralCandle(ctx: CanvasRenderingContext2D, c: CandlePos): void {
    const w = this.candleW;   // 5
    const h = this.candleH;   // 22
    const left = c.x - Math.floor(w / 2);
    const top = c.y - h;

    // Body
    ctx.fillStyle = c.bodyColor; // cream
    ctx.fillRect(left, top, w, h);

    // Classic candy-stripe diagonal: 3 pink bands across the cream body
    ctx.fillStyle = c.stripeColor;
    for (let stripe = 0; stripe < 3; stripe++) {
      const y0 = top + 3 + stripe * 7;
      ctx.fillRect(left, y0, w, 1);
      if (y0 + 1 < top + h) ctx.fillRect(left, y0 + 1, w - 1, 1);
    }

    // Left edge soft shadow, right edge subtle highlight
    ctx.fillStyle = "#e8c898";
    ctx.fillRect(left, top + 1, 1, h - 1);
    ctx.fillStyle = COLOR_CREAM_HIGHLIGHT;
    ctx.fillRect(left + w - 1, top, 1, 1);

    // 1px outline at base for definition
    ctx.fillStyle = COLOR_OUTLINE;
    ctx.fillRect(left, top + h - 1, w, 1);

    // Wick — 1px × 2px tall on top center
    ctx.fillStyle = WICK;
    ctx.fillRect(c.x, top - 2, 1, 2);
  }

  // 2× larger 2-frame flame for the numeral candle. Bigger drama on a thin candle.
  private drawBigFlame(
    ctx: CanvasRenderingContext2D,
    x: number,
    wickTop: number,
    frame: number,
  ): void {
    const tall = frame === 0;
    const outerColor = tall ? FLAME_OUTER_A : FLAME_OUTER_B;
    const innerColor = tall ? FLAME_INNER_A : FLAME_INNER_B;
    // Subtle dark outline for the flame so it pops on light surfaces too
    const outline = COLOR_OUTLINE;

    if (tall) {
      // Outer: tall teardrop ~9 wide × ~11 tall
      ctx.fillStyle = outline;
      // base oval outline
      ctx.fillRect(x - 4, wickTop - 7, 9, 1);
      ctx.fillRect(x - 5, wickTop - 6, 1, 5);
      ctx.fillRect(x + 4, wickTop - 6, 1, 5);
      ctx.fillRect(x - 4, wickTop - 1, 9, 1);
      // top taper
      ctx.fillRect(x - 1, wickTop - 9, 3, 1);
      ctx.fillRect(x - 2, wickTop - 8, 5, 1);
      ctx.fillRect(x, wickTop - 11, 1, 2);
      ctx.fillRect(x - 1, wickTop - 10, 3, 1);

      ctx.fillStyle = outerColor;
      ctx.fillRect(x - 3, wickTop - 6, 7, 5);   // base body
      ctx.fillRect(x - 4, wickTop - 5, 9, 3);   // widest band
      ctx.fillRect(x - 1, wickTop - 8, 3, 2);   // mid taper
      ctx.fillRect(x, wickTop - 10, 1, 2);      // tip

      // Inner glow core
      ctx.fillStyle = innerColor;
      ctx.fillRect(x - 1, wickTop - 5, 3, 4);
      ctx.fillRect(x, wickTop - 7, 1, 2);
    } else {
      // Short variant (squatter, fewer rows)
      ctx.fillStyle = outline;
      ctx.fillRect(x - 4, wickTop - 5, 9, 1);
      ctx.fillRect(x - 5, wickTop - 4, 1, 3);
      ctx.fillRect(x + 4, wickTop - 4, 1, 3);
      ctx.fillRect(x - 4, wickTop - 1, 9, 1);
      ctx.fillRect(x - 1, wickTop - 7, 3, 1);
      ctx.fillRect(x - 2, wickTop - 6, 5, 1);
      ctx.fillRect(x, wickTop - 8, 1, 1);

      ctx.fillStyle = outerColor;
      ctx.fillRect(x - 3, wickTop - 4, 7, 3);
      ctx.fillRect(x - 4, wickTop - 3, 9, 1);
      ctx.fillRect(x - 1, wickTop - 6, 3, 2);
      ctx.fillRect(x, wickTop - 7, 1, 1);

      ctx.fillStyle = innerColor;
      ctx.fillRect(x - 1, wickTop - 4, 3, 3);
      ctx.fillRect(x, wickTop - 6, 1, 2);
    }
  }

  private drawCandle(ctx: CanvasRenderingContext2D, c: CandlePos): void {
    const w = this.candleW;
    const h = this.candleH;
    const left = c.x - Math.floor(w / 2);
    const top = c.y - h;
    // body
    ctx.fillStyle = c.bodyColor;
    ctx.fillRect(left, top, w, h);
    // left shadow
    ctx.fillStyle = c.stripeColor;
    ctx.fillRect(left, top, 1, h);
    // bottom shadow
    ctx.fillRect(left, top + h - 1, w, 1);
    // diagonal stripe (subtle)
    ctx.fillRect(left + w - 1, top + 2, 1, 1);
    ctx.fillRect(left + w - 2, top + 4, 1, 1);
    // wick
    ctx.fillStyle = WICK;
    ctx.fillRect(left + Math.floor(w / 2), top - 1, 1, 1);
  }

  private drawFlame(
    ctx: CanvasRenderingContext2D,
    x: number,
    wickTop: number,
    frame: number,
  ): void {
    // Two-frame flame: slight shape change.
    // Frame 0: taller, narrower. Frame 1: shorter, fatter.
    const tall = frame === 0;
    const outerTop = wickTop - (tall ? 4 : 3);
    const outerColor = tall ? FLAME_OUTER_A : FLAME_OUTER_B;
    const innerColor = tall ? FLAME_INNER_A : FLAME_INNER_B;

    // outer flame: diamond-ish 3px wide
    ctx.fillStyle = outerColor;
    // body
    ctx.fillRect(x - 1, outerTop + 1, 3, tall ? 3 : 2);
    // tip
    ctx.fillRect(x, outerTop, 1, 1);
    // base taper
    ctx.fillRect(x, outerTop + (tall ? 4 : 3), 1, 1);

    // inner flame core
    ctx.fillStyle = innerColor;
    ctx.fillRect(x, outerTop + 1, 1, tall ? 2 : 1);
  }

  private drawSmoke(ctx: CanvasRenderingContext2D, t: number): void {
    if (this.smokes.size === 0) return;
    const finished: number[] = [];
    this.smokes.forEach((s, idx) => {
      const age = t - s.startTime;
      if (age >= SMOKE_DURATION_MS) {
        finished.push(idx);
        return;
      }
      const p = age / SMOKE_DURATION_MS; // 0..1
      // 3 frames over the duration
      const frame = Math.min(2, Math.floor(p * 3));
      // alpha fades 1 -> 0
      const alpha = 1 - p;
      const rise = Math.floor(p * 6); // rises ~6 logical px
      const drift = Math.floor(Math.sin(p * Math.PI * 2 + s.seed) * 1);
      ctx.globalAlpha = alpha * 0.7;
      ctx.fillStyle = SMOKE_COLOR;
      const sx = s.x + drift;
      const sy = s.y - rise;
      this.drawSmokeFrame(ctx, sx, sy, frame);
    });
    ctx.globalAlpha = 1;
    for (const idx of finished) this.smokes.delete(idx);
  }

  private drawSmokeFrame(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    frame: number,
  ): void {
    // 3 puff shapes: small dot → curled wisp → dispersed
    if (frame === 0) {
      ctx.fillRect(x, y, 1, 1);
      ctx.fillRect(x - 1, y - 1, 1, 1);
    } else if (frame === 1) {
      ctx.fillRect(x, y, 1, 1);
      ctx.fillRect(x - 1, y - 1, 1, 1);
      ctx.fillRect(x + 1, y - 2, 1, 1);
      ctx.fillRect(x, y - 3, 1, 1);
    } else {
      ctx.fillRect(x - 1, y, 1, 1);
      ctx.fillRect(x + 1, y - 1, 1, 1);
      ctx.fillRect(x, y - 2, 1, 1);
      ctx.fillRect(x + 2, y - 3, 1, 1);
    }
  }

  // Filled axis-aligned ellipse, pixel-art style (no antialiasing).
  // Uses midpoint scan: for each y, compute x-extent and fillRect.
  private fillEllipse(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    color: string,
  ): void {
    if (rx < 1 || ry < 1) return;
    ctx.fillStyle = color;
    for (let dy = -ry; dy <= ry; dy++) {
      const t = dy / ry;
      const dx = Math.floor(rx * Math.sqrt(Math.max(0, 1 - t * t)));
      ctx.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1);
    }
  }

  // Fill only the top or bottom half of an ellipse — used for crescent highlights/shadows.
  private fillEllipseArc(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    color: string,
    half: "top" | "bottom",
  ): void {
    if (rx < 1 || ry < 1) return;
    ctx.fillStyle = color;
    const from = half === "top" ? -ry : 0;
    const to = half === "top" ? 0 : ry;
    for (let dy = from; dy <= to; dy++) {
      const tt = dy / ry;
      const dx = Math.floor(rx * Math.sqrt(Math.max(0, 1 - tt * tt)));
      ctx.fillRect(cx - dx, cy + dy, dx * 2 + 1, 1);
    }
  }

  blowOut(): boolean {
    // Collect indices of still-lit candles
    const litIdx: number[] = [];
    for (let i = 0; i < this.lit.length; i++) {
      if (this.lit[i]) litIdx.push(i);
    }
    if (litIdx.length === 0) return false;
    const pick = litIdx[Math.floor(Math.random() * litIdx.length)]!;
    this.lit[pick] = false;
    const now = performance.now();
    if (this.isNumeral && this.blewAt == null) this.blewAt = now;
    const c = this.candles[pick]!;
    this.smokes.set(pick, {
      startTime: now,
      x: c.x,
      y: c.y - this.candleH - 1,
      seed: (pick * 1.37) % (Math.PI * 2),
    });
    return true;
  }

  reset(): void {
    for (let i = 0; i < this.lit.length; i++) this.lit[i] = true;
    this.smokes.clear();
    this.blewAt = null;
  }

  get allOut(): boolean {
    if (this.smokes.size > 0) return false;
    for (let i = 0; i < this.lit.length; i++) {
      if (this.lit[i]) return false;
    }
    return true;
  }

  get litCount(): number {
    let n = 0;
    for (let i = 0; i < this.lit.length; i++) {
      if (this.lit[i]) n++;
    }
    return n;
  }
}
