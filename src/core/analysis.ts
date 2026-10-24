// 时间历程后处理工具
export type Arr = ArrayLike<number>;

export function idxAt(t: Arr, time: number): number {
  const n = t.length;
  if (n === 0) return 0;
  if (time <= t[0]) return 0;
  if (time >= t[n - 1]) return n - 1;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= time) lo = mid; else hi = mid;
  }
  return lo;
}

export function valueAt(t: Arr, y: Arr, time: number): number {
  const n = t.length;
  if (n === 0) return NaN;
  if (time <= t[0]) return y[0];
  if (time >= t[n - 1]) return y[n - 1];
  const i = idxAt(t, time);
  const f = (time - t[i]) / (t[i + 1] - t[i]);
  return y[i] + (y[i + 1] - y[i]) * f;
}

/** y 首次向上穿越 level 的时刻（线性插值），未穿越返回 NaN */
export function crossUp(t: Arr, y: Arr, level: number, tFrom = -Infinity): number {
  for (let i = 1; i < t.length; i++) {
    if (t[i] < tFrom) continue;
    if (y[i - 1] < level && y[i] >= level) {
      const f = (level - y[i - 1]) / (y[i] - y[i - 1]);
      return t[i - 1] + f * (t[i] - t[i - 1]);
    }
  }
  return NaN;
}

/** y 首次向下穿越 level 的时刻 */
export function crossDown(t: Arr, y: Arr, level: number, tFrom = -Infinity): number {
  for (let i = 1; i < t.length; i++) {
    if (t[i] < tFrom) continue;
    if (y[i - 1] > level && y[i] <= level) {
      const f = (y[i - 1] - level) / (y[i - 1] - y[i]);
      return t[i - 1] + f * (t[i] - t[i - 1]);
    }
  }
  return NaN;
}

function range(t: Arr, t0: number, t1: number): [number, number] {
  return [idxAt(t, t0), Math.min(t.length - 1, idxAt(t, t1) + 1)];
}

export function maxIn(t: Arr, y: Arr, t0 = -Infinity, t1 = Infinity): { value: number; time: number } {
  const [a, b] = range(t, t0, t1);
  let v = -Infinity, tm = NaN;
  for (let i = a; i <= b; i++) if (y[i] > v) { v = y[i]; tm = t[i]; }
  return { value: v, time: tm };
}

export function minIn(t: Arr, y: Arr, t0 = -Infinity, t1 = Infinity): { value: number; time: number } {
  const [a, b] = range(t, t0, t1);
  let v = Infinity, tm = NaN;
  for (let i = a; i <= b; i++) if (y[i] < v) { v = y[i]; tm = t[i]; }
  return { value: v, time: tm };
}

/** 绝对值最大点（返回带符号值） */
export function maxAbsIn(t: Arr, y: Arr, t0 = -Infinity, t1 = Infinity): { value: number; time: number } {
  const [a, b] = range(t, t0, t1);
  let v = 0, tm = NaN;
  for (let i = a; i <= b; i++) if (Math.abs(y[i]) > Math.abs(v)) { v = y[i]; tm = t[i]; }
  return { value: v, time: tm };
}

export function meanIn(t: Arr, y: Arr, t0 = -Infinity, t1 = Infinity): number {
  const [a, b] = range(t, t0, t1);
  let s = 0;
  for (let i = a; i <= b; i++) s += y[i];
  return s / Math.max(1, b - a + 1);
}

export function rmsIn(t: Arr, y: Arr, t0 = -Infinity, t1 = Infinity, removeMean = false): number {
  const [a, b] = range(t, t0, t1);
  const m = removeMean ? meanIn(t, y, t0, t1) : 0;
  let s = 0;
  for (let i = a; i <= b; i++) s += (y[i] - m) ** 2;
  return Math.sqrt(s / Math.max(1, b - a + 1));
}

/** 局部极值点索引（|y| 超过 minAbs 的峰/谷） */
export function peaks(y: Arr, i0: number, i1: number, minAbs: number): number[] {
  const out: number[] = [];
  for (let i = Math.max(1, i0); i < Math.min(y.length - 1, i1); i++) {
    const a = y[i - 1], b = y[i], c = y[i + 1];
    if (Math.abs(b) < minAbs) continue;
    if ((b > a && b >= c && b > 0) || (b < a && b <= c && b < 0)) {
      if (out.length && Math.sign(y[out[out.length - 1]]) === Math.sign(b)) {
        if (Math.abs(b) > Math.abs(y[out[out.length - 1]])) out[out.length - 1] = i;
      } else out.push(i);
    }
  }
  return out;
}

/** 滑动平均 */
export function movingAverage(y: Arr, w: number): Float32Array {
  const n = y.length;
  const out = new Float32Array(n);
  let s = 0;
  const h = Math.max(1, Math.floor(w));
  for (let i = 0; i < n; i++) {
    s += y[i];
    if (i >= h) s -= y[i - h];
    out[i] = s / Math.min(i + 1, h);
  }
  return out;
}
