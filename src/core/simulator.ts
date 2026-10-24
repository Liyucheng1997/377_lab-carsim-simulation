// 仿真运行器：按工况驱动整车模型并记录输出通道
import type { VehicleParams } from './params';
import { cloneVehicle } from './params';
import type { Procedure, SimResult } from './types';
import { Vehicle, SIM_DT } from './vehicle';
import { Road } from './road';
import { CHANNELS, type DriverContext } from './channels';

export interface RunOptions {
  outputRate?: number; // Hz
  name?: string;
  color?: string;
}

let runCounter = 0;

export function runSimulation(vpIn: VehicleParams, proc: Procedure, params: Record<string, any>, opts: RunOptions = {}): SimResult {
  const wall0 = performance.now();
  const vp = cloneVehicle(vpIn);
  const setup = proc.setup(params, vp);
  if (setup.controls) Object.assign(vp.controls, setup.controls);
  const road = new Road(setup.road);
  const veh = new Vehicle(vp, road);
  veh.reset(setup.init.speed, setup.init.x, setup.init.y, setup.init.yaw);

  const dt = SIM_DT;
  const outRate = opts.outputRate ?? 100;
  const every = Math.max(1, Math.round(1 / (outRate * dt)));
  const nSteps = Math.ceil(setup.duration / dt);
  const cap = Math.floor(nSteps / every) + 2;
  const chans = CHANNELS;
  const buf: Float32Array[] = chans.map(() => new Float32Array(cap));
  const tBuf = new Float32Array(cap);
  const ctx: DriverContext = { station: 0, pathError: 0, targetSpeed: NaN };
  let n = 0;
  const warnings: string[] = [];

  const record = () => {
    if (n >= cap) return;
    tBuf[n] = veh.t;
    for (let c = 0; c < chans.length; c++) buf[c][n] = chans[c].get(veh, ctx);
    n++;
  };

  // 初始状态：计算一次驾驶员输入以便上下文有效
  for (let i = 0; i <= nSteps; i++) {
    const t = i * dt;
    const inp = setup.driver(veh, t, dt, ctx);
    veh.step(dt, inp);
    if (i % every === 0) record();
    if (!Number.isFinite(veh.u) || !Number.isFinite(veh.X)) {
      warnings.push(`仿真在 t=${t.toFixed(2)} s 发散，已终止。`);
      break;
    }
    if (setup.stop && setup.stop(veh, t, ctx)) {
      record();
      break;
    }
  }
  if (Math.abs(veh.phi) > 0.6) warnings.push('车身侧倾超过 35°，车辆可能已侧翻（模型基于小角度假设，结果仅供参考）。');

  const ch: Record<string, Float32Array> = {};
  chans.forEach((c, i) => (ch[c.key] = buf[i].subarray(0, n)));
  const t = tBuf.subarray(0, n);
  runCounter++;
  const res: SimResult = {
    id: `run-${Date.now().toString(36)}-${runCounter}`,
    name: opts.name ?? `${proc.name} · ${vp.name}`,
    color: opts.color ?? '#4da3ff',
    vehicle: vp,
    procedureId: proc.id,
    procedureName: proc.name,
    params: { ...params },
    t, ch, n,
    dtOut: every * dt,
    kpis: [],
    plots: setup.plots,
    scene: {
      road: setup.road,
      path: setup.path ? decimatePath(setup.path.xs, setup.path.ys, setup.path.closed) : undefined,
      ribbonWidth: setup.ribbonWidth,
      cones: setup.cones,
    },
    wallMs: 0,
    createdAt: Date.now(),
    warnings,
  };
  try {
    res.kpis = setup.kpis(res);
  } catch (e) {
    warnings.push('指标计算失败：' + (e as Error).message);
  }
  res.wallMs = performance.now() - wall0;
  return res;
}

function decimatePath(xs: Float64Array, ys: Float64Array, closed: boolean) {
  const x: number[] = [], y: number[] = [];
  const step = Math.max(1, Math.floor(xs.length / 4000));
  for (let i = 0; i < xs.length; i += step) { x.push(xs[i]); y.push(ys[i]); }
  if ((xs.length - 1) % step !== 0) { x.push(xs[xs.length - 1]); y.push(ys[ys.length - 1]); }
  return { x, y, closed };
}

/** 导出 CSV */
export function resultToCSV(r: SimResult): string {
  const keys = CHANNELS.filter((c) => !c.hidden).map((c) => c.key);
  const head = ['Time(s)', ...keys.map((k) => {
    const c = CHANNELS.find((x) => x.key === k)!;
    return `${k}(${c.unit})`;
  })];
  const lines = [head.join(',')];
  for (let i = 0; i < r.n; i++) {
    const row = [r.t[i].toFixed(4)];
    for (const key of keys) row.push(Number(r.ch[key][i].toPrecision(6)).toString());
    lines.push(row.join(','));
  }
  return lines.join('\n');
}
