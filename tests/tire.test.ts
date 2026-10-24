import { describe, it, expect } from 'vitest';
import { TireModel } from '../src/core/tire';
import { BUILTIN_VEHICLES, corneringStiffness } from '../src/core/params';

const tp = BUILTIN_VEHICLES[0].tireFront;
const tm = new TireModel(tp);
const out = { fx: 0, fy: 0, mz: 0 };
const fz = tp.nominalLoad;

describe('轮胎魔术公式', () => {
  it('零滑移时无纵向/侧向力', () => {
    tm.compute(0, 0, 0, fz, 1, out);
    expect(Math.abs(out.fx)).toBeLessThan(1e-9);
    expect(Math.abs(out.fy)).toBeLessThan(1e-9);
  });

  it('力关于滑移量奇对称', () => {
    tm.compute(0.05, 0.03, 0, fz, 1, out);
    const a = { ...out };
    tm.compute(-0.05, -0.03, 0, fz, 1, out);
    expect(out.fx).toBeCloseTo(-a.fx, 6);
    expect(out.fy).toBeCloseTo(-a.fy, 6);
  });

  it('小侧偏角时斜率等于侧偏刚度', () => {
    const a = 1e-4;
    tm.compute(0, a, 0, fz, 1, out);
    expect(out.fy / a / corneringStiffness(tp, fz)).toBeCloseTo(1, 3);
  });

  it('峰值侧向力约等于 μy·Fz，且随路面附着系数缩放', () => {
    let peak = 0;
    for (let d = 0; d < 30; d += 0.1) {
      tm.compute(0, Math.tan((d * Math.PI) / 180), 0, fz, 1, out);
      peak = Math.max(peak, out.fy);
    }
    expect(peak / fz).toBeGreaterThan(tp.muY * 0.97);
    expect(peak / fz).toBeLessThan(tp.muY * 1.01);
    tm.compute(0, Math.tan((8 * Math.PI) / 180), 0, fz, 0.3, out);
    expect(Math.abs(out.fy) / fz).toBeLessThanOrEqual(0.3 * tp.muY + 1e-6);
  });

  it('联合滑移不超出摩擦椭圆', () => {
    for (const k of [-0.5, -0.1, 0.05, 0.2]) {
      for (const d of [2, 6, 12]) {
        tm.compute(k, Math.tan((d * Math.PI) / 180), 0, fz, 1, out);
        const e = (out.fx / (tp.muX * fz)) ** 2 + (out.fy / (tp.muY * fz)) ** 2;
        expect(e).toBeLessThanOrEqual(1 + 1e-6);
      }
    }
  });

  it('离地车轮不产生力', () => {
    tm.compute(0.1, 0.1, 0, 0, 1, out);
    expect(out.fx).toBe(0);
    expect(out.fy).toBe(0);
  });
});
