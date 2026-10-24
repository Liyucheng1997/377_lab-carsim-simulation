// Canvas 曲线绘图组件：多曲线叠加、悬停读数、框选缩放、时间游标
import { h, cssVar } from './dom';

export interface Series {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  n?: number;
  color: string;
  label: string;
  dash?: number[];
  width?: number;
}

export interface Marker {
  x: number;
  y: number;
  color: string;
  shape?: 'dot' | 'cone' | 'car';
  heading?: number; // rad，shape=car 时使用
}

export interface PlotData {
  series: Series[];
  xLabel: string;
  yLabel: string;
  equal?: boolean;
  xIsTime?: boolean;
  markers?: Marker[]; // 静态标记（如桩桶）
  refLines?: { x: ArrayLike<number>; y: ArrayLike<number>; color: string; dash?: number[] }[];
}

interface Range { x0: number; x1: number; y0: number; y1: number }

const PAD = { l: 52, r: 12, t: 8, b: 30 };

export class Plot {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tip: HTMLDivElement;
  private data: PlotData = { series: [], xLabel: '', yLabel: '' };
  private zoom: Range | null = null;
  private range: Range = { x0: 0, x1: 1, y0: 0, y1: 1 };
  private cursorX: number | null = null;
  private live: Marker[] = [];
  private hoverPx: number | null = null;
  private drag: { x: number; y: number; x2: number; y2: number } | null = null;
  private w = 300;
  private hgt = 200;
  private dirty = false;
  onSeek: ((x: number) => void) | null = null;

  constructor(parent: HTMLElement) {
    this.canvas = h('canvas');
    this.tip = h('div', { class: 'plot-tip' });
    this.el = h('div', { class: 'plot' }, this.canvas, this.tip);
    parent.appendChild(this.el);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(this.el);
    this.canvas.addEventListener('mousemove', (e) => this.onMove(e));
    this.canvas.addEventListener('mouseleave', () => {
      this.hoverPx = null;
      this.tip.style.display = 'none';
      this.drag = null;
      this.request();
    });
    this.canvas.addEventListener('mousedown', (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      this.drag = { x, y, x2: x, y2: y };
    });
    window.addEventListener('mouseup', (e) => this.onUp(e));
    window.addEventListener('vdlab-theme', () => this.request());
    this.canvas.addEventListener('dblclick', () => {
      this.zoom = null;
      this.request();
    });
  }

  setData(d: PlotData, keepZoom = false) {
    this.data = d;
    if (!keepZoom) this.zoom = null;
    this.request();
  }

  setCursor(x: number | null, live: Marker[] = []) {
    this.cursorX = x;
    this.live = live;
    this.request();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = Math.max(50, r.width);
    this.hgt = Math.max(50, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.hgt * dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.hgt + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.request();
  }

  private request() {
    if (this.dirty) return;
    this.dirty = true;
    requestAnimationFrame(() => this.draw());
  }

  // ---- 坐标变换 ----
  private px(x: number) {
    const R = this.range;
    return PAD.l + ((x - R.x0) / (R.x1 - R.x0)) * (this.w - PAD.l - PAD.r);
  }
  private py(y: number) {
    const R = this.range;
    return this.hgt - PAD.b - ((y - R.y0) / (R.y1 - R.y0)) * (this.hgt - PAD.t - PAD.b);
  }
  private ix(px: number) {
    const R = this.range;
    return R.x0 + ((px - PAD.l) / (this.w - PAD.l - PAD.r)) * (R.x1 - R.x0);
  }
  private iy(py: number) {
    const R = this.range;
    return R.y0 + ((this.hgt - PAD.b - py) / (this.hgt - PAD.t - PAD.b)) * (R.y1 - R.y0);
  }

  private computeRange(): Range {
    const d = this.data;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    const scan = (xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, xr?: Range) => {
      for (let i = 0; i < n; i++) {
        const x = xs[i], y = ys[i];
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        if (xr && (x < xr.x0 || x > xr.x1)) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    };
    const z = this.zoom;
    for (const s of d.series) scan(s.x, s.y, s.n ?? s.y.length, z && !d.equal ? z : undefined);
    if (d.markers) for (const m of d.markers) {
      if (z && !d.equal && (m.x < z.x0 || m.x > z.x1)) continue;
      x0 = Math.min(x0, m.x); x1 = Math.max(x1, m.x); y0 = Math.min(y0, m.y); y1 = Math.max(y1, m.y);
    }
    if (d.refLines) for (const r of d.refLines) scan(r.x, r.y, r.x.length, z && !d.equal ? z : undefined);
    if (!Number.isFinite(x0)) { x0 = 0; x1 = 1; y0 = 0; y1 = 1; }
    if (z) {
      x0 = z.x0; x1 = z.x1;
      if (d.equal) { y0 = z.y0; y1 = z.y1; }
    }
    if (x1 - x0 < 1e-9) { x0 -= 0.5; x1 += 0.5; }
    if (y1 - y0 < 1e-9) { const c = y0; y0 = c - Math.max(0.5, Math.abs(c) * 0.1); y1 = c + Math.max(0.5, Math.abs(c) * 0.1); }
    if (!(z && d.equal)) {
      const py = (y1 - y0) * 0.08;
      y0 -= py; y1 += py;
      if (!d.xIsTime && !z) { const pxx = (x1 - x0) * 0.04; x0 -= pxx; x1 += pxx; }
    }
    const pw0 = this.w - PAD.l - PAD.r, ph0 = this.hgt - PAD.t - PAD.b;
    // 细长数据（如直线工况轨迹）放弃等比例，避免压成一条线
    const aspectRatio = ((x1 - x0) / (y1 - y0)) / (pw0 / ph0);
    if (d.equal && (z || (aspectRatio < 5 && aspectRatio > 0.2))) {
      const pw = pw0, ph = ph0;
      const sx = (x1 - x0) / pw, sy = (y1 - y0) / ph;
      const s = Math.max(sx, sy);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      x0 = cx - (s * pw) / 2; x1 = cx + (s * pw) / 2;
      y0 = cy - (s * ph) / 2; y1 = cy + (s * ph) / 2;
    }
    return { x0, x1, y0, y1 };
  }

  draw() {
    this.dirty = false;
    const ctx = this.ctx;
    const W = this.w, H = this.hgt;
    const col = {
      bg: cssVar('--plot-bg') || '#ffffff',
      grid: cssVar('--plot-grid') || 'rgba(0,0,0,0.06)',
      axis: cssVar('--text-dim') || '#86868b',
      text: cssVar('--text') || '#1d1d1f',
      cursor: cssVar('--primary') || '#0071e3',
    };
    ctx.fillStyle = col.bg;
    ctx.fillRect(0, 0, W, H);
    this.range = this.computeRange();
    const R = this.range;

    // 网格与刻度
    ctx.font = '10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.lineWidth = 1;
    const xt = niceTicks(R.x0, R.x1, Math.max(3, Math.floor((W - PAD.l) / 70)));
    const yt = niceTicks(R.y0, R.y1, Math.max(3, Math.floor((H - PAD.b) / 34)));
    ctx.strokeStyle = col.grid;
    ctx.fillStyle = col.axis;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const v of xt.ticks) {
      const x = Math.round(this.px(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, H - PAD.b); ctx.stroke();
      ctx.fillText(fmtTick(v, xt.step), x, H - PAD.b + 4);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const v of yt.ticks) {
      const y = Math.round(this.py(v)) + 0.5;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
      ctx.fillText(fmtTick(v, yt.step), PAD.l - 5, y);
    }
    // 零线
    if (R.y0 < 0 && R.y1 > 0) {
      ctx.strokeStyle = col.axis;
      ctx.globalAlpha = 0.45;
      const y = Math.round(this.py(0)) + 0.5;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // 坐标轴标签
    ctx.fillStyle = col.axis;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(this.data.xLabel, W - PAD.r, H - 2);

    ctx.save();
    ctx.beginPath();
    ctx.rect(PAD.l, PAD.t, W - PAD.l - PAD.r, H - PAD.t - PAD.b);
    ctx.clip();

    // 参考线（路径）
    for (const r of this.data.refLines ?? []) {
      ctx.strokeStyle = r.color;
      ctx.setLineDash(r.dash ?? [4, 4]);
      ctx.lineWidth = 1;
      this.polyline(r.x, r.y, r.x.length);
      ctx.setLineDash([]);
    }
    // 标记（桩桶）
    for (const m of this.data.markers ?? []) {
      const x = this.px(m.x), y = this.py(m.y);
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.moveTo(x, y - 4); ctx.lineTo(x + 3.5, y + 3); ctx.lineTo(x - 3.5, y + 3); ctx.closePath();
      ctx.fill();
    }
    // 曲线
    for (const s of this.data.series) {
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width ?? 1.6;
      ctx.setLineDash(s.dash ?? []);
      this.polyline(s.x, s.y, s.n ?? s.y.length);
    }
    ctx.setLineDash([]);

    // 时间游标与实时标记
    if (this.cursorX !== null && this.data.xIsTime) {
      const x = Math.round(this.px(this.cursorX)) + 0.5;
      ctx.strokeStyle = col.cursor;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, H - PAD.b); ctx.stroke();
    }
    for (const m of this.live) {
      const x = this.px(m.x), y = this.py(m.y);
      if (m.shape === 'car') {
        const hd = m.heading ?? 0;
        // 屏幕坐标 y 向下：方向取反
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-hd);
        ctx.fillStyle = m.color;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(8, 0); ctx.lineTo(-6, 5); ctx.lineTo(-3, 0); ctx.lineTo(-6, -5); ctx.closePath();
        ctx.fill(); ctx.stroke();
        ctx.restore();
      } else {
        ctx.fillStyle = m.color;
        ctx.strokeStyle = col.bg;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }
    // 悬停线
    if (this.hoverPx !== null && !this.drag) {
      ctx.strokeStyle = col.axis;
      ctx.globalAlpha = 0.6;
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(this.hoverPx + 0.5, PAD.t); ctx.lineTo(this.hoverPx + 0.5, H - PAD.b); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    // 框选
    if (this.drag && Math.abs(this.drag.x2 - this.drag.x) > 3) {
      const d = this.drag;
      ctx.fillStyle = col.cursor;
      ctx.globalAlpha = 0.15;
      if (this.data.equal) ctx.fillRect(Math.min(d.x, d.x2), Math.min(d.y, d.y2), Math.abs(d.x2 - d.x), Math.abs(d.y2 - d.y));
      else ctx.fillRect(Math.min(d.x, d.x2), PAD.t, Math.abs(d.x2 - d.x), H - PAD.t - PAD.b);
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // 图例
    const seen = new Set<string>();
    let lx = PAD.l + 6;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const s of this.data.series) {
      if (seen.has(s.label)) continue;
      seen.add(s.label);
      const tw = ctx.measureText(s.label).width;
      if (lx + tw + 22 > W - PAD.r) break;
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.setLineDash(s.dash ?? []);
      ctx.beginPath(); ctx.moveTo(lx, PAD.t + 8); ctx.lineTo(lx + 14, PAD.t + 8); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col.text;
      ctx.fillText(s.label, lx + 17, PAD.t + 8);
      lx += tw + 28;
    }
  }

  private polyline(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number) {
    const ctx = this.ctx;
    const step = Math.max(1, Math.floor(n / 5000));
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i < n; i += step) {
      const x = xs[i], y = ys[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) { pen = false; continue; }
      const X = this.px(x), Y = this.py(y);
      if (!pen) { ctx.moveTo(X, Y); pen = true; } else ctx.lineTo(X, Y);
    }
    if (n > 0 && (n - 1) % step !== 0) {
      const x = xs[n - 1], y = ys[n - 1];
      if (Number.isFinite(x) && Number.isFinite(y) && pen) ctx.lineTo(this.px(x), this.py(y));
    }
    ctx.stroke();
  }

  private onMove(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (this.drag) {
      this.drag.x2 = x;
      this.drag.y2 = y;
      this.request();
      return;
    }
    if (x < PAD.l || x > this.w - PAD.r) {
      this.hoverPx = null;
      this.tip.style.display = 'none';
      this.request();
      return;
    }
    this.hoverPx = x;
    const xv = this.ix(x);
    const lines: string[] = [];
    if (this.data.xIsTime || isMonotonic(this.data.series[0])) {
      lines.push(`<b>${this.data.xLabel.split(' ')[0]} = ${fmtVal(xv)}</b>`);
      for (const s of this.data.series.slice(0, 8)) {
        const v = sampleAt(s, xv);
        if (v === null) continue;
        lines.push(`<span style="color:${s.color}">●</span> ${s.label}　<b>${fmtVal(v)}</b>`);
      }
    } else {
      lines.push(`x = ${fmtVal(xv)}，y = ${fmtVal(this.iy(y))}`);
    }
    this.tip.innerHTML = lines.join('<br>');
    this.tip.style.display = 'block';
    const tw = this.tip.offsetWidth;
    this.tip.style.left = (x + 14 + tw > this.w ? x - 14 - tw : x + 14) + 'px';
    this.tip.style.top = Math.min(this.hgt - this.tip.offsetHeight - 4, Math.max(4, y - 10)) + 'px';
    this.request();
  }

  private onUp(e: MouseEvent) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const dx = Math.abs(d.x2 - d.x), dy = Math.abs(d.y2 - d.y);
    if (dx > 6 && (!this.data.equal || dy > 6)) {
      const a = this.ix(Math.min(d.x, d.x2)), b = this.ix(Math.max(d.x, d.x2));
      const c = this.iy(Math.max(d.y, d.y2)), dd = this.iy(Math.min(d.y, d.y2));
      this.zoom = { x0: a, x1: b, y0: c, y1: dd };
    } else if (e.target === this.canvas && this.onSeek && this.data.xIsTime) {
      this.onSeek(this.ix(d.x));
    }
    this.request();
  }
}

function isMonotonic(s?: Series): boolean {
  if (!s) return false;
  const n = s.n ?? s.x.length;
  if (n < 3) return true;
  const step = Math.max(1, Math.floor(n / 50));
  for (let i = step; i < n; i += step) if (s.x[i] < s.x[i - step]) return false;
  return true;
}

function sampleAt(s: Series, x: number): number | null {
  const n = s.n ?? s.x.length;
  if (n === 0) return null;
  const xs = s.x;
  if (x < xs[0] || x > xs[n - 1]) return null;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid; else hi = mid;
  }
  const f = xs[hi] > xs[lo] ? (x - xs[lo]) / (xs[hi] - xs[lo]) : 0;
  return s.y[lo] + (s.y[hi] - s.y[lo]) * f;
}

export function niceTicks(a: number, b: number, count: number): { ticks: number[]; step: number } {
  const span = b - a;
  const raw = span / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-6; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { ticks, step };
}

function fmtTick(v: number, step: number): string {
  const d = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  return v.toFixed(Math.min(d, 4));
}

function fmtVal(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000) return v.toFixed(0);
  if (a >= 100) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(3);
}
