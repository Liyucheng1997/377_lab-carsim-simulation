// 标准试验工况库（类似 CarSim 的 Procedure）
import type { Procedure, ParamDef, KPI, SimResult, Cone, PlotSpec } from './types';
import type { VehicleParams } from './params';
import { computeDerived } from './params';
import { Path, type PathPoint } from './path';
import { PathFollower, SpeedController, DEFAULT_PATH_FOLLOWER } from './driver';
import { SIM_DT, type Vehicle } from './vehicle';
import type { DriverContext } from './channels';
import { GRAVITY, KPH, RAD, clamp, cosStep, linearFit } from './math';
import {
  crossUp, crossDown, valueAt, maxIn, minIn, maxAbsIn, meanIn, rmsIn, peaks, idxAt, movingAverage,
} from './analysis';

// ---------------------------------------------------------------------------
// 公共参数与工具
// ---------------------------------------------------------------------------
const muParam: ParamDef = { key: 'mu', label: '路面附着系数', type: 'number', default: 1.0, min: 0.1, max: 1.5, step: 0.05, help: '干沥青≈1.0，湿沥青≈0.7，压实雪≈0.3，冰≈0.1' };

function override(key: string, label: string): ParamDef {
  return {
    key, label, type: 'select', default: 'vehicle',
    options: [
      { value: 'vehicle', label: '跟随车辆设置' },
      { value: 'on', label: '强制开启' },
      { value: 'off', label: '强制关闭' },
    ],
  };
}
function ov(v: string): boolean | undefined {
  return v === 'on' ? true : v === 'off' ? false : undefined;
}
function controlsFrom(p: Record<string, any>) {
  const c: Record<string, boolean> = {};
  for (const k of ['abs', 'esc', 'tcs']) {
    const o = ov(p[k]);
    if (o !== undefined) c[k] = o;
  }
  return c;
}

function straightPath(x0 = -200, x1 = 4000): Path {
  return Path.fromFunction(x0, x1, () => 0, 2);
}

/** 带路径跟随的驾驶员，返回转向角并写入上下文 */
function follower(path: Path, previewTime?: number) {
  let pf: PathFollower | null = null;
  return (veh: Vehicle, dt: number, ctx: DriverContext): number => {
    if (!pf) pf = new PathFollower(path, veh, { ...DEFAULT_PATH_FOLLOWER, previewTime: previewTime ?? DEFAULT_PATH_FOLLOWER.previewTime });
    const s = pf.update(veh, dt);
    ctx.station = pf.station;
    ctx.pathError = pf.error;
    return s;
  };
}

function k(label: string, value: number | string, unit = '', decimals = 2, pass: boolean | null = null, note?: string): KPI {
  return { label, value: typeof value === 'number' && !Number.isFinite(value) ? '—' : value, unit, decimals, pass, note };
}

const C = (r: SimResult, key: string) => r.ch[key];

/** 车身外廓（相对整车质心）用于压桩判定 */
function footprint(vp: VehicleParams) {
  const d = computeDerived(vp);
  const B = vp.body;
  const rearOH = B.length - B.wheelbase - B.frontOverhang;
  return { xf: d.a + B.frontOverhang, xr: -(d.b + rearOH), hw: B.width / 2 };
}

const XY_PLOT: PlotSpec = { title: '行驶轨迹', x: 'X', y: ['Y'], showCones: true, showPath: true, equalAxes: true };

// ---------------------------------------------------------------------------
// 1. 全油门加速
// ---------------------------------------------------------------------------
const accel: Procedure = {
  id: 'accel',
  name: '全油门加速',
  category: '动力性',
  standard: 'GB/T 12543 · 0–100 km/h',
  description: '车辆静止起步，0.5 s 时油门全开直线加速至终止车速，评价起步加速与超车加速性能。驾驶员闭环保持直线。',
  params: [
    { key: 'endSpeed', label: '终止车速', unit: 'km/h', type: 'number', default: 160, min: 60, max: 320, step: 10 },
    muParam,
    override('tcs', '牵引力控制 TCS'),
  ],
  setup(p) {
    const path = straightPath(-20, 5000);
    const steer = follower(path);
    const t0 = 0.5;
    return {
      duration: 60,
      init: { speed: 0, x: 0, y: 0, yaw: 0 },
      road: { mu: p.mu },
      path, ribbonWidth: 8,
      controls: controlsFrom(p),
      driver: (veh, t, dt, ctx) => {
        const s = steer(veh, dt, ctx);
        ctx.targetSpeed = NaN;
        return t < t0 ? { steer: s, throttle: 0, brake: 0.4 } : { steer: s, throttle: 1, brake: 0 };
      },
      stop: (veh) => veh.u * 3.6 >= p.endSpeed,
      kpis: (r) => {
        const t = r.t, v = C(r, 'Vx'), x = C(r, 'X');
        const t50 = crossUp(t, v, 50) - t0;
        const t100 = crossUp(t, v, 100) - t0;
        const t80 = crossUp(t, v, 80), t120 = crossUp(t, v, 120);
        const tq = crossUp(t, x, 400) - t0;
        const d100 = valueAt(t, x, t100 + t0);
        return [
          k('0–50 km/h 加速时间', t50, 's'),
          k('0–100 km/h 加速时间', t100, 's'),
          k('80–120 km/h 加速时间', t120 - t80, 's'),
          k('0–400 m 加速时间', tq, 's'),
          k('0–100 km/h 加速距离', d100, 'm', 1),
          k('最大纵向加速度', maxIn(t, C(r, 'Ax')).value, 'g', 3),
          k('最高车速（本次）', maxIn(t, v).value, 'km/h', 1),
        ];
      },
      plots: [
        { title: '车速', y: ['Vx'] },
        { title: '纵向加速度', y: ['Ax'] },
        { title: '发动机转速', y: ['EngineRpm'] },
        { title: '档位', y: ['Gear'] },
        { title: '驱动轮滑移率', y: ['Kappa_L1', 'Kappa_L2'] },
        { title: '前/后轴垂向载荷', y: ['Fz_L1', 'Fz_L2'] },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// 2. 直线制动
// ---------------------------------------------------------------------------
const braking: Procedure = {
  id: 'brake',
  name: '直线紧急制动',
  category: '制动性',
  standard: 'GB 21670 / ECE R13H · 100–0 km/h',
  description: '车辆以初速度稳定行驶 1 s 后以给定踏板开度紧急制动直至停车，计算制动距离、MFDD（充分发出的平均减速度）。',
  params: [
    { key: 'v0', label: '制动初速度', unit: 'km/h', type: 'number', default: 100, min: 20, max: 250, step: 5 },
    { key: 'pedal', label: '制动踏板开度', unit: '%', type: 'number', default: 100, min: 10, max: 100, step: 5 },
    muParam,
    override('abs', '防抱死 ABS'),
  ],
  setup(p) {
    const path = straightPath(-20, 3000);
    const steer = follower(path);
    const sc = new SpeedController();
    const v0 = p.v0 * KPH;
    const tb = 1.0;
    return {
      duration: 25,
      init: { speed: v0, x: 0, y: 0, yaw: 0 },
      road: { mu: p.mu },
      path, ribbonWidth: 8,
      controls: controlsFrom(p),
      driver: (veh, t, dt, ctx) => {
        const s = steer(veh, dt, ctx);
        if (t < tb) {
          ctx.targetSpeed = v0;
          return { steer: s, ...sc.update(veh, v0, dt) };
        }
        ctx.targetSpeed = 0;
        return { steer: s, throttle: 0, brake: (p.pedal / 100) * clamp((t - tb) / 0.1, 0, 1) };
      },
      stop: (veh, t) => t > tb + 0.3 && veh.u < 0.15,
      kpis: (r) => {
        const t = r.t, v = C(r, 'Vx'), x = C(r, 'X');
        const vb = valueAt(t, v, tb), xb = valueAt(t, x, tb);
        const xe = x[r.n - 1];
        const dist = xe - xb;
        const distCorr = dist * (p.v0 / vb) ** 2;
        const t08 = crossDown(t, v, 0.8 * vb, tb), t01 = crossDown(t, v, 0.1 * vb, tb);
        const sb = valueAt(t, x, t08), se = valueAt(t, x, t01);
        const mfdd = ((0.8 * vb) ** 2 - (0.1 * vb) ** 2) / (25.92 * (se - sb));
        const absT = meanIn(t, C(r, 'ABS'), tb, t[r.n - 1]) * 100;
        return [
          k('制动距离（按初速度修正）', distCorr, 'm', 2),
          k('实测制动距离', dist, 'm', 2),
          k('MFDD 平均减速度', mfdd, 'm/s²', 2, mfdd >= 6.43, '乘用车法规限值 ≥ 6.43 m/s²'),
          k('最大减速度', -minIn(t, C(r, 'Ax'), tb).value, 'g', 3),
          k('制动时间', t[r.n - 1] - tb, 's'),
          k('最大俯仰角（点头）', maxIn(t, C(r, 'Pitch'), tb).value, 'deg'),
          k('最大横摆角偏移', Math.abs(maxAbsIn(t, C(r, 'Yaw'), tb).value), 'deg', 2),
          k('ABS 工作时间占比', absT, '%', 0),
        ];
      },
      plots: [
        { title: '车速与轮速', y: ['Vx', 'Vw_L1', 'Vw_L2'] },
        { title: '纵向加速度', y: ['Ax'] },
        { title: '轮缸压力', y: ['Pbk_L1', 'Pbk_L2'] },
        { title: '车轮滑移率', y: ['Kappa_L1', 'Kappa_L2'] },
        { title: '前/后轴垂向载荷', y: ['Fz_L1', 'Fz_L2'] },
        { title: '车身俯仰角', y: ['Pitch'] },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// 3. 稳态回转（定半径）
// ---------------------------------------------------------------------------
function steadyStateKpis(r: SimResult, vp: VehicleParams, constantRadius: boolean, speed?: number): KPI[] {
  const t = r.t;
  const ay = movingAverage(C(r, 'Ay'), 50);
  const sw = movingAverage(C(r, 'Steer_SW'), 50);
  const roll = movingAverage(C(r, 'Roll'), 50);
  const beta = movingAverage(C(r, 'Beta'), 50);
  const ayMax = maxIn(t, ay).value;
  const hi = Math.min(0.4, 0.8 * ayMax);
  const xs: number[] = [], yS: number[] = [], yR: number[] = [], yB: number[] = [];
  for (let i = 0; i < r.n; i++) {
    if (t[i] < 2) continue;
    if (ay[i] >= 0.1 && ay[i] <= hi) { xs.push(ay[i]); yS.push(sw[i]); yR.push(roll[i]); yB.push(beta[i]); }
  }
  const fs = linearFit(xs, yS), fr = linearFit(xs, yR), fb = linearFit(xs, yB);
  const ratio = vp.steering.ratio;
  let usg = fs.k / ratio;
  if (!constantRadius && speed) {
    // 定车速：扣除阿克曼角随侧向加速度的变化 L/u²·g
    usg -= ((vp.body.wheelbase * GRAVITY) / (speed * speed)) * RAD;
  }
  const L = vp.body.wheelbase;
  const vchar = usg > 0 ? Math.sqrt((L * GRAVITY * RAD) / usg) * 3.6 : NaN;
  const iMax = idxAt(t, maxIn(t, ay).time);
  return [
    k('不足转向度 (USG)', usg, 'deg/g', 2, null, usg > 0 ? '不足转向' : '过度转向'),
    k('方向盘角梯度', fs.k, 'deg/g', 1),
    k('侧倾梯度', fr.k, 'deg/g', 2),
    k('质心侧偏角梯度', fb.k, 'deg/g', 2),
    k('特征车速', vchar, 'km/h', 0),
    k('最大稳态侧向加速度', ayMax, 'g', 3),
    k('达到最大侧向加速度时车速', C(r, 'Vx')[iMax], 'km/h', 1),
    k('线性区拟合 R²', fs.r2, '', 3),
  ];
}

const constRadius: Procedure = {
  id: 'const-radius',
  name: '稳态回转（定半径）',
  category: '操纵稳定性',
  standard: 'ISO 4138 / GB/T 6323',
  description: '沿固定半径圆周行驶，车速缓慢线性增加直至达到附着极限，由方向盘转角-侧向加速度曲线计算不足转向度、侧倾梯度等稳态特性。',
  params: [
    { key: 'radius', label: '圆周半径', unit: 'm', type: 'number', default: 40, min: 15, max: 200, step: 5 },
    { key: 'v0', label: '起始车速', unit: 'km/h', type: 'number', default: 20, min: 5, max: 100, step: 5 },
    { key: 'rate', label: '车速增长率', unit: 'km/h/s', type: 'number', default: 0.8, min: 0.1, max: 5, step: 0.1 },
    { key: 'vmax', label: '最高车速', unit: 'km/h', type: 'number', default: 120, min: 30, max: 250, step: 5 },
    muParam,
    override('esc', '车身稳定 ESC'),
  ],
  setup(p, vp) {
    const R = p.radius;
    const pts: PathPoint[] = [];
    const n = Math.ceil((2 * Math.PI * R) / 0.5);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      pts.push({ x: R * Math.cos(a), y: R + R * Math.sin(a) });
    }
    const path = new Path(pts, true);
    const steer = follower(path, 0.7);
    const sc = new SpeedController(0.8, 0.3);
    let lagTime = 0;
    return {
      duration: Math.min(300, (p.vmax - p.v0) / p.rate + 5),
      init: { speed: p.v0 * KPH, x: 0, y: 0, yaw: 0 },
      road: { mu: p.mu },
      path, ribbonWidth: 7,
      controls: controlsFrom(p),
      driver: (veh, t, dt, ctx) => {
        const s = steer(veh, dt, ctx);
        const vt = (p.v0 + p.rate * t) * KPH;
        ctx.targetSpeed = vt;
        return { steer: s, ...sc.update(veh, vt, dt) };
      },
      stop: (veh, t, ctx) => {
        if (t < 3) return false;
        if (Math.abs(ctx.pathError) > 3 || Math.abs(veh.beta) > 0.25) return true;
        // 无法再提高车速（已到附着极限）
        if (ctx.targetSpeed - veh.u > 2) lagTime += SIM_DT; else lagTime = 0;
        return lagTime > 4 || veh.u * 3.6 >= p.vmax;
      },
      kpis: (r) => steadyStateKpis(r, vp, true),
      plots: [
        { title: '方向盘转角 - 侧向加速度', x: 'Ay', y: ['Steer_SW'] },
        { title: '侧倾角 - 侧向加速度', x: 'Ay', y: ['Roll'] },
        { title: '质心侧偏角 - 侧向加速度', x: 'Ay', y: ['Beta'] },
        { title: '车速', y: ['Vx', 'VTarget'] },
        { title: '前/后轴侧偏角', y: ['Alpha_L1', 'Alpha_L2'] },
        XY_PLOT,
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// 4. 斜坡转向（定车速）
// ---------------------------------------------------------------------------
const rampSteer: Procedure = {
  id: 'ramp-steer',
  name: '斜坡转向（定车速）',
  category: '操纵稳定性',
  standard: 'ISO 13674-2 / SAE J266',
  description: '以恒定车速直线行驶，方向盘以恒定角速度缓慢增加，直至侧向加速度饱和或车辆失稳，评价稳态转向特性。',
  params: [
    { key: 'speed', label: '车速', unit: 'km/h', type: 'number', default: 100, min: 30, max: 200, step: 5 },
    { key: 'rate', label: '方向盘角速度', unit: 'deg/s', type: 'number', default: 13.5, min: 2, max: 100, step: 0.5 },
    { key: 'maxSW', label: '最大方向盘转角', unit: 'deg', type: 'number', default: 300, min: 30, max: 720, step: 10 },
    muParam,
    override('esc', '车身稳定 ESC'),
  ],
  setup(p, vp) {
    const sc = new SpeedController();
    const v = p.speed * KPH;
    const t0 = 1;
    return {
      duration: t0 + p.maxSW / p.rate + 1,
      init: { speed: v, x: 0, y: 0, yaw: 0 },
      road: { mu: p.mu },
      controls: controlsFrom(p),
      driver: (veh, t, dt, ctx) => {
        ctx.targetSpeed = v;
        return { steer: clamp((t - t0) * p.rate, 0, p.maxSW), ...sc.update(veh, v, dt) };
      },
      stop: (veh, t) => t > t0 + 2 && Math.abs(veh.beta) > 0.2,
      kpis: (r) => steadyStateKpis(r, vp, false, v),
      plots: [
        { title: '方向盘转角 - 侧向加速度', x: 'Ay', y: ['Steer_SW'] },
        { title: '侧倾角 - 侧向加速度', x: 'Ay', y: ['Roll'] },
        { title: '质心侧偏角 - 侧向加速度', x: 'Ay', y: ['Beta'] },
        { title: '横摆角速度', y: ['AVz'] },
        { title: '车速', y: ['Vx'] },
        XY_PLOT,
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// 5. 转向盘角阶跃
// ---------------------------------------------------------------------------
const stepSteer: Procedure = {
  id: 'step-steer',
  name: '转向盘角阶跃输入',
  category: '操纵稳定性',
  standard: 'ISO 7401 / GB/T 6323',
  description: '定速直线行驶后，方向盘以 500 deg/s 迅速转到给定角度并保持，油门保持不变，评价横摆角速度响应时间、超调量等瞬态特性。',
  params: [
    { key: 'speed', label: '车速', unit: 'km/h', type: 'number', default: 80, min: 20, max: 200, step: 5 },
    { key: 'amp', label: '方向盘转角', unit: 'deg', type: 'number', default: 60, min: -540, max: 540, step: 5, help: '正值左转；一般取稳态侧向加速度 0.4 g 对应转角' },
    { key: 'rate', label: '转向速率', unit: 'deg/s', type: 'number', default: 500, min: 50, max: 1500, step: 50 },
    { key: 'dur', label: '仿真时长', unit: 's', type: 'number', default: 6, min: 3, max: 20, step: 1 },
    muParam,
    override('esc', '车身稳定 ESC'),
  ],
  setup(p) {
    const sc = new SpeedController();
    const v = p.speed * KPH;
    const t0 = 1;
    const A = p.amp;
    let thrHold = 0;
    return {
      duration: p.dur,
      init: { speed: v, x: 0, y: 0, yaw: 0 },
      road: { mu: p.mu },
      controls: controlsFrom(p),
      driver: (veh, t, dt, ctx) => {
        ctx.targetSpeed = v;
        const steer = A * clamp(((t - t0) * p.rate) / Math.abs(A), 0, 1);
        if (t < t0) {
          const c = sc.update(veh, v, dt);
          thrHold = c.throttle;
          return { steer, ...c };
        }
        return { steer, throttle: thrHold, brake: 0 };
      },
      kpis: (r) => {
        const t = r.t, rr = C(r, 'AVz'), ay = C(r, 'Ay');
        const sgn = Math.sign(A) || 1;
        const tEnd = t[r.n - 1];
        const t50 = t0 + (0.5 * Math.abs(A)) / p.rate;
        const rss = meanIn(t, rr, tEnd - 1, tEnd);
        const ayss = meanIn(t, ay, tEnd - 1, tEnd);
        const rS = Array.from(rr, (x) => x * sgn);
        const ayS = Array.from(ay, (x) => x * sgn);
        const tr90 = crossUp(t, rS, 0.9 * Math.abs(rss), t0) - t50;
        const ta90 = crossUp(t, ayS, 0.9 * Math.abs(ayss), t0) - t50;
        const pk = maxIn(t, rS, t0);
        const overshoot = (pk.value / Math.abs(rss) - 1) * 100;
        const betaSS = meanIn(t, C(r, 'Beta'), tEnd - 1, tEnd);
        return [
          k('稳态横摆角速度', rss, 'deg/s', 2),
          k('横摆角速度增益', rss / A, '1/s', 3),
          k('稳态侧向加速度', ayss, 'g', 3),
          k('横摆角速度响应时间 (90%)', tr90, 's', 3),
          k('横摆角速度峰值响应时间', pk.time - t50, 's', 3),
          k('横摆角速度超调量', overshoot, '%', 1),
          k('侧向加速度响应时间 (90%)', ta90, 's', 3),
          k('稳态侧倾角', meanIn(t, C(r, 'Roll'), tEnd - 1, tEnd), 'deg', 2),
          k('稳态质心侧偏角', betaSS, 'deg', 2),
          k('TB 值', (pk.time - t50) * Math.abs(betaSS), 's·deg', 3),
        ];
      },
      plots: [
        { title: '方向盘转角', y: ['Steer_SW'] },
        { title: '横摆角速度', y: ['AVz'] },
        { title: '侧向加速度', y: ['Ay'] },
        { title: '车身侧倾角', y: ['Roll'] },
        { title: '质心侧偏角', y: ['Beta'] },
        { title: '车速', y: ['Vx'] },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// 6. 正弦停滞（FMVSS 126 ESC 法规试验）
// ---------------------------------------------------------------------------
const sineDwell: Procedure = {
  id: 'sine-dwell',
  name: '正弦停滞 (Sine with Dwell)',
  category: '主动安全',
  standard: 'FMVSS 126 / GB/T 30677 ESC',
  description: '80 km/h 滑行，方向盘 0.7 Hz 正弦输入并在第二峰值保持 500 ms，按法规评价横摆角速度比 (1.0 s ≤35%，1.75 s ≤20%) 和侧向位移 (≥1.83 m)。',
  params: [
    { key: 'speed', label: '车速', unit: 'km/h', type: 'number', default: 80, min: 40, max: 150, step: 5 },
    { key: 'amp', label: '方向盘幅值', unit: 'deg', type: 'number', default: 180, min: 20, max: 540, step: 10, help: '法规取 6.5×δ(0.3g)，并逐级增大到 270°' },
    { key: 'freq', label: '正弦频率', unit: 'Hz', type: 'number', default: 0.7, min: 0.2, max: 2, step: 0.1 },
    { key: 'dwell', label: '停滞时间', unit: 's', type: 'number', default: 0.5, min: 0, max: 2, step: 0.1 },
    { key: 'dir', label: '首个转向方向', type: 'select', default: 'left', options: [{ value: 'left', label: '向左' }, { value: 'right', label: '向右' }] },
    muParam,
    override('esc', '车身稳定 ESC'),
  ],
  setup(p) {
    const sc = new SpeedController();
    const v = p.speed * KPH;
    const t0 = 1.0;
    const T = 1 / p.freq;
    const A = p.dir === 'right' ? -p.amp : p.amp;
    const cos = t0 + T + p.dwell;
    const steerAt = (t: number) => {
      const tau = t - t0;
      if (tau < 0) return 0;
      if (tau < 0.75 * T) return A * Math.sin(2 * Math.PI * p.freq * tau);
      if (tau < 0.75 * T + p.dwell) return -A;
      if (tau < T + p.dwell) return A * Math.sin(2 * Math.PI * p.freq * (tau - p.dwell));
      return 0;
    };
    return {
      duration: cos + 3,
      init: { speed: v, x: 0, y: 0, yaw: 0 },
      road: { mu: p.mu },
      controls: controlsFrom(p),
      driver: (veh, t, dt, ctx) => {
        ctx.targetSpeed = t < t0 ? v : NaN;
        if (t < t0) return { steer: 0, ...sc.update(veh, v, dt) };
        return { steer: steerAt(t), throttle: 0, brake: 0 };
      },
      kpis: (r) => {
        const t = r.t, rr = C(r, 'AVz'), Y = C(r, 'Y');
        const sgn = Math.sign(A);
        // 第二个横摆角速度峰值（与首个转向方向相反）
        const win = Array.from(rr, (x) => -x * sgn);
        const pk = maxIn(t, win, t0 + 0.25 * T, cos + 0.6);
        const rPeak = -pk.value * sgn;
        const yrr1 = (valueAt(t, rr, cos + 1.0) / rPeak) * 100;
        const yrr2 = (valueAt(t, rr, cos + 1.75) / rPeak) * 100;
        const latDisp = (valueAt(t, Y, t0 + 1.07) - valueAt(t, Y, t0)) * sgn;
        const escT = meanIn(t, C(r, 'ESC'), t0, cos + 2) * (cos + 2 - t0);
        return [
          k('横摆角速度峰值', rPeak, 'deg/s', 2),
          k('横摆角速度比 @COS+1.0s', yrr1, '%', 1, yrr1 <= 35, '法规 ≤ 35%'),
          k('横摆角速度比 @COS+1.75s', yrr2, '%', 1, yrr2 <= 20, '法规 ≤ 20%'),
          k('侧向位移 @BOS+1.07s', latDisp, 'm', 2, latDisp >= 1.83, '法规 ≥ 1.83 m（M1类）'),
          k('最大质心侧偏角', Math.abs(maxAbsIn(t, C(r, 'Beta'), t0).value), 'deg', 2),
          k('最大侧向加速度', Math.abs(maxAbsIn(t, C(r, 'Ay'), t0).value), 'g', 3),
          k('ESC 介入时长', escT, 's', 2),
        ];
      },
      plots: [
        { title: '方向盘转角', y: ['Steer_SW'] },
        { title: '横摆角速度', y: ['AVz'] },
        { title: '侧向加速度', y: ['Ay'] },
        { title: '质心侧偏角', y: ['Beta'] },
        { title: 'ESC 轮缸压力', y: ['Pbk_L1', 'Pbk_R1', 'Pbk_L2', 'Pbk_R2'] },
        XY_PLOT,
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// 7. 双移线（ISO 3888-1）
// ---------------------------------------------------------------------------
interface Gate { x0: number; x1: number; c: number; w: number }

function dlcLayout(width: number) {
  const W1 = 1.1 * width + 0.25;
  const W3 = width + 1.0;
  const W5 = 1.3 * width + 0.25;
  const c1 = 0, c3 = 3.5, c5 = (W5 - W1) / 2;
  const gates: Gate[] = [
    { x0: 0, x1: 15, c: c1, w: W1 },
    { x0: 45, x1: 70, c: c3, w: W3 },
    { x0: 95, x1: 110, c: c5, w: W5 },
  ];
  const yRef = (x: number) => {
    if (x < 12) return c1;
    if (x < 48) return c1 + (c3 - c1) * cosStep((x - 12) / 36);
    if (x < 67) return c3;
    if (x < 98) return c3 + (c5 - c3) * cosStep((x - 67) / 31);
    return c5;
  };
  const cones: Cone[] = [];
  for (const g of gates) {
    const n = Math.max(2, Math.round((g.x1 - g.x0) / 3));
    for (let i = 0; i <= n; i++) {
      const x = g.x0 + ((g.x1 - g.x0) * i) / n;
      cones.push({ x, y: g.c + g.w / 2 + 0.1 }, { x, y: g.c - g.w / 2 - 0.1 });
    }
  }
  return { gates, yRef, cones };
}

/** 统计车身外廓越出通道的路段数 */
function gateViolations(r: SimResult, gates: Gate[]): number {
  const fp = footprint(r.vehicle);
  const X = C(r, 'X'), Y = C(r, 'Y'), yaw = C(r, 'Yaw');
  const bad = new Set<number>();
  const corners = [[fp.xf, fp.hw], [fp.xf, -fp.hw], [fp.xr, fp.hw], [fp.xr, -fp.hw]];
  for (let i = 0; i < r.n; i++) {
    const c = Math.cos(yaw[i] / RAD), s = Math.sin(yaw[i] / RAD);
    for (const [cx, cy] of corners) {
      const wx = X[i] + c * cx - s * cy;
      const wy = Y[i] + s * cx + c * cy;
      gates.forEach((g, gi) => {
        if (wx >= g.x0 && wx <= g.x1 && Math.abs(wy - g.c) > g.w / 2) bad.add(gi);
      });
    }
  }
  return bad.size;
}

const doubleLane: Procedure = {
  id: 'dlc',
  name: '双移线 (Double Lane Change)',
  category: '操纵稳定性',
  standard: 'ISO 3888-1',
  description: '闭环驾驶员按标准桩位通过双移线通道，评价紧急避让时的操纵性与稳定性，统计车身越出通道情况。',
  params: [
    { key: 'speed', label: '车速', unit: 'km/h', type: 'number', default: 80, min: 30, max: 160, step: 5 },
    { key: 'preview', label: '驾驶员预瞄时间', unit: 's', type: 'number', default: 0.5, min: 0.3, max: 2, step: 0.05 },
    muParam,
    override('esc', '车身稳定 ESC'),
  ],
  setup(p, vp) {
    const lay = dlcLayout(vp.body.width);
    const path = Path.fromFunction(-80, 260, lay.yRef, 0.5);
    const steer = follower(path, p.preview);
    const sc = new SpeedController();
    const v = p.speed * KPH;
    return {
      duration: 30,
      init: { speed: v, x: -60, y: 0, yaw: 0 },
      road: { mu: p.mu },
      path, ribbonWidth: 12,
      cones: lay.cones,
      controls: controlsFrom(p),
      driver: (veh, _t, dt, ctx) => {
        ctx.targetSpeed = v;
        return { steer: steer(veh, dt, ctx), ...sc.update(veh, v, dt) };
      },
      stop: (veh) => veh.X > 170,
      kpis: (r) => {
        const t = r.t;
        const x = C(r, 'X');
        const tA = crossUp(t, x, -5), tB = crossUp(t, x, 130);
        const viol = gateViolations(r, lay.gates);
        return [
          k('越出通道路段数', viol, '段', 0, viol === 0, '0 为通过'),
          k('最大方向盘转角', Math.abs(maxAbsIn(t, C(r, 'Steer_SW'), tA, tB).value), 'deg', 1),
          k('最大侧向加速度', Math.abs(maxAbsIn(t, C(r, 'Ay'), tA, tB).value), 'g', 3),
          k('最大横摆角速度', Math.abs(maxAbsIn(t, C(r, 'AVz'), tA, tB).value), 'deg/s', 1),
          k('最大质心侧偏角', Math.abs(maxAbsIn(t, C(r, 'Beta'), tA, tB).value), 'deg', 2),
          k('最大侧倾角', Math.abs(maxAbsIn(t, C(r, 'Roll'), tA, tB).value), 'deg', 2),
          k('最大路径偏差', Math.abs(maxAbsIn(t, C(r, 'PathErr'), tA, tB).value), 'm', 2),
          k('出口车速', valueAt(t, C(r, 'Vx'), tB), 'km/h', 1),
        ];
      },
      plots: [
        XY_PLOT,
        { title: '方向盘转角', y: ['Steer_SW'] },
        { title: '侧向加速度', y: ['Ay'] },
        { title: '横摆角速度', y: ['AVz'] },
        { title: '质心侧偏角', y: ['Beta'] },
        { title: '车身侧倾角', y: ['Roll'] },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// 8. 蛇行试验
// ---------------------------------------------------------------------------
const slalom: Procedure = {
  id: 'slalom',
  name: '蛇行试验 (Slalom)',
  category: '操纵稳定性',
  standard: 'GB/T 6323 蛇行试验',
  description: '按等间距标桩蛇行穿越，评价车辆在连续交替转向时的随动性、收敛性和稳定性。',
  params: [
    { key: 'speed', label: '车速', unit: 'km/h', type: 'number', default: 65, min: 20, max: 140, step: 5 },
    { key: 'spacing', label: '标桩间距', unit: 'm', type: 'number', default: 30, min: 12, max: 50, step: 1 },
    { key: 'count', label: '标桩数量', unit: '个', type: 'number', default: 8, min: 3, max: 20, step: 1 },
    { key: 'amp', label: '路径侧向幅值', unit: 'm', type: 'number', default: 1.6, min: 0.8, max: 4, step: 0.1 },
    muParam,
    override('esc', '车身稳定 ESC'),
  ],
  setup(p) {
    const d = p.spacing, n = p.count, A = p.amp;
    const xEnd = n * d;
    const path = Path.fromFunction(-80, xEnd + 150, (x) => (x > 0 && x < xEnd ? A * Math.sin((Math.PI * x) / d) : 0), 0.5);
    const cones: Cone[] = [];
    for (let i = 0; i < n; i++) cones.push({ x: d / 2 + i * d, y: 0 });
    const steer = follower(path, 0.8);
    const sc = new SpeedController();
    const v = p.speed * KPH;
    return {
      duration: (xEnd + 160) / v + 2,
      init: { speed: v, x: -60, y: 0, yaw: 0 },
      road: { mu: p.mu },
      path, ribbonWidth: 2 * A + 8,
      cones,
      controls: controlsFrom(p),
      driver: (veh, _t, dt, ctx) => {
        ctx.targetSpeed = v;
        return { steer: steer(veh, dt, ctx), ...sc.update(veh, v, dt) };
      },
      stop: (veh) => veh.X > xEnd + 60,
      kpis: (r) => {
        const t = r.t;
        const x = C(r, 'X'), Y = C(r, 'Y');
        const tA = crossUp(t, x, d), tB = crossUp(t, x, xEnd - d);
        const i0 = idxAt(t, tA), i1 = idxAt(t, tB);
        const avgPeak = (key: string) => {
          const y = C(r, key);
          const pk = peaks(y, i0, i1, 1e-3);
          return pk.length ? pk.reduce((s, i) => s + Math.abs(y[i]), 0) / pk.length : NaN;
        };
        const hw = r.vehicle.body.width / 2;
        let hits = 0;
        for (const c of cones) {
          const tc = crossUp(t, x, c.x);
          if (Number.isFinite(tc) && Math.abs(valueAt(t, Y, tc) - c.y) < hw + 0.1) hits++;
        }
        return [
          k('碰桩数', hits, '个', 0, hits === 0),
          k('平均方向盘转角峰值', avgPeak('Steer_SW'), 'deg', 1),
          k('平均横摆角速度峰值', avgPeak('AVz'), 'deg/s', 2),
          k('平均侧向加速度峰值', avgPeak('Ay'), 'g', 3),
          k('平均侧倾角峰值', avgPeak('Roll'), 'deg', 2),
          k('最大质心侧偏角', Math.abs(maxAbsIn(t, C(r, 'Beta'), tA, tB).value), 'deg', 2),
          k('平均车速', meanIn(t, C(r, 'Vx'), tA, tB), 'km/h', 1),
        ];
      },
      plots: [
        XY_PLOT,
        { title: '方向盘转角', y: ['Steer_SW'] },
        { title: '横摆角速度', y: ['AVz'] },
        { title: '侧向加速度', y: ['Ay'] },
        { title: '车身侧倾角', y: ['Roll'] },
        { title: '质心侧偏角', y: ['Beta'] },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// 9. 鱼钩试验（侧翻）
// ---------------------------------------------------------------------------
const fishhook: Procedure = {
  id: 'fishhook',
  name: '鱼钩试验 (Fishhook)',
  category: '主动安全',
  standard: 'NHTSA Fishhook 动态侧翻',
  description: '滑行状态下方向盘以 720 deg/s 转至幅值、短暂保持后反向打至负幅值并保持 3 s，评价车轮离地与动态侧翻倾向。',
  params: [
    { key: 'speed', label: '车速', unit: 'km/h', type: 'number', default: 72, min: 30, max: 130, step: 2 },
    { key: 'amp', label: '方向盘幅值', unit: 'deg', type: 'number', default: 270, min: 30, max: 540, step: 10 },
    { key: 'rate', label: '转向速率', unit: 'deg/s', type: 'number', default: 720, min: 100, max: 1500, step: 20 },
    { key: 'dwell', label: '首次保持时间', unit: 's', type: 'number', default: 0.25, min: 0, max: 1, step: 0.05 },
    { key: 'dir', label: '首个转向方向', type: 'select', default: 'left', options: [{ value: 'left', label: '向左' }, { value: 'right', label: '向右' }] },
    muParam,
    override('esc', '车身稳定 ESC'),
  ],
  setup(p) {
    const sc = new SpeedController();
    const v = p.speed * KPH;
    const t0 = 1;
    const A = p.dir === 'right' ? -p.amp : p.amp;
    const t1 = Math.abs(A) / p.rate;
    const t2 = t1 + p.dwell;
    const t3 = t2 + (2 * Math.abs(A)) / p.rate;
    const t4 = t3 + 3;
    const t5 = t4 + Math.abs(A) / p.rate;
    const steerAt = (t: number) => {
      const tau = t - t0;
      if (tau <= 0) return 0;
      if (tau < t1) return (A * tau) / t1;
      if (tau < t2) return A;
      if (tau < t3) return A - (2 * A * (tau - t2)) / (t3 - t2);
      if (tau < t4) return -A;
      if (tau < t5) return -A + (A * (tau - t4)) / (t5 - t4);
      return 0;
    };
    return {
      duration: t0 + t5 + 1,
      init: { speed: v, x: 0, y: 0, yaw: 0 },
      road: { mu: p.mu },
      controls: controlsFrom(p),
      driver: (veh, t, dt, ctx) => {
        ctx.targetSpeed = t < t0 ? v : NaN;
        if (t < t0) return { steer: 0, ...sc.update(veh, v, dt) };
        return { steer: steerAt(t), throttle: 0, brake: 0 };
      },
      kpis: (r) => {
        const t = r.t;
        const fz = ['Fz_L1', 'Fz_R1', 'Fz_L2', 'Fz_R2'].map((key) => C(r, key));
        let liftTime = 0, twoWheel = 0;
        for (let i = 0; i < r.n; i++) {
          const lift = fz.map((f) => f[i] < 50);
          if (lift.some((x) => x)) liftTime += r.dtOut;
          if ((lift[0] && lift[2]) || (lift[1] && lift[3])) twoWheel += r.dtOut;
        }
        const minFz = Math.min(...fz.map((f) => minIn(t, f, t0).value));
        return [
          k('最大侧倾角', Math.abs(maxAbsIn(t, C(r, 'Roll'), t0).value), 'deg', 2),
          k('最大侧向加速度', Math.abs(maxAbsIn(t, C(r, 'Ay'), t0).value), 'g', 3),
          k('最小车轮垂向力', minFz, 'N', 0),
          k('单轮离地累计时间', liftTime, 's', 2),
          k('同侧两轮离地时间', twoWheel, 's', 2, twoWheel < 0.01, 'NHTSA 判据：同侧两轮离地 ≥ 50 mm 判为侧翻倾向'),
          k('最大质心侧偏角', Math.abs(maxAbsIn(t, C(r, 'Beta'), t0).value), 'deg', 2),
          k('最大横摆角速度', Math.abs(maxAbsIn(t, C(r, 'AVz'), t0).value), 'deg/s', 1),
        ];
      },
      plots: [
        { title: '方向盘转角', y: ['Steer_SW'] },
        { title: '车身侧倾角', y: ['Roll'] },
        { title: '侧向加速度', y: ['Ay'] },
        { title: '车轮垂向力', y: ['Fz_L1', 'Fz_R1', 'Fz_L2', 'Fz_R2'] },
        { title: '横摆角速度', y: ['AVz'] },
        { title: '质心侧偏角', y: ['Beta'] },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// 10. 对开路面制动
// ---------------------------------------------------------------------------
const splitMu: Procedure = {
  id: 'split-mu',
  name: '对开路面制动 (Split-μ)',
  category: '制动性',
  standard: 'ISO 14512 / GB 21670 附录',
  description: '一侧低附着（冰雪）、另一侧高附着路面上紧急制动，评价制动跑偏、横摆稳定性和 ABS 的选择控制效果。',
  params: [
    { key: 'v0', label: '制动初速度', unit: 'km/h', type: 'number', default: 80, min: 20, max: 160, step: 5 },
    { key: 'muHigh', label: '高附着系数', type: 'number', default: 1.0, min: 0.3, max: 1.5, step: 0.05 },
    { key: 'muLow', label: '低附着系数', type: 'number', default: 0.2, min: 0.05, max: 1, step: 0.05 },
    { key: 'side', label: '低附着侧', type: 'select', default: 'left', options: [{ value: 'left', label: '左侧' }, { value: 'right', label: '右侧' }] },
    { key: 'steerMode', label: '转向方式', type: 'select', default: 'closed', options: [{ value: 'closed', label: '驾驶员闭环修正' }, { value: 'open', label: '方向盘固定不动' }] },
    override('abs', '防抱死 ABS'),
  ],
  setup(p) {
    const path = straightPath(-100, 1500);
    const steer = follower(path, 1.0);
    const sc = new SpeedController();
    const v0 = p.v0 * KPH;
    let tb = -1;
    const left = p.side === 'left';
    return {
      duration: 25,
      init: { speed: v0, x: -40, y: 0, yaw: 0 },
      road: {
        mu: p.muHigh,
        muPatches: [{ x0: 0, x1: 1500, y0: left ? 0 : -50, y1: left ? 50 : 0, mu: p.muLow, label: '低附着' }],
      },
      path, ribbonWidth: 8,
      controls: controlsFrom(p),
      driver: (veh, t, dt, ctx) => {
        let s = steer(veh, dt, ctx);
        if (p.steerMode === 'open' && veh.X >= 0) s = 0;
        if (tb < 0 && veh.X >= 0) tb = t;
        if (tb < 0) {
          ctx.targetSpeed = v0;
          return { steer: s, ...sc.update(veh, v0, dt) };
        }
        ctx.targetSpeed = 0;
        return { steer: s, throttle: 0, brake: clamp((t - tb) / 0.1, 0, 1) };
      },
      stop: (veh, t) => tb > 0 && t > tb + 0.3 && veh.u < 0.15,
      kpis: (r) => {
        const t = r.t, x = C(r, 'X');
        const tB = crossUp(t, x, 0);
        return [
          k('制动距离', x[r.n - 1], 'm', 2),
          k('制动时间', t[r.n - 1] - tB, 's', 2),
          k('最大横摆角', Math.abs(maxAbsIn(t, C(r, 'Yaw'), tB).value), 'deg', 2, Math.abs(maxAbsIn(t, C(r, 'Yaw'), tB).value) < 8, '经验限值 < 8°'),
          k('最大侧向偏移', Math.abs(maxAbsIn(t, C(r, 'Y'), tB).value), 'm', 2),
          k('最大方向盘修正角', Math.abs(maxAbsIn(t, C(r, 'Steer_SW'), tB).value), 'deg', 1),
          k('最大横摆角速度', Math.abs(maxAbsIn(t, C(r, 'AVz'), tB).value), 'deg/s', 2),
          k('平均减速度', -meanIn(t, C(r, 'Ax'), tB + 0.3, t[r.n - 1] - 0.2), 'g', 3),
        ];
      },
      plots: [
        { title: '车速与轮速', y: ['Vx', 'Vw_L1', 'Vw_R1'] },
        { title: '横摆角', y: ['Yaw'] },
        { title: '方向盘转角', y: ['Steer_SW'] },
        { title: '轮缸压力', y: ['Pbk_L1', 'Pbk_R1', 'Pbk_L2', 'Pbk_R2'] },
        { title: '横摆角速度', y: ['AVz'] },
        XY_PLOT,
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// 11. 单凸块冲击（平顺性）
// ---------------------------------------------------------------------------
const bump: Procedure = {
  id: 'bump',
  name: '凸块冲击 (平顺性)',
  category: '平顺性',
  standard: 'GB/T 5902 脉冲输入',
  description: '车辆匀速驶过正弦形凸块，评价车身垂向冲击加速度、俯仰响应、悬架行程与车轮动载。',
  params: [
    { key: 'speed', label: '车速', unit: 'km/h', type: 'number', default: 40, min: 5, max: 120, step: 5 },
    { key: 'height', label: '凸块高度', unit: 'mm', type: 'number', default: 50, min: -100, max: 150, step: 5, help: '负值为凹坑' },
    { key: 'length', label: '凸块长度', unit: 'm', type: 'number', default: 0.5, min: 0.1, max: 5, step: 0.1 },
    { key: 'side', label: '作用位置', type: 'select', default: 'both', options: [{ value: 'both', label: '左右同时' }, { value: 'left', label: '仅左侧' }, { value: 'right', label: '仅右侧' }] },
  ],
  setup(p) {
    const path = straightPath(-20, 600);
    const steer = follower(path);
    const sc = new SpeedController();
    const v = p.speed * KPH;
    const xb = 20;
    return {
      duration: (xb + 30) / v + 2.5,
      init: { speed: v, x: 0, y: 0, yaw: 0 },
      road: { mu: 1, bump: { x0: xb, length: p.length, height: p.height / 1000, side: p.side } },
      path, ribbonWidth: 7,
      driver: (veh, _t, dt, ctx) => {
        ctx.targetSpeed = v;
        return { steer: steer(veh, dt, ctx), ...sc.update(veh, v, dt) };
      },
      kpis: (r) => {
        const t = r.t;
        const tA = crossUp(t, C(r, 'X'), xb - 5);
        const fz = (key: string) => C(r, key);
        const fz0F = fz('Fz_L1')[0], fz0R = fz('Fz_L2')[0];
        return [
          k('车身垂向加速度峰值 (+)', maxIn(t, C(r, 'Az'), tA).value, 'g', 3),
          k('车身垂向加速度峰值 (−)', minIn(t, C(r, 'Az'), tA).value, 'g', 3),
          k('最大俯仰角', Math.abs(maxAbsIn(t, C(r, 'Pitch'), tA).value), 'deg', 3),
          k('最大俯仰角速度', Math.abs(maxAbsIn(t, C(r, 'AVy'), tA).value), 'deg/s', 2),
          k('前悬架最大压缩', Math.max(maxIn(t, C(r, 'Comp_L1'), tA).value, maxIn(t, C(r, 'Comp_R1'), tA).value), 'mm', 1),
          k('后悬架最大压缩', Math.max(maxIn(t, C(r, 'Comp_L2'), tA).value, maxIn(t, C(r, 'Comp_R2'), tA).value), 'mm', 1),
          k('前轮最大动载系数', maxIn(t, fz('Fz_L1'), tA).value / fz0F, '', 2),
          k('前轮最小载荷系数', Math.min(minIn(t, fz('Fz_L1'), tA).value, minIn(t, fz('Fz_R1'), tA).value) / fz0F, '', 2),
          k('后轮最小载荷系数', Math.min(minIn(t, fz('Fz_L2'), tA).value, minIn(t, fz('Fz_R2'), tA).value) / fz0R, '', 2),
        ];
      },
      plots: [
        { title: '车身垂向加速度', y: ['Az'] },
        { title: '车身俯仰角', y: ['Pitch'] },
        { title: '悬架压缩量', y: ['Comp_L1', 'Comp_L2'] },
        { title: '车轮垂向力', y: ['Fz_L1', 'Fz_L2'] },
        { title: '路面高度', y: ['Zroad_L1', 'Zroad_L2'] },
        { title: '车身侧倾角', y: ['Roll'] },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// 12. 随机路面平顺性
// ---------------------------------------------------------------------------
const randomRoad: Procedure = {
  id: 'random-road',
  name: '随机路面 (平顺性)',
  category: '平顺性',
  standard: 'ISO 8608 / GB/T 4970',
  description: '按 ISO 8608 路面不平度等级生成随机路面，车辆匀速行驶，统计车身加速度均方根值、车轮动载与悬架行程。',
  params: [
    { key: 'cls', label: '路面等级', type: 'select', default: 'C', options: ['A', 'B', 'C', 'D', 'E'].map((c) => ({ value: c, label: `${c} 级${c === 'A' ? '（很好）' : c === 'B' ? '（好）' : c === 'C' ? '（一般）' : c === 'D' ? '（差）' : '（很差）'}` })) },
    { key: 'speed', label: '车速', unit: 'km/h', type: 'number', default: 60, min: 10, max: 150, step: 5 },
    { key: 'length', label: '路段长度', unit: 'm', type: 'number', default: 300, min: 50, max: 2000, step: 50 },
    { key: 'seed', label: '随机种子', type: 'number', default: 1, min: 1, max: 9999, step: 1 },
  ],
  setup(p) {
    const path = straightPath(-20, p.length + 400);
    const steer = follower(path);
    const sc = new SpeedController();
    const v = p.speed * KPH;
    const x0 = 20;
    return {
      duration: (p.length + x0 + 10) / v,
      init: { speed: v, x: 0, y: 0, yaw: 0 },
      road: { mu: 1, random: { cls: p.cls, x0, x1: x0 + p.length, seed: p.seed } },
      path, ribbonWidth: 7,
      driver: (veh, _t, dt, ctx) => {
        ctx.targetSpeed = v;
        return { steer: steer(veh, dt, ctx), ...sc.update(veh, v, dt) };
      },
      kpis: (r) => {
        const t = r.t;
        const tA = crossUp(t, C(r, 'X'), x0 + 10);
        const tB = t[r.n - 1];
        const az = Array.from(C(r, 'Az'), (a) => a * GRAVITY);
        const dyn = (key: string) => rmsIn(t, C(r, key), tA, tB, true) / C(r, key)[0];
        let lift = 0, cnt = 0;
        for (const key of ['Fz_L1', 'Fz_R1', 'Fz_L2', 'Fz_R2']) {
          const f = C(r, key);
          for (let i = idxAt(t, tA); i < r.n; i++) { cnt++; if (f[i] < 50) lift++; }
        }
        return [
          k('车身垂向加速度 RMS', rmsIn(t, az, tA, tB, true), 'm/s²', 3),
          k('俯仰角速度 RMS', rmsIn(t, C(r, 'AVy'), tA, tB, true), 'deg/s', 3),
          k('侧倾角速度 RMS', rmsIn(t, C(r, 'AVx'), tA, tB, true), 'deg/s', 3),
          k('前轮相对动载 RMS', dyn('Fz_L1') * 100, '%', 1),
          k('后轮相对动载 RMS', dyn('Fz_L2') * 100, '%', 1),
          k('前悬架行程 RMS', rmsIn(t, C(r, 'Comp_L1'), tA, tB, true), 'mm', 2),
          k('最大悬架压缩量', Math.max(...['Comp_L1', 'Comp_R1', 'Comp_L2', 'Comp_R2'].map((key) => maxIn(t, C(r, key), tA).value)), 'mm', 1),
          k('车轮离地时间比例', (lift / Math.max(cnt, 1)) * 100, '%', 2),
        ];
      },
      plots: [
        { title: '车身垂向加速度', y: ['Az'] },
        { title: '路面高度', y: ['Zroad_L1', 'Zroad_R1'] },
        { title: '悬架压缩量', y: ['Comp_L1', 'Comp_L2'] },
        { title: '车轮垂向力', y: ['Fz_L1', 'Fz_L2'] },
        { title: '车身俯仰角', y: ['Pitch'] },
        { title: '车身侧倾角', y: ['Roll'] },
      ],
    };
  },
};

// ---------------------------------------------------------------------------
// 13. 赛道单圈
// ---------------------------------------------------------------------------
export const TRACK_CONTROL_POINTS: PathPoint[] = [
  { x: 0, y: 0 }, { x: 250, y: 0 }, { x: 330, y: 40 }, { x: 340, y: 120 }, { x: 280, y: 170 },
  { x: 200, y: 150 }, { x: 150, y: 190 }, { x: 160, y: 260 }, { x: 90, y: 300 }, { x: -20, y: 280 },
  { x: -80, y: 200 }, { x: -60, y: 120 }, { x: -100, y: 60 }, { x: -70, y: 10 },
];

/** 闭合 Catmull-Rom 样条 + 等距重采样 */
export function buildSplineTrack(ctrl: PathPoint[], ds = 1): Path {
  const n = ctrl.length;
  const dense: PathPoint[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let j = 0; j < 400; j++) {
      const t = j / 400, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  const raw = new Path(dense, true);
  const out: PathPoint[] = [];
  const m = Math.floor(raw.length / ds);
  for (let i = 0; i < m; i++) {
    const q = raw.pointAt((i * raw.length) / m);
    out.push({ x: q.x, y: q.y });
  }
  return new Path(out, true);
}

/** 基于曲率与附着/动力限制的速度规划（前向-后向两遍法） */
export function speedProfile(path: Path, vp: VehicleParams, mu: number, util: number): Float64Array {
  const kap = path.curvature();
  const n = kap.length;
  const d = computeDerived(vp);
  const muT = mu * Math.min(vp.tireFront.muY, vp.tireRear.muY) * util;
  const vmax = Math.min(d.topSpeedKph / 3.6, 70);
  const v = new Float64Array(n);
  // 曲率平滑（±15 m 三角窗），抑制样条重采样带来的曲率噪声
  const ks = new Float64Array(n);
  const W = 15;
  for (let i = 0; i < n; i++) {
    let s = 0, wsum = 0;
    for (let j = -W; j <= W; j++) {
      const w = W + 1 - Math.abs(j);
      s += w * Math.abs(kap[(i + j + n) % n]);
      wsum += w;
    }
    ks[i] = s / wsum;
  }
  for (let i = 0; i < n; i++) v[i] = Math.min(vmax, Math.sqrt((muT * GRAVITY) / Math.max(ks[i], 1e-4)));
  const pw = d.peakPowerKw * 1000 * 0.8;
  // 相邻点间弧长（闭合路径首尾为重合点，弧长为 0）
  const segLen = (a: number, b: number) => {
    let ds = path.s[a] - path.s[b];
    if (ds < 0) ds += path.length;
    return ds > path.length / 2 ? 0 : ds;
  };
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < 2 * n; i++) {
      const a = i % n, b = (i - 1) % n;
      const ds = segLen(a, b);
      const aLat = v[b] * v[b] * ks[b];
      const aRem = Math.sqrt(Math.max(0, (muT * GRAVITY) ** 2 - aLat * aLat));
      const aAcc = Math.min(aRem, pw / (d.totalMass * Math.max(v[b], 5)));
      v[a] = Math.min(v[a], Math.sqrt(v[b] * v[b] + 2 * aAcc * ds));
    }
    for (let i = 2 * n - 2; i >= 0; i--) {
      const a = i % n, b = (i + 1) % n;
      const ds = segLen(b, a);
      const aLat = v[b] * v[b] * ks[b];
      const aRem = Math.sqrt(Math.max(0, (muT * GRAVITY) ** 2 - aLat * aLat));
      v[a] = Math.min(v[a], Math.sqrt(v[b] * v[b] + 2 * aRem * 0.9 * ds));
    }
  }
  return v;
}

const lap: Procedure = {
  id: 'lap',
  name: '赛道单圈 (圈速)',
  category: '综合',
  standard: '虚拟赛道 1.6 km',
  description: '驾驶员模型按基于曲率和附着极限规划的速度曲线沿赛道行驶一圈（飞驰圈），综合评价动力、制动与操纵性能。',
  params: [
    { key: 'util', label: '附着利用率', type: 'number', default: 0.85, min: 0.4, max: 1.05, step: 0.01, help: '驾驶员使用的轮胎极限比例，越大越激进' },
    { key: 'preview', label: '驾驶员预瞄时间', unit: 's', type: 'number', default: 0.7, min: 0.3, max: 2, step: 0.05 },
    muParam,
    override('esc', '车身稳定 ESC'),
    override('tcs', '牵引力控制 TCS'),
  ],
  setup(p, vp) {
    const path = buildSplineTrack(TRACK_CONTROL_POINTS, 1);
    const prof = speedProfile(path, vp, p.mu, p.util);
    const steer = follower(path, p.preview);
    const sc = new SpeedController(1.6, 0.3);
    const p0 = path.pointAt(0);
    let traveled = 0, lastS = 0;
    const vAt = (s: number) => {
      const n = prof.length;
      const f = ((((s % path.length) + path.length) % path.length) / path.length) * (n - 1);
      const i = Math.floor(f);
      return prof[i] + (prof[(i + 1) % n] - prof[i]) * (f - i);
    };
    return {
      duration: 300,
      init: { speed: prof[0], x: p0.x, y: p0.y, yaw: p0.heading },
      road: { mu: p.mu },
      path, ribbonWidth: 12,
      controls: controlsFrom(p),
      driver: (veh, _t, dt, ctx) => {
        const s = steer(veh, dt, ctx);
        let ds = ctx.station - lastS;
        if (ds < -path.length / 2) ds += path.length;
        traveled += ds;
        lastS = ctx.station;
        const vt = vAt(ctx.station + Math.max(veh.u, 5) * 0.35);
        ctx.targetSpeed = vt;
        return { steer: s, ...sc.update(veh, vt, dt) };
      },
      stop: () => traveled >= path.length - 0.5,
      kpis: (r) => {
        const t = r.t;
        const tEnd = t[r.n - 1];
        return [
          k('圈速', tEnd, 's', 2),
          k('平均车速', (path.length / tEnd) * 3.6, 'km/h', 1),
          k('最高车速', maxIn(t, C(r, 'Vx')).value, 'km/h', 1),
          k('最低车速', minIn(t, C(r, 'Vx')).value, 'km/h', 1),
          k('最大侧向加速度', Math.abs(maxAbsIn(t, C(r, 'Ay')).value), 'g', 3),
          k('最大制动减速度', -minIn(t, C(r, 'Ax')).value, 'g', 3),
          k('最大路径偏差', Math.abs(maxAbsIn(t, C(r, 'PathErr')).value), 'm', 2),
          k('赛道长度', path.length, 'm', 0),
        ];
      },
      plots: [
        { title: '车速 - 里程', x: 'Station', y: ['Vx', 'VTarget'] },
        XY_PLOT,
        { title: 'g-g 图', x: 'Ay', y: ['Ax'], equalAxes: true },
        { title: '侧向加速度 - 里程', x: 'Station', y: ['Ay'] },
        { title: '方向盘转角 - 里程', x: 'Station', y: ['Steer_SW'] },
        { title: '油门 / 制动 - 里程', x: 'Station', y: ['Throttle', 'BrakePedal'] },
      ],
    };
  },
};

export const PROCEDURES: Procedure[] = [
  accel, braking, constRadius, rampSteer, stepSteer, sineDwell, doubleLane, slalom, fishhook, splitMu, bump, randomRoad, lap,
];

export const PROCEDURE_MAP: Record<string, Procedure> = Object.fromEntries(PROCEDURES.map((p) => [p.id, p]));

export function defaultParams(proc: Procedure): Record<string, any> {
  return Object.fromEntries(proc.params.map((d) => [d.key, d.default]));
}
