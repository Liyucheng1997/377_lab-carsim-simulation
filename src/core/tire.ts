// 轮胎模型：简化魔术公式（Pacejka MF）+ 联合滑移削弱函数 + 摩擦椭圆限幅
import type { TireParams } from './params';
import { corneringStiffness } from './params';

export interface TireOutput {
  fx: number; // 纵向力（轮胎坐标系，向前为正）N
  fy: number; // 侧向力（轮胎坐标系，向左为正）N
  mz: number; // 回正力矩 N·m
}

/** 魔术公式基本形式 */
export function magicFormula(x: number, B: number, C: number, D: number, E: number): number {
  const bx = B * x;
  return D * Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx))));
}

export class TireModel {
  constructor(public p: TireParams) {}

  /**
   * 计算轮胎力
   * @param kappa   纵向滑移率（制动为负）
   * @param tanAlpha 侧偏角正切（正值产生向左的侧向力，即 ISO 侧偏角取负号）
   * @param gamma   侧倾（外倾）角 rad，顶部向左倾为正
   * @param fz      垂向载荷 N
   * @param muScale 路面附着系数比例（干沥青 = 1）
   */
  compute(kappa: number, tanAlpha: number, gamma: number, fz: number, muScale: number, out: TireOutput): TireOutput {
    const p = this.p;
    if (fz <= 0) {
      out.fx = 0; out.fy = 0; out.mz = 0;
      return out;
    }
    const fz0 = p.nominalLoad;
    const dfz = (fz - fz0) / fz0;
    const muX = Math.max(0.05, p.muX * (1 + p.loadSensitivity * dfz)) * muScale;
    const muY = Math.max(0.05, p.muY * (1 + p.loadSensitivity * dfz)) * muScale;

    // 纯纵滑
    const Dx = muX * fz;
    const Kx = p.kxCoeff * fz;
    const Bx = Kx / (p.cx * Dx);
    const fx0 = magicFormula(kappa, Bx, p.cx, Dx, p.ex);

    // 纯侧偏（侧偏刚度随载荷饱和）
    const Dy = muY * fz;
    const Ky = corneringStiffness(p, fz);
    const By = Ky / (p.cy * Dy);
    const fy0 = magicFormula(tanAlpha, By, p.cy, Dy, p.ey);
    const fyCamber = p.camberCoeff * fz * gamma;

    // 联合滑移削弱函数（MF5.2 风格的 G 函数）
    const gxa = Math.cos(Math.atan(p.combinedX * tanAlpha));
    const gyk = Math.cos(Math.atan(p.combinedY * kappa));
    let fx = fx0 * gxa;
    let fy = (fy0 + fyCamber) * gyk;

    // 摩擦椭圆限幅
    const e = (fx / Dx) * (fx / Dx) + (fy / Dy) * (fy / Dy);
    if (e > 1) {
      const s = 1 / Math.sqrt(e);
      fx *= s;
      fy *= s;
    }

    // 回正力矩：拖距随侧偏角衰减
    const trail = p.pneumaticTrail * Math.sqrt(fz / fz0) * Math.cos(1.2 * Math.atan(1.2 * By * tanAlpha));
    out.fx = fx;
    out.fy = fy;
    out.mz = -trail * fy0 * gyk;
    return out;
  }
}
