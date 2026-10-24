import { describe, it, expect } from 'vitest';
import { Vehicle, SIM_DT } from '../src/core/vehicle';
import { Road } from '../src/core/road';
import { BUILTIN_VEHICLES, cloneVehicle, computeDerived } from '../src/core/params';
import { GRAVITY } from '../src/core/math';

const vp = BUILTIN_VEHICLES[0];

function simulate(v: Vehicle, sec: number, inp: { steer: number; throttle: number; brake: number }) {
  const n = Math.round(sec / SIM_DT);
  for (let i = 0; i < n; i++) v.step(SIM_DT, inp);
}

describe('整车模型基本物理', () => {
  it('静止制动状态保持平衡：总垂向力 = 整车重力，车辆不漂移', () => {
    for (const p of BUILTIN_VEHICLES) {
      const v = new Vehicle(p, new Road({ mu: 1 }));
      v.reset(0);
      simulate(v, 3, { steer: 0, throttle: 0, brake: 0.3 });
      const sumFz = v.fz.reduce((a, b) => a + b, 0);
      expect(sumFz / (v.m * GRAVITY)).toBeCloseTo(1, 3);
      expect(Math.abs(v.X)).toBeLessThan(0.01);
      expect(Math.abs(v.zs)).toBeLessThan(0.005);
    }
  });

  it('前后轴静载分配与参数一致', () => {
    const v = new Vehicle(vp, new Road({ mu: 1 }));
    v.reset(0);
    simulate(v, 1, { steer: 0, throttle: 0, brake: 0.3 });
    const d = computeDerived(vp);
    const front = (v.fz[0] + v.fz[1]) / v.fz.reduce((a, b) => a + b, 0);
    expect(front * 100).toBeCloseTo(d.frontWeightPct, 0);
  });

  it('低速转向符合阿克曼运动学：r ≈ u·δ/L', () => {
    const v = new Vehicle(vp, new Road({ mu: 1 }));
    const u = 3;
    v.reset(u);
    const sw = 90;
    for (let i = 0; i < 8 / SIM_DT; i++) {
      const thr = Math.max(0, Math.min(1, (u - v.u) * 0.5 + 0.05));
      v.step(SIM_DT, { steer: sw, throttle: thr, brake: 0 });
    }
    const delta = ((sw / vp.steering.ratio) * Math.PI) / 180;
    const rKin = (v.u * delta) / vp.body.wheelbase;
    expect(v.r / rKin).toBeGreaterThan(0.93);
    expect(v.r / rKin).toBeLessThan(1.05);
  });

  it('稳态转弯：载荷左右转移方向正确且总载荷守恒', () => {
    const v = new Vehicle(vp, new Road({ mu: 1 }));
    v.reset(60 / 3.6);
    for (let i = 0; i < 8 / SIM_DT; i++) {
      const thr = Math.max(0, Math.min(1, (60 / 3.6 - v.u) * 0.5 + 0.15));
      v.step(SIM_DT, { steer: 40, throttle: thr, brake: 0 });
    }
    expect(v.r).toBeGreaterThan(0);
    expect(v.ay).toBeGreaterThan(0);
    expect(v.phi).toBeGreaterThan(0); // 左转时车身向右倾（左侧抬起为正）
    expect(v.fz[1]).toBeGreaterThan(v.fz[0]); // 外侧（右）载荷大
    expect(v.fz[3]).toBeGreaterThan(v.fz[2]);
    const sum = v.fz.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum / (v.m * GRAVITY) - 1)).toBeLessThan(0.02);
  });

  it('滑行减速度不小于行驶阻力对应的减速度', () => {
    const v = new Vehicle(vp, new Road({ mu: 1 }));
    v.reset(100 / 3.6);
    simulate(v, 0.5, { steer: 0, throttle: 0, brake: 0 });
    const u0 = v.u;
    simulate(v, 1, { steer: 0, throttle: 0, brake: 0 });
    const decel = u0 - v.u;
    const drag = 0.5 * 1.206 * vp.aero.cd * vp.aero.area * u0 * u0;
    const roll = vp.tireFront.rollingResistance * v.m * GRAVITY;
    // 发动机倒拖使实际减速度大于纯行驶阻力
    expect(decel).toBeGreaterThan(((drag + roll) / v.m) * 0.95);
    expect(decel).toBeLessThan(2.0);
  });

  it('无 ABS 时紧急制动车轮抱死，有 ABS 时车轮保持滚动', () => {
    const lock = cloneVehicle(vp);
    lock.controls.abs = false;
    const a = new Vehicle(lock, new Road({ mu: 1 }));
    a.reset(80 / 3.6);
    simulate(a, 0.8, { steer: 0, throttle: 0, brake: 1 });
    expect(a.omega[0]).toBe(0);
    const b = new Vehicle(vp, new Road({ mu: 1 }));
    b.reset(80 / 3.6);
    simulate(b, 0.8, { steer: 0, throttle: 0, brake: 1 });
    expect(b.omega[0] * b.rEff[0]).toBeGreaterThan(b.u * 0.5);
  });

  it('附着系数降低时最大侧向加速度相应降低', () => {
    const ayMax = (mu: number) => {
      const v = new Vehicle(vp, new Road({ mu }));
      v.reset(50 / 3.6);
      let m = 0;
      for (let i = 0; i < 6 / SIM_DT; i++) {
        v.step(SIM_DT, { steer: 200, throttle: 0.15, brake: 0 });
        m = Math.max(m, Math.abs(v.ay));
      }
      return m / GRAVITY;
    };
    expect(ayMax(0.3)).toBeLessThan(0.4);
    expect(ayMax(1)).toBeGreaterThan(0.75);
  });
});
