// 通用数学工具
export const GRAVITY = 9.80665;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;
export const KPH = 1 / 3.6; // km/h -> m/s
export const RPM = (2 * Math.PI) / 60; // rpm -> rad/s
export const AIR_DENSITY = 1.206;

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 分段线性插值（两端外推取端点值） */
export function interp1(xs: ArrayLike<number>, ys: ArrayLike<number>, x: number): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + (ys[hi] - ys[lo]) * t;
}

/** 平滑过渡 0→1，x∈[0,1] */
export function smoothstep(x: number): number {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

/** 余弦过渡 0→1 */
export function cosStep(x: number): number {
  const t = clamp(x, 0, 1);
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

export function wrapAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** 可复现的伪随机数（mulberry32） */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 最小二乘直线拟合 y = k x + b */
export function linearFit(xs: number[], ys: number[]): { k: number; b: number; r2: number } {
  const n = xs.length;
  if (n < 2) return { k: NaN, b: NaN, r2: NaN };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]; sy += ys[i];
    sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; syy += ys[i] * ys[i];
  }
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-12) return { k: NaN, b: NaN, r2: NaN };
  const k = (n * sxy - sx * sy) / den;
  const b = (sy - k * sx) / n;
  const ssTot = syy - (sy * sy) / n;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const e = ys[i] - (k * xs[i] + b);
    ssRes += e * e;
  }
  return { k, b, r2: ssTot > 0 ? 1 - ssRes / ssTot : 1 };
}

export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
