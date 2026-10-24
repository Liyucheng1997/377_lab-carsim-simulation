// 从仿真结果 / 实时车辆状态提取动画帧
import type { SimResult } from '../core/types';
import type { Vehicle } from '../core/vehicle';
import { DEG } from '../core/math';
import type { CarFrame } from './carModel';

const W = ['L1', 'R1', 'L2', 'R2'];

export function sampleIndex(r: SimResult, t: number): { i: number; f: number } {
  const n = r.n;
  if (n < 2) return { i: 0, f: 0 };
  const t0 = r.t[0];
  let x = (t - t0) / r.dtOut;
  if (x <= 0) return { i: 0, f: 0 };
  if (x >= n - 1) return { i: n - 2, f: 1 };
  // 输出步长近似均匀，局部修正
  let i = Math.floor(x);
  while (i > 0 && r.t[i] > t) i--;
  while (i < n - 2 && r.t[i + 1] < t) i++;
  const dt = r.t[i + 1] - r.t[i];
  x = dt > 0 ? (t - r.t[i]) / dt : 0;
  return { i, f: Math.min(1, Math.max(0, x)) };
}

export function chAt(r: SimResult, key: string, t: number): number {
  const a = r.ch[key];
  if (!a) return NaN;
  const { i, f } = sampleIndex(r, t);
  return a[i] + (a[i + 1] - a[i]) * f;
}

export function frameAt(r: SimResult, t: number): CarFrame {
  const { i, f } = sampleIndex(r, t);
  const g = (key: string) => {
    const a = r.ch[key];
    return a[i] + (a[i + 1] - a[i]) * f;
  };
  return {
    X: g('X'), Y: g('Y'), yaw: g('Yaw') * DEG,
    zs: g('Zs') / 1000, roll: g('Roll') * DEG, pitch: g('Pitch') * DEG,
    zu: W.map((w) => g('Zu_' + w) / 1000),
    steer: [g('Steer_L1') * DEG, g('Steer_R1') * DEG, 0, 0],
    spin: W.map((w) => g('Spin_' + w)),
    fx: W.map((w) => g('Fx_' + w)),
    fy: W.map((w) => g('Fy_' + w)),
    fz: W.map((w) => g('Fz_' + w)),
  };
}

export function frameFromVehicle(v: Vehicle): CarFrame {
  return {
    X: v.X, Y: v.Y, yaw: v.psi,
    zs: v.zs, roll: v.phi, pitch: v.theta,
    zu: Array.from(v.zu), steer: Array.from(v.delta), spin: Array.from(v.spin),
    fx: Array.from(v.fx), fy: Array.from(v.fy), fz: Array.from(v.fz),
  };
}
