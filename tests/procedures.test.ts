import { describe, it, expect } from 'vitest';
import { BUILTIN_VEHICLES } from '../src/core/params';
import { PROCEDURES, PROCEDURE_MAP, defaultParams } from '../src/core/procedures';
import { runSimulation } from '../src/core/simulator';
import type { SimResult } from '../src/core/types';

const kpi = (r: SimResult, label: string) => {
  const k = r.kpis.find((x) => x.label.startsWith(label));
  if (!k) throw new Error('缺少指标 ' + label);
  return k.value as number;
};
const run = (vi: number, id: string, over: Record<string, any> = {}) => {
  const p = PROCEDURE_MAP[id];
  return runSimulation(BUILTIN_VEHICLES[vi], p, { ...defaultParams(p), ...over });
};

describe('所有车型 × 所有工况均可稳定运行', () => {
  for (const vp of BUILTIN_VEHICLES) {
    it(vp.name, () => {
      for (const p of PROCEDURES) {
        const r = runSimulation(vp, p, defaultParams(p));
        expect(r.warnings.filter((w) => w.includes('发散'))).toEqual([]);
        expect(r.n).toBeGreaterThan(50);
        for (const key of ['X', 'Y', 'Vx', 'Ay', 'Roll']) {
          expect(r.ch[key].every((x) => Number.isFinite(x))).toBe(true);
        }
        expect(r.kpis.length).toBeGreaterThan(3);
      }
    }, 60000);
  }
});

describe('工况结果处于工程合理范围', () => {
  it('0–100 km/h 加速时间', () => {
    const t = kpi(run(0, 'accel'), '0–100');
    expect(t).toBeGreaterThan(6.5);
    expect(t).toBeLessThan(11);
    expect(kpi(run(3, 'accel'), '0–100')).toBeLessThan(5);
  });

  it('100–0 km/h 制动距离（干沥青 + ABS）', () => {
    for (const vi of [0, 1, 2, 3]) {
      const d = kpi(run(vi, 'brake'), '制动距离');
      expect(d).toBeGreaterThan(33);
      expect(d).toBeLessThan(48);
    }
  });

  it('低附着路面制动距离按 μ 增加', () => {
    const dry = kpi(run(0, 'brake'), '制动距离');
    const wet = kpi(run(0, 'brake', { mu: 0.5 }), '制动距离');
    expect(wet / dry).toBeGreaterThan(1.7);
    expect(wet / dry).toBeLessThan(2.4);
  });

  it('稳态回转：不足转向且侧倾梯度合理', () => {
    const r = run(0, 'const-radius');
    expect(kpi(r, '不足转向度')).toBeGreaterThan(0.8);
    expect(kpi(r, '不足转向度')).toBeLessThan(5);
    expect(kpi(r, '侧倾梯度')).toBeGreaterThan(2);
    expect(kpi(r, '侧倾梯度')).toBeLessThan(7);
    expect(kpi(r, '最大稳态侧向加速度')).toBeGreaterThan(0.75);
  });

  it('SUV 侧倾梯度大于跑车', () => {
    expect(kpi(run(2, 'const-radius'), '侧倾梯度')).toBeGreaterThan(kpi(run(3, 'const-radius'), '侧倾梯度'));
  });

  it('角阶跃：横摆角速度响应时间 0.08–0.4 s', () => {
    const t = kpi(run(1, 'step-steer'), '横摆角速度响应时间');
    expect(t).toBeGreaterThan(0.08);
    expect(t).toBeLessThan(0.4);
  });

  it('双移线与对开路面制动在默认参数下通过', () => {
    for (const vi of [0, 1, 2, 3]) {
      expect(kpi(run(vi, 'dlc'), '越出通道路段数')).toBe(0);
      expect(Math.abs(kpi(run(vi, 'split-mu'), '最大横摆角'))).toBeLessThan(10);
    }
  });

  it('ESC 改善正弦停滞工况的横摆收敛', () => {
    const off = run(1, 'sine-dwell', { esc: 'off', amp: 270 });
    const on = run(1, 'sine-dwell', { esc: 'on', amp: 270 });
    const yOn = Math.abs(kpi(on, '横摆角速度比 @COS+1.0s'));
    const yOff = Math.abs(kpi(off, '横摆角速度比 @COS+1.0s'));
    expect(yOn).toBeLessThan(35);
    expect(yOn).toBeLessThanOrEqual(yOff + 1e-6);
  });

  it('赛道圈速：跑车快于 SUV', () => {
    expect(kpi(run(3, 'lap'), '圈速')).toBeLessThan(kpi(run(2, 'lap'), '圈速'));
  });
});
