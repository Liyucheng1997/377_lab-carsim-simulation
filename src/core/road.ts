// 路面模型：高度 + 附着系数
import { seededRandom } from './math';

export interface MuPatch {
  x0: number; x1: number; y0: number; y1: number;
  mu: number;
  label?: string;
}

export type RoughnessClass = 'A' | 'B' | 'C' | 'D' | 'E';

export interface RoadDef {
  mu: number; // 基础附着系数
  muPatches?: MuPatch[];
  bump?: { x0: number; length: number; height: number; side: 'both' | 'left' | 'right' };
  random?: { cls: RoughnessClass; x0: number; x1: number; seed: number };
  sine?: { x0: number; x1: number; amplitude: number; wavelength: number };
}

/** ISO 8608 各等级路面在 n0 = 0.1 cycle/m 处的位移功率谱密度（几何平均值）m³ */
const ISO8608_GD: Record<RoughnessClass, number> = {
  A: 16e-6, B: 64e-6, C: 256e-6, D: 1024e-6, E: 4096e-6,
};

const TRACK_HALF = 0.8; // 左右轮辙横向位置

export class Road {
  readonly def: RoadDef;
  private rx0 = 0;
  private rdx = 0.02;
  private zL: Float32Array | null = null;
  private zR: Float32Array | null = null;

  constructor(def: RoadDef) {
    this.def = def;
    if (def.random) this.buildRandom(def.random);
  }

  /** 基于谐波叠加法生成 ISO 8608 随机路面（左右轮辙低频相干） */
  private buildRandom(r: NonNullable<RoadDef['random']>) {
    const gd = ISO8608_GD[r.cls];
    const n0 = 0.1;
    const nMin = 0.011, nMax = 2.83;
    const N = 240;
    const dn = (nMax - nMin) / N;
    const rnd = seededRandom(r.seed);
    const amps: number[] = [], ns: number[] = [], phL: number[] = [], phR: number[] = [];
    for (let i = 0; i < N; i++) {
      const n = nMin + (i + 0.5) * dn;
      const G = gd * Math.pow(n / n0, -2);
      amps.push(Math.sqrt(2 * G * dn));
      ns.push(n);
      const ph = rnd() * 2 * Math.PI;
      phL.push(ph);
      // 低频（长波）左右相干，高频逐渐独立
      const coh = Math.exp(-n / 0.15);
      phR.push(ph + (1 - coh) * (rnd() * 2 - 1) * Math.PI);
    }
    this.rx0 = r.x0;
    const count = Math.ceil((r.x1 - r.x0) / this.rdx) + 1;
    this.zL = new Float32Array(count);
    this.zR = new Float32Array(count);
    for (let k = 0; k < count; k++) {
      const x = k * this.rdx;
      let zl = 0, zr = 0;
      for (let i = 0; i < N; i++) {
        const w = 2 * Math.PI * ns[i] * x;
        zl += amps[i] * Math.cos(w + phL[i]);
        zr += amps[i] * Math.cos(w + phR[i]);
      }
      // 入口/出口 5 m 渐变
      const fade = Math.min(1, x / 5, (r.x1 - r.x0 - x) / 5);
      this.zL[k] = zl * Math.max(0, fade);
      this.zR[k] = zr * Math.max(0, fade);
    }
  }

  height(x: number, y: number): number {
    const d = this.def;
    let z = 0;
    if (d.bump) {
      const b = d.bump;
      const s = (x - b.x0) / b.length;
      if (s > 0 && s < 1) {
        const inSide = b.side === 'both' || (b.side === 'left' ? y > 0 : y < 0);
        if (inSide) z += b.height * Math.sin(Math.PI * s);
      }
    }
    if (d.sine) {
      const s = d.sine;
      if (x > s.x0 && x < s.x1) {
        const fade = Math.min(1, (x - s.x0) / s.wavelength, (s.x1 - x) / s.wavelength);
        z += s.amplitude * Math.sin((2 * Math.PI * (x - s.x0)) / s.wavelength) * fade;
      }
    }
    if (this.zL && this.zR) {
      const f = (x - this.rx0) / this.rdx;
      if (f >= 0 && f < this.zL.length - 1) {
        const i = Math.floor(f);
        const t = f - i;
        const zl = this.zL[i] + (this.zL[i + 1] - this.zL[i]) * t;
        const zr = this.zR[i] + (this.zR[i + 1] - this.zR[i]) * t;
        const w = Math.min(1, Math.max(0, (y + TRACK_HALF) / (2 * TRACK_HALF)));
        z += zr + (zl - zr) * w;
      }
    }
    return z;
  }

  mu(x: number, y: number): number {
    const ps = this.def.muPatches;
    if (ps) {
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i];
        if (x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1) return p.mu;
      }
    }
    return this.def.mu;
  }

  /** 非平整路段的 x 范围（动画中生成起伏路面网格用） */
  unevenRange(): [number, number] | null {
    const d = this.def;
    let lo = Infinity, hi = -Infinity;
    if (d.bump) { lo = Math.min(lo, d.bump.x0 - 1); hi = Math.max(hi, d.bump.x0 + d.bump.length + 1); }
    if (d.sine) { lo = Math.min(lo, d.sine.x0); hi = Math.max(hi, d.sine.x1); }
    if (d.random) { lo = Math.min(lo, d.random.x0); hi = Math.max(hi, d.random.x1); }
    return lo < hi ? [lo, hi] : null;
  }
}
