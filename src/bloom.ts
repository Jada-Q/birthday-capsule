// Date Bloom — 由日期/年份生成的柔光花瓣纪念图。纯 Canvas 2D，无依赖。
// 同一 seed 永远同一朵花（可复现）。背景由 CSS 给暗色，画布只画发光花朵。

const PAL = ["#ff6f91", "#ff9a6b", "#ffc46b", "#ff6fae", "#c98bff", "#ffd98b", "#ff8a8a"];

// 确定性 PRNG（同 seed 同序列）
function mulberry32(a: number): () => number {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 把一朵由 seed 决定的花画进 canvas（按其 CSS 尺寸 + devicePixelRatio 渲染）。 */
export function renderBloom(canvas: HTMLCanvasElement, seed: number): void {
  const s = seed >>> 0;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 300;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const rnd = mulberry32(s);
  const rand = (a = 0, b = 1) => a + (b - a) * rnd();

  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) * 0.4;

  const layers = 4 + (s % 3);     // 4..6 层
  const petals = 7 + (s % 6);     // 7..12 瓣/层
  const palRot = s % PAL.length;

  const petalPath = (len: number, wid: number) => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(wid, -len * 0.35, wid * 0.75, -len * 0.85, 0, -len);
    ctx.bezierCurveTo(-wid * 0.75, -len * 0.85, -wid, -len * 0.35, 0, 0);
    ctx.closePath();
  };

  const softPetal = (len: number, wid: number, rgb: [number, number, number]) => {
    const [r, g, b] = rgb;
    // 辉光晕
    ctx.shadowBlur = R * 0.05;
    ctx.shadowColor = `rgba(${r},${g},${b},0.55)`;
    ctx.fillStyle = `rgba(${r},${g},${b},0.12)`;
    petalPath(len, wid);
    ctx.fill();
    ctx.shadowBlur = 0;
    // 内部由淡到亮叠层 → 深度
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const sc = lerp(1.0, 0.4, t);
      const a = lerp(0.06, 0.25, t);
      ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
      petalPath(len * sc, wid * sc);
      ctx.fill();
    }
  };

  ctx.save();
  ctx.translate(cx, cy);
  for (let L = layers - 1; L >= 0; L--) {
    const lt = L / (layers - 1);
    const len = R * lerp(1.0, 0.34, 1 - lt);
    const wid = len * 0.42;
    const rgb = hexToRgb(PAL[(palRot + L) % PAL.length]!);
    const layerRot = (Math.PI / petals) * L * 0.9;
    const openGap = R * 0.05 * lt;
    for (let p = 0; p < petals; p++) {
      const ang = (p / petals) * Math.PI * 2 + layerRot + rand(-0.04, 0.04);
      const jl = len * rand(0.92, 1.06);
      ctx.save();
      ctx.rotate(ang);
      ctx.translate(0, -openGap);
      softPetal(jl, wid, rgb);
      ctx.restore();
    }
  }
  // 花心暖金光
  ctx.shadowBlur = R * 0.12;
  ctx.shadowColor = "rgba(255,220,150,0.9)";
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    ctx.fillStyle = `rgba(255,${Math.round(lerp(200, 245, t))},${Math.round(lerp(120, 200, t))},${lerp(0.16, 0.63, t)})`;
    ctx.beginPath();
    ctx.arc(0, 0, (R * lerp(0.18, 0.05, t)) / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.restore();
}

/** 由年份生成该年「年度之花」的 seed（5/20 生日 → year*10000+520）。 */
export function bloomSeedForYear(year: number): number {
  return year * 10000 + 520;
}
