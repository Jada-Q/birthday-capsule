// Cartoon-style birthday cake renderer.
//
// White cylinder body with thick black outline + mint-green frosting + wavy
// drips + cherry mounds + heart balloons floating around. All drawn with
// canvas paths (bezier + arcs) at full resolution with anti-aliasing. The
// big "38" / "39" age number is rendered as the cake's background.

export interface CakeOptions {
  candleCount: number;
  size: number;
  /** Age shown BEFORE blowing (e.g. "38" — the year you're leaving). Forces candleCount → 1. */
  numberLabel?: string;
  /** Age that appears AFTER blowing (e.g. "39"). Crossfades in. Defaults to numberLabel. */
  numberLabelAfter?: string;
}

interface CandlePos {
  x: number;
  y: number; // candle BASE (bottom of candle, where it touches cake)
}

interface SmokeState {
  startTime: number;
  x: number;
  y: number; // wick tip
  seed: number;
}

const SMOKE_DURATION_MS = 1400;
const FLAME_FRAME_MS = 200;

// --- Cartoon palette (flat fills + heavy black outlines) ---
const OUTLINE = "#1a1410";
const OUTLINE_LIGHT = "#2c2418";

// Body
const BODY_FILL = "#fbf8ef";
const BODY_SHADOW = "#e8e0cf";

// Mint frosting
const MINT = "#bee0c4";
const MINT_SHADOW = "#88b89a";
const MINT_HIGHLIGHT = "#dceedf";

// Cherry
const CHERRY = "#c8302a";
const CHERRY_SHADOW = "#882018";
const CHERRY_HIGHLIGHT = "#ffd0c8";
const CHERRY_STEM = "#3a5818";

// Mound stripes
const MOUND_LIGHT = "#ffffff";
const MOUND_DARK = "#e6dfd2";

// Hearts
const HEART = "#f6c0d0";
const HEART_SHADOW = "#d09aae";
const HEART_HIGHLIGHT = "#ffffff";
const HEART_STRING = "#4a4a4a";

// Plate
const PLATE = "#eaeae6";
const PLATE_SHADOW = "#b8b8b0";

// Candle (white with mint+pink stripes)
const CANDLE_BODY = "#fafaf5";
const CANDLE_STRIPE_A = "#f6c0d0";
const CANDLE_STRIPE_B = "#bee0c4";
const CANDLE_OUTLINE = "#1a1410";

// Flame (radial-gradient shades)
const FLAME_OUTER = "#ff7a20";
const FLAME_MID = "#ffb040";
const FLAME_INNER = "#fff4a0";

// Background number color cycle
const DIGIT_COLOR: Record<string, string> = {
  "0": "#e63d3d", "1": "#f7d030", "2": "#42b54e", "3": "#3f86e6",
  "4": "#e63d3d", "5": "#f7d030", "6": "#42b54e", "7": "#3f86e6",
  "8": "#e63d3d", "9": "#f7d030",
};

export class Cake {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private readonly candleCount: number;
  private readonly lit: boolean[];
  private readonly smokes: Map<number, SmokeState>;

  private readonly isNumeral: boolean;
  private readonly numberLabel: string;
  private readonly numberLabelAfter: string;
  private blewAt: number | null = null;

  // Geometry (device px). Computed in constructor.
  private readonly bodyCx: number;
  private readonly bodyTopY: number;
  private readonly bodyBottomY: number;
  private readonly bodyRx: number;
  private readonly capRy: number;       // top/bottom ellipse vertical radius
  private readonly mintBandH: number;   // how far mint extends down from top rim
  private readonly candle: CandlePos;
  private readonly candleW: number;
  private readonly candleH: number;
  private readonly cherryMounds: ReadonlyArray<{ x: number; y: number }>;
  private readonly hearts: ReadonlyArray<{
    x: number; y: number; size: number; tilt: number; stringTo: { x: number; y: number };
  }>;
  private readonly dripSeeds: ReadonlyArray<{ t: number; w: number; h: number }>;

  constructor(canvas: HTMLCanvasElement, opts: CakeOptions) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("cake: 2d context unavailable");
    this.ctx = ctx;
    this.size = opts.size;
    canvas.width = opts.size;
    canvas.height = opts.size;
    ctx.imageSmoothingEnabled = true;

    this.isNumeral = !!opts.numberLabel;
    this.numberLabel = opts.numberLabel ?? "";
    this.numberLabelAfter = opts.numberLabelAfter ?? this.numberLabel;
    this.candleCount = this.isNumeral ? 1 : opts.candleCount;
    this.lit = new Array(this.candleCount).fill(true);
    this.smokes = new Map();

    const S = opts.size;
    this.bodyCx = S / 2;
    this.bodyTopY = S * 0.50;       // top rim of cylinder body
    this.bodyBottomY = S * 0.86;    // bottom rim of cylinder
    this.bodyRx = S * 0.25;          // body half-width
    this.capRy = S * 0.045;          // ellipse cap vertical radius
    this.mintBandH = S * 0.10;       // mint extends down from top rim by this

    this.candleW = S * 0.022;
    this.candleH = S * 0.16;
    this.candle = {
      x: this.bodyCx,
      y: this.bodyTopY - this.capRy - 2,  // candle base sits on back-rim of top ellipse
    };

    // 3 cherry mounds: distributed on the visible top ellipse surface
    this.cherryMounds = [
      { x: this.bodyCx - this.bodyRx * 0.55, y: this.bodyTopY - this.capRy * 0.2 },
      { x: this.bodyCx + this.bodyRx * 0.55, y: this.bodyTopY - this.capRy * 0.2 },
      { x: this.bodyCx,                       y: this.bodyTopY + this.capRy * 0.55 },
    ];

    // 3 heart balloons floating around. Each with a curved string anchored to cake.
    this.hearts = [
      {
        x: this.bodyCx + S * 0.18, y: S * 0.18, size: S * 0.06, tilt: -0.15,
        stringTo: { x: this.bodyCx + this.bodyRx * 0.4, y: this.bodyTopY + this.capRy * 0.3 },
      },
      {
        x: this.bodyCx - S * 0.22, y: S * 0.25, size: S * 0.05, tilt: 0.20,
        stringTo: { x: this.bodyCx - this.bodyRx * 0.3, y: this.bodyTopY + this.capRy * 0.3 },
      },
      {
        x: this.bodyCx + S * 0.04, y: S * 0.08, size: S * 0.055, tilt: 0.05,
        stringTo: { x: this.bodyCx + this.bodyRx * 0.1, y: this.bodyTopY + this.capRy * 0.4 },
      },
    ];

    // Pre-compute deterministic drip shapes (so they don't reshape per frame).
    // t = 0..1 position along the rim; w = width factor; h = length factor.
    const dripSeeds: { t: number; w: number; h: number }[] = [];
    const dripPoses = [0.10, 0.22, 0.37, 0.50, 0.63, 0.78, 0.90];
    const dripDepths = [0.7, 1.0, 0.55, 1.2, 0.8, 1.05, 0.65];
    const dripWidths = [0.8, 1.0, 0.9, 1.15, 0.85, 1.0, 0.95];
    for (let i = 0; i < dripPoses.length; i++) {
      dripSeeds.push({ t: dripPoses[i]!, w: dripWidths[i]!, h: dripDepths[i]! });
    }
    this.dripSeeds = dripSeeds;
  }

  render(t: number): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.imageSmoothingEnabled = true;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // Background age number (behind everything)
    this.drawBackgroundNumber(t);

    // Plate
    this.drawPlate();

    // Cake body (with mint frosting + drips)
    this.drawCakeBody();

    // Cherry mounds on top tier
    for (const m of this.cherryMounds) this.drawCherryMound(m.x, m.y);

    // Heart balloons (drawn over cake; string goes from cake → balloon)
    for (const h of this.hearts) this.drawHeartBalloon(h);

    // Candle
    if (this.isNumeral) {
      const bodyDrawn = this.lit[0] || this.smokes.has(0) || true; // always show in numeral mode
      if (bodyDrawn) this.drawCandle();
      if (this.lit[0]) this.drawFlame(t);
    }

    // Smoke
    this.drawSmoke(t);
  }

  // ---------- BACKGROUND NUMBER (Mario style, behind cake) ----------
  private drawBackgroundNumber(t: number): void {
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
    const ctx = this.ctx;
    const cx = this.size / 2;
    const cy = this.size * 0.30; // upper area, above cake
    if (alphaBefore > 0.01) {
      ctx.globalAlpha = alphaBefore;
      this.drawMarioText(this.numberLabel, cx, cy);
    }
    if (alphaAfter > 0.01) {
      ctx.globalAlpha = alphaAfter;
      this.drawMarioText(this.numberLabelAfter, cx, cy);
    }
    ctx.globalAlpha = 1;
  }

  private drawMarioText(text: string, cx: number, cy: number): void {
    const ctx = this.ctx;
    const SIZE = this.size * 0.34;
    const SHADOW_OFFSET = SIZE * 0.05;
    const OUTLINE_WIDTH = SIZE * 0.07;
    const LETTER_SPACING = SIZE * 0.02;
    const SHADOW = "#1a0a04";
    const STROKE = "#1a0a04";

    ctx.font = `900 ${SIZE}px Impact, "Arial Black", "Helvetica Neue", system-ui, sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;

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
      ctx.fillStyle = SHADOW;
      ctx.fillText(ch, x + SHADOW_OFFSET, cy + SHADOW_OFFSET);
      ctx.lineWidth = OUTLINE_WIDTH;
      ctx.strokeStyle = STROKE;
      ctx.strokeText(ch, x, cy);
      ctx.fillStyle = color;
      ctx.fillText(ch, x, cy);
      x += (widths[i] ?? 0) + LETTER_SPACING;
    }
  }

  // ---------- PLATE ----------
  private drawPlate(): void {
    const ctx = this.ctx;
    const cy = this.bodyBottomY + this.capRy * 0.8;
    const rx = this.bodyRx * 1.18;
    const ry = this.capRy * 1.05;
    ctx.lineWidth = 5;
    ctx.strokeStyle = OUTLINE;

    // Bottom edge (visible underside of plate)
    ctx.beginPath();
    ctx.ellipse(this.bodyCx, cy + 4, rx, ry * 0.6, 0, 0, Math.PI);
    ctx.fillStyle = PLATE_SHADOW;
    ctx.fill();
    ctx.stroke();

    // Top plate (flat ellipse)
    ctx.beginPath();
    ctx.ellipse(this.bodyCx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = PLATE;
    ctx.fill();
    ctx.stroke();
  }

  // ---------- CAKE BODY (white cylinder + mint frosting + drips) ----------
  private drawCakeBody(): void {
    const ctx = this.ctx;
    const cx = this.bodyCx;
    const rx = this.bodyRx;
    const topY = this.bodyTopY;
    const botY = this.bodyBottomY;
    const ry = this.capRy;

    ctx.lineWidth = 6;
    ctx.strokeStyle = OUTLINE;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // 1. Cylinder body silhouette: left vertical + bottom ellipse front-half + right vertical + top ellipse
    ctx.beginPath();
    ctx.moveTo(cx - rx, topY);
    ctx.lineTo(cx - rx, botY);
    ctx.ellipse(cx, botY, rx, ry, 0, Math.PI, 0, true); // front half of bottom ellipse (curving down)
    // Wait — to draw the visible bottom front curve: arc from (cx-rx, botY) through (cx, botY+ry) to (cx+rx, botY).
    // ctx.ellipse with anticlockwise from Math.PI to 0 traces top half. We want bottom half.
    // Reset and use a cleaner approach:
    ctx.closePath();
    // (clearing the above sketch — proper path below)

    // Proper body silhouette as a single closed path:
    ctx.beginPath();
    // Top rim (back curve to front, but back hidden — we'll paint full ellipse separately later)
    ctx.ellipse(cx, topY, rx, ry, 0, 0, Math.PI); // top FRONT arc (left → bottom of top ellipse → right)
    // Down right side
    ctx.lineTo(cx + rx, botY);
    // Bottom front arc (right → bottom of bot ellipse → left)
    ctx.ellipse(cx, botY, rx, ry, 0, 0, Math.PI);
    // Up left side
    ctx.lineTo(cx - rx, topY);
    ctx.closePath();
    ctx.fillStyle = BODY_FILL;
    ctx.fill();
    ctx.stroke();

    // 2. Mint frosting band: top ellipse filled mint + extends down with wavy drip edge
    this.drawMintFrostingWithDrips();

    // 3. Top ellipse (back of cake — fully closed mint ellipse on top, painted AFTER drips so it sits on top)
    //    Already covered by mint frosting fill above. Now add the visible top rim outline.
    ctx.lineWidth = 6;
    ctx.strokeStyle = OUTLINE;
    ctx.beginPath();
    ctx.ellipse(cx, topY, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Mint frosting on top of cake: full top ellipse + downward band with wavy bottom edge (drips).
  private drawMintFrostingWithDrips(): void {
    const ctx = this.ctx;
    const cx = this.bodyCx;
    const rx = this.bodyRx;
    const topY = this.bodyTopY;
    const ry = this.capRy;
    const mintBandBottom = topY + this.mintBandH;

    // Build the mint shape: top ellipse + side rect down to wavy drip line.
    ctx.beginPath();
    // Start at left rim (top of left side)
    ctx.moveTo(cx - rx, topY);
    // Up over the back of the top ellipse
    ctx.ellipse(cx, topY, rx, ry, 0, Math.PI, 0, true); // back half of top ellipse (left → top → right)
    // Right side going down to mint band bottom
    ctx.lineTo(cx + rx, mintBandBottom);
    // Wavy bottom edge: traverse from right to left, dipping for each drip
    this.tracePathFromRightToLeftWithDrips(mintBandBottom);
    // Left side going back up
    ctx.lineTo(cx - rx, topY);
    ctx.closePath();
    ctx.fillStyle = MINT;
    ctx.fill();

    // Outline of mint shape (sides + wavy bottom only — top ellipse arc gets re-outlined later for crispness)
    ctx.lineWidth = 6;
    ctx.strokeStyle = OUTLINE;
    ctx.beginPath();
    ctx.moveTo(cx - rx, topY);
    ctx.lineTo(cx - rx, mintBandBottom);
    this.tracePathFromLeftToRightWithDrips(mintBandBottom);
    ctx.lineTo(cx + rx, topY);
    ctx.stroke();

    // Subtle highlight crescent on the back rim of top ellipse
    ctx.fillStyle = MINT_HIGHLIGHT;
    ctx.beginPath();
    ctx.ellipse(cx, topY - ry * 0.15, rx * 0.78, ry * 0.45, 0, Math.PI, 0, true);
    ctx.fill();
  }

  // Append (without beginPath/moveTo) a wavy drip line from right to left at given y baseline.
  private tracePathFromRightToLeftWithDrips(y: number): void {
    const ctx = this.ctx;
    const cx = this.bodyCx;
    const rx = this.bodyRx;
    const dropMax = this.mintBandH * 1.6;
    // We're already at (cx + rx, y). Walk leftward, dipping for each drip.
    const seeds = [...this.dripSeeds].reverse(); // right-to-left order
    for (let i = 0; i < seeds.length; i++) {
      const s = seeds[i]!;
      const xCenter = cx - rx + (1 - s.t) * (rx * 2); // mirror because right-to-left
      const dripW = 22 * s.w;
      const dripH = dropMax * s.h;
      // Walk to drip's right edge
      ctx.lineTo(xCenter + dripW / 2, y);
      // Curve down and around the drip tip back up
      ctx.bezierCurveTo(
        xCenter + dripW / 2, y + dripH * 0.6,
        xCenter + dripW * 0.4, y + dripH,
        xCenter, y + dripH,
      );
      ctx.bezierCurveTo(
        xCenter - dripW * 0.4, y + dripH,
        xCenter - dripW / 2, y + dripH * 0.6,
        xCenter - dripW / 2, y,
      );
    }
    ctx.lineTo(cx - rx, y);
  }

  // Same drip shape but traced left-to-right (for stroke).
  private tracePathFromLeftToRightWithDrips(y: number): void {
    const ctx = this.ctx;
    const cx = this.bodyCx;
    const rx = this.bodyRx;
    const dropMax = this.mintBandH * 1.6;
    for (let i = 0; i < this.dripSeeds.length; i++) {
      const s = this.dripSeeds[i]!;
      const xCenter = cx - rx + s.t * (rx * 2);
      const dripW = 22 * s.w;
      const dripH = dropMax * s.h;
      ctx.lineTo(xCenter - dripW / 2, y);
      ctx.bezierCurveTo(
        xCenter - dripW / 2, y + dripH * 0.6,
        xCenter - dripW * 0.4, y + dripH,
        xCenter, y + dripH,
      );
      ctx.bezierCurveTo(
        xCenter + dripW * 0.4, y + dripH,
        xCenter + dripW / 2, y + dripH * 0.6,
        xCenter + dripW / 2, y,
      );
    }
    ctx.lineTo(cx + rx, y);
  }

  // ---------- CHERRY MOUND ----------
  // A stacked stripe pyramid (4 stripes) with a cherry on top.
  private drawCherryMound(cx: number, baseY: number): void {
    const ctx = this.ctx;
    const S = this.size;
    const w0 = S * 0.045;   // widest (base) stripe width
    const stripeH = S * 0.012;
    const stripeNarrow = 0.78;

    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;
    let curY = baseY;
    let curW = w0;
    for (let i = 0; i < 4; i++) {
      const color = i % 2 === 0 ? MOUND_LIGHT : MOUND_DARK;
      const top = curY - stripeH;
      // Stripe as a flat capsule (rounded ends)
      ctx.beginPath();
      ctx.moveTo(cx - curW / 2 + stripeH / 2, top);
      ctx.lineTo(cx + curW / 2 - stripeH / 2, top);
      ctx.arc(cx + curW / 2 - stripeH / 2, top + stripeH / 2, stripeH / 2, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(cx - curW / 2 + stripeH / 2, top + stripeH);
      ctx.arc(cx - curW / 2 + stripeH / 2, top + stripeH / 2, stripeH / 2, Math.PI / 2, -Math.PI / 2);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.stroke();
      curY = top;
      curW *= stripeNarrow;
    }

    // Cherry on top of the stack
    const cherryR = S * 0.022;
    const cherryCx = cx;
    const cherryCy = curY - cherryR * 0.7;
    // Stem (small bezier curve)
    ctx.lineWidth = 3;
    ctx.strokeStyle = CHERRY_STEM;
    ctx.beginPath();
    ctx.moveTo(cherryCx, cherryCy - cherryR);
    ctx.quadraticCurveTo(cherryCx + cherryR * 0.6, cherryCy - cherryR * 1.6, cherryCx + cherryR * 0.8, cherryCy - cherryR * 1.9);
    ctx.stroke();

    // Cherry body (circle with outline)
    ctx.beginPath();
    ctx.arc(cherryCx, cherryCy, cherryR, 0, Math.PI * 2);
    ctx.fillStyle = CHERRY;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    // Cherry shadow (lower right)
    ctx.beginPath();
    ctx.arc(cherryCx + cherryR * 0.3, cherryCy + cherryR * 0.3, cherryR * 0.55, 0, Math.PI * 2);
    ctx.fillStyle = CHERRY_SHADOW;
    ctx.globalAlpha = 0.5;
    ctx.fill();
    ctx.globalAlpha = 1;
    // Cherry highlight (upper left)
    ctx.beginPath();
    ctx.arc(cherryCx - cherryR * 0.35, cherryCy - cherryR * 0.35, cherryR * 0.25, 0, Math.PI * 2);
    ctx.fillStyle = CHERRY_HIGHLIGHT;
    ctx.fill();
  }

  // ---------- HEART BALLOON ----------
  private drawHeartBalloon(h: { x: number; y: number; size: number; tilt: number; stringTo: { x: number; y: number } }): void {
    const ctx = this.ctx;

    // String: curved bezier from cake anchor up to balloon
    ctx.lineWidth = 2;
    ctx.strokeStyle = HEART_STRING;
    ctx.beginPath();
    ctx.moveTo(h.stringTo.x, h.stringTo.y);
    const midX = (h.x + h.stringTo.x) / 2 + (h.x - h.stringTo.x) * 0.2;
    const midY = (h.y + h.stringTo.y) / 2;
    ctx.bezierCurveTo(
      h.stringTo.x, h.stringTo.y - 20,
      midX, midY,
      h.x, h.y + h.size * 1.05,
    );
    ctx.stroke();

    // Heart shape (drawn with tilt)
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.tilt);
    this.tracePathHeart(0, 0, h.size);
    ctx.fillStyle = HEART;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    // Highlight: an oval-ish white sheen on the upper-right lobe
    ctx.beginPath();
    ctx.ellipse(h.size * 0.30, -h.size * 0.05, h.size * 0.16, h.size * 0.28, -0.4, 0, Math.PI * 2);
    ctx.fillStyle = HEART_HIGHLIGHT;
    ctx.fill();
    ctx.restore();
  }

  // Draw a heart-shape path centered on (cx, cy), with `size` ~= height of the heart.
  private tracePathHeart(cx: number, cy: number, size: number): void {
    const ctx = this.ctx;
    const w = size * 1.15;
    const h = size;
    // Heart bottom tip at (cx, cy + h/2)
    const tipY = cy + h * 0.6;
    ctx.beginPath();
    ctx.moveTo(cx, tipY);
    // Right curve up
    ctx.bezierCurveTo(
      cx + w * 0.7,  cy + h * 0.15,
      cx + w * 0.55, cy - h * 0.55,
      cx,            cy - h * 0.10,
    );
    // Left curve up (mirror)
    ctx.bezierCurveTo(
      cx - w * 0.55, cy - h * 0.55,
      cx - w * 0.7,  cy + h * 0.15,
      cx,            tipY,
    );
    ctx.closePath();
  }

  // ---------- CANDLE ----------
  private drawCandle(): void {
    const ctx = this.ctx;
    const w = this.candleW;
    const h = this.candleH;
    const cx = this.candle.x;
    const baseY = this.candle.y;
    const topY = baseY - h;
    const left = cx - w / 2;

    // Body (rounded rect-ish, soft top)
    ctx.beginPath();
    ctx.moveTo(left, topY);
    ctx.lineTo(left + w, topY);
    ctx.lineTo(left + w, baseY);
    ctx.lineTo(left, baseY);
    ctx.closePath();
    ctx.fillStyle = CANDLE_BODY;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = CANDLE_OUTLINE;
    ctx.stroke();

    // 3 horizontal stripes
    const stripeColors = [CANDLE_STRIPE_A, CANDLE_STRIPE_B, CANDLE_STRIPE_A];
    for (let i = 0; i < 3; i++) {
      const y = topY + h * (0.20 + i * 0.27);
      const sh = h * 0.10;
      ctx.fillStyle = stripeColors[i]!;
      ctx.fillRect(left, y, w, sh);
      // Re-stroke
      ctx.lineWidth = 1;
      ctx.strokeStyle = OUTLINE_LIGHT;
      ctx.beginPath();
      ctx.moveTo(left, y);
      ctx.lineTo(left + w, y);
      ctx.moveTo(left, y + sh);
      ctx.lineTo(left + w, y + sh);
      ctx.stroke();
    }
    // Re-stroke outer outline so stripe internals don't bleed
    ctx.lineWidth = 3;
    ctx.strokeStyle = CANDLE_OUTLINE;
    ctx.strokeRect(left, topY, w, h);

    // Wick
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#2a1a08";
    ctx.beginPath();
    ctx.moveTo(cx, topY);
    ctx.lineTo(cx, topY - 6);
    ctx.stroke();
  }

  // ---------- FLAME ----------
  private drawFlame(t: number): void {
    const ctx = this.ctx;
    const frame = Math.floor(t / FLAME_FRAME_MS);
    const tall = frame % 2 === 0;
    const cx = this.candle.x;
    const wickTop = this.candle.y - this.candleH - 6;
    const flameH = tall ? this.size * 0.10 : this.size * 0.085;
    const flameW = tall ? this.size * 0.04 : this.size * 0.045;

    // Outer glow (soft radial)
    const grad = ctx.createRadialGradient(cx, wickTop - flameH * 0.4, 0, cx, wickTop - flameH * 0.4, flameH * 0.9);
    grad.addColorStop(0, "rgba(255,200,90,0.45)");
    grad.addColorStop(1, "rgba(255,180,40,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, wickTop - flameH * 0.4, flameH * 0.9, 0, Math.PI * 2);
    ctx.fill();

    // Flame body (teardrop)
    ctx.beginPath();
    ctx.moveTo(cx, wickTop); // base on wick tip
    ctx.bezierCurveTo(
      cx + flameW * 0.7, wickTop - flameH * 0.25,
      cx + flameW * 0.4, wickTop - flameH * 0.8,
      cx,                wickTop - flameH,
    );
    ctx.bezierCurveTo(
      cx - flameW * 0.4, wickTop - flameH * 0.8,
      cx - flameW * 0.7, wickTop - flameH * 0.25,
      cx,                wickTop,
    );
    ctx.closePath();
    ctx.fillStyle = FLAME_OUTER;
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();

    // Mid layer
    ctx.beginPath();
    ctx.moveTo(cx, wickTop - flameH * 0.1);
    ctx.bezierCurveTo(
      cx + flameW * 0.4, wickTop - flameH * 0.3,
      cx + flameW * 0.25, wickTop - flameH * 0.7,
      cx,                 wickTop - flameH * 0.85,
    );
    ctx.bezierCurveTo(
      cx - flameW * 0.25, wickTop - flameH * 0.7,
      cx - flameW * 0.4, wickTop - flameH * 0.3,
      cx,                wickTop - flameH * 0.1,
    );
    ctx.closePath();
    ctx.fillStyle = FLAME_MID;
    ctx.fill();

    // Inner glow
    ctx.beginPath();
    ctx.ellipse(cx, wickTop - flameH * 0.45, flameW * 0.18, flameH * 0.32, 0, 0, Math.PI * 2);
    ctx.fillStyle = FLAME_INNER;
    ctx.fill();
  }

  // ---------- SMOKE ----------
  private drawSmoke(t: number): void {
    if (this.smokes.size === 0) return;
    const ctx = this.ctx;
    const finished: number[] = [];
    this.smokes.forEach((s, idx) => {
      const age = t - s.startTime;
      if (age >= SMOKE_DURATION_MS) {
        finished.push(idx);
        return;
      }
      const p = age / SMOKE_DURATION_MS;
      const rise = p * this.size * 0.10;
      const drift = Math.sin(p * Math.PI * 2 + s.seed) * 6;
      const alpha = (1 - p) * 0.55;
      const radius = 4 + p * 14;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = "#a8a098";
      // 3 puffs
      for (let k = 0; k < 3; k++) {
        const px = s.x + drift + (k - 1) * 4;
        const py = s.y - rise - k * 5;
        ctx.beginPath();
        ctx.arc(px, py, radius - k * 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    });
    for (const idx of finished) this.smokes.delete(idx);
  }

  // ---------- PUBLIC API ----------
  blowOut(): boolean {
    const litIdx: number[] = [];
    for (let i = 0; i < this.lit.length; i++) {
      if (this.lit[i]) litIdx.push(i);
    }
    if (litIdx.length === 0) return false;
    const pick = litIdx[Math.floor(Math.random() * litIdx.length)]!;
    this.lit[pick] = false;
    const now = performance.now();
    if (this.isNumeral && this.blewAt == null) this.blewAt = now;
    // Smoke from wick tip
    const wickTop = this.candle.y - this.candleH - 6;
    this.smokes.set(pick, {
      startTime: now,
      x: this.candle.x,
      y: wickTop,
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
