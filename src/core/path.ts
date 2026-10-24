// 参考路径（折线），支持投影与按里程取点
export interface PathPoint { x: number; y: number }

export class Path {
  readonly xs: Float64Array;
  readonly ys: Float64Array;
  readonly s: Float64Array;
  readonly closed: boolean;
  readonly length: number;

  constructor(points: PathPoint[], closed = false) {
    const pts = points.slice();
    if (closed && pts.length > 1) {
      const a = pts[0], b = pts[pts.length - 1];
      if (Math.hypot(a.x - b.x, a.y - b.y) > 1e-6) pts.push({ x: a.x, y: a.y });
    }
    const n = pts.length;
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    this.s = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.xs[i] = pts[i].x;
      this.ys[i] = pts[i].y;
      if (i > 0) this.s[i] = this.s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    this.closed = closed;
    this.length = this.s[n - 1];
  }

  /** 由函数 y = f(x) 采样生成路径 */
  static fromFunction(x0: number, x1: number, f: (x: number) => number, ds = 0.5): Path {
    const pts: PathPoint[] = [];
    for (let x = x0; x <= x1 + 1e-9; x += ds) pts.push({ x, y: f(x) });
    return new Path(pts);
  }

  private wrapS(s: number): number {
    if (!this.closed) return s;
    const L = this.length;
    return ((s % L) + L) % L;
  }

  /** 按里程取点与航向 */
  pointAt(sIn: number): { x: number; y: number; heading: number } {
    const n = this.s.length;
    let s = this.wrapS(sIn);
    let i: number;
    if (s <= 0) i = 0;
    else if (s >= this.length) i = n - 2;
    else {
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (this.s[mid] <= s) lo = mid; else hi = mid;
      }
      i = lo;
    }
    const ds = this.s[i + 1] - this.s[i];
    const dx = this.xs[i + 1] - this.xs[i];
    const dy = this.ys[i + 1] - this.ys[i];
    const t = ds > 0 ? (s - this.s[i]) / ds : 0;
    const heading = Math.atan2(dy, dx);
    if (!this.closed && sIn > this.length) {
      // 路径末端按切线方向外延
      const e = sIn - this.length;
      return { x: this.xs[n - 1] + Math.cos(heading) * e, y: this.ys[n - 1] + Math.sin(heading) * e, heading };
    }
    return { x: this.xs[i] + dx * t, y: this.ys[i] + dy * t, heading };
  }

  /**
   * 将点投影到路径，返回里程、横向偏差（左正）及线段索引
   * hint 为上次的线段索引，只在其附近搜索以保证单调与效率
   */
  project(x: number, y: number, hint = -1): { s: number; e: number; idx: number } {
    const n = this.s.length;
    let i0 = 0, i1 = n - 1;
    if (hint >= 0) {
      i0 = Math.max(0, hint - 30);
      i1 = Math.min(n - 1, hint + 200);
    }
    let best = Infinity, bestS = 0, bestE = 0, bestI = 0;
    const scan = (a: number, b: number) => {
      for (let i = a; i < b; i++) {
        const dx = this.xs[i + 1] - this.xs[i];
        const dy = this.ys[i + 1] - this.ys[i];
        const l2 = dx * dx + dy * dy;
        if (l2 < 1e-12) continue;
        let t = ((x - this.xs[i]) * dx + (y - this.ys[i]) * dy) / l2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const px = this.xs[i] + dx * t, py = this.ys[i] + dy * t;
        const d2 = (x - px) * (x - px) + (y - py) * (y - py);
        if (d2 < best) {
          best = d2;
          bestI = i;
          bestS = this.s[i] + Math.sqrt(l2) * t;
          const cross = dx * (y - this.ys[i]) - dy * (x - this.xs[i]);
          bestE = Math.sign(cross) * Math.sqrt(d2);
        }
      }
    };
    scan(i0, i1);
    if (this.closed && hint >= 0 && hint + 200 >= n - 1) scan(0, Math.min(200, n - 1));
    return { s: bestS, e: bestE, idx: bestI };
  }

  /** 各点曲率（三点外接圆，模板半宽 w 个点；用于圈速工况速度规划） */
  curvature(w = 3): Float64Array {
    const n = this.s.length;
    const k = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = this.closed ? (i - w + 10 * (n - 1)) % (n - 1) : Math.max(0, i - w);
      const c = this.closed ? (i + w) % (n - 1) : Math.min(n - 1, i + w);
      if (a === c) continue;
      const x1 = this.xs[a], y1 = this.ys[a], x2 = this.xs[i], y2 = this.ys[i], x3 = this.xs[c], y3 = this.ys[c];
      const d = (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1);
      const la = Math.hypot(x2 - x1, y2 - y1), lb = Math.hypot(x3 - x2, y3 - y2), lc = Math.hypot(x3 - x1, y3 - y1);
      k[i] = la * lb * lc > 1e-9 ? (2 * d) / (la * lb * lc) : 0;
    }
    return k;
  }
}

/** 赛道生成：直道 + 圆弧段 */
export type TrackSegment = { type: 'straight'; length: number } | { type: 'arc'; radius: number; angle: number /* deg，左转为正 */ };

export function buildTrack(segments: TrackSegment[], x0 = 0, y0 = 0, h0 = 0, ds = 1): Path {
  const pts: PathPoint[] = [{ x: x0, y: y0 }];
  let x = x0, y = y0, h = h0;
  for (const seg of segments) {
    if (seg.type === 'straight') {
      const n = Math.max(1, Math.round(seg.length / ds));
      const step = seg.length / n;
      for (let i = 0; i < n; i++) {
        x += Math.cos(h) * step;
        y += Math.sin(h) * step;
        pts.push({ x, y });
      }
    } else {
      const ang = (seg.angle * Math.PI) / 180;
      const len = Math.abs(ang) * seg.radius;
      const n = Math.max(2, Math.round(len / ds));
      const dh = ang / n;
      const step = len / n;
      for (let i = 0; i < n; i++) {
        h += dh / 2;
        x += Math.cos(h) * step;
        y += Math.sin(h) * step;
        h += dh / 2;
        pts.push({ x, y });
      }
    }
  }
  return new Path(pts, true);
}
