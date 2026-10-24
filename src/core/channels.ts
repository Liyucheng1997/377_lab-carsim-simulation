// 输出通道定义（类似 CarSim 的输出变量）
import type { Vehicle } from './vehicle';
import { WHEEL_NAMES } from './vehicle';
import { GRAVITY, RAD } from './math';

export interface DriverContext {
  station: number;
  pathError: number;
  targetSpeed: number; // m/s，NaN 表示无
}

export interface ChannelDef {
  key: string;
  label: string;
  unit: string;
  group: string;
  hidden?: boolean;
  get: (v: Vehicle, ctx: DriverContext) => number;
}

const WHEEL_CN = ['左前', '右前', '左后', '右后'];

function perWheel(
  prefix: string,
  label: string,
  unit: string,
  group: string,
  fn: (v: Vehicle, i: number) => number,
  hidden = false,
): ChannelDef[] {
  return WHEEL_NAMES.map((w, i) => ({
    key: `${prefix}_${w}`,
    label: `${label} ${WHEEL_CN[i]}`,
    unit,
    group,
    hidden,
    get: (v: Vehicle) => fn(v, i),
  }));
}

export const CHANNELS: ChannelDef[] = [
  { key: 'X', label: '全局坐标 X', unit: 'm', group: '运动学', get: (v) => v.X },
  { key: 'Y', label: '全局坐标 Y', unit: 'm', group: '运动学', get: (v) => v.Y },
  { key: 'Yaw', label: '横摆角', unit: 'deg', group: '运动学', get: (v) => v.psi * RAD },
  { key: 'Station', label: '路径里程', unit: 'm', group: '运动学', get: (_v, c) => c.station },
  { key: 'PathErr', label: '路径横向偏差', unit: 'm', group: '运动学', get: (_v, c) => c.pathError },
  { key: 'Vx', label: '纵向车速', unit: 'km/h', group: '运动学', get: (v) => v.u * 3.6 },
  { key: 'Vy', label: '侧向速度', unit: 'm/s', group: '运动学', get: (v) => v.v },
  { key: 'VTarget', label: '目标车速', unit: 'km/h', group: '驾驶员', get: (_v, c) => c.targetSpeed * 3.6 },
  { key: 'Ax', label: '纵向加速度', unit: 'g', group: '运动学', get: (v) => v.ax / GRAVITY },
  { key: 'Ay', label: '侧向加速度', unit: 'g', group: '运动学', get: (v) => v.ay / GRAVITY },
  { key: 'Az', label: '车身垂向加速度', unit: 'g', group: '车身', get: (v) => v.azs / GRAVITY },
  { key: 'AVz', label: '横摆角速度', unit: 'deg/s', group: '运动学', get: (v) => v.r * RAD },
  { key: 'Beta', label: '质心侧偏角', unit: 'deg', group: '运动学', get: (v) => v.beta * RAD },
  { key: 'Roll', label: '车身侧倾角', unit: 'deg', group: '车身', get: (v) => v.phi * RAD },
  { key: 'Pitch', label: '车身俯仰角', unit: 'deg', group: '车身', get: (v) => v.theta * RAD },
  { key: 'Zs', label: '车身垂向位移', unit: 'mm', group: '车身', get: (v) => v.zs * 1000 },
  { key: 'AVx', label: '侧倾角速度', unit: 'deg/s', group: '车身', get: (v) => v.p_ * RAD },
  { key: 'AVy', label: '俯仰角速度', unit: 'deg/s', group: '车身', get: (v) => v.q * RAD },
  { key: 'Steer_SW', label: '方向盘转角', unit: 'deg', group: '驾驶员', get: (v) => v.steerSW },
  { key: 'Steer_L1', label: '车轮转角 左前', unit: 'deg', group: '转向', get: (v) => v.delta[0] * RAD },
  { key: 'Steer_R1', label: '车轮转角 右前', unit: 'deg', group: '转向', get: (v) => v.delta[1] * RAD },
  { key: 'Throttle', label: '油门开度', unit: '%', group: '驾驶员', get: (v) => v.throttle * 100 },
  { key: 'BrakePedal', label: '制动踏板', unit: '%', group: '驾驶员', get: (v) => v.brake * 100 },
  { key: 'PMaster', label: '主缸压力', unit: 'MPa', group: '制动', get: (v) => v.pMaster },
  ...perWheel('Pbk', '轮缸压力', 'MPa', '制动', (v, i) => v.pWheel[i]),
  { key: 'Gear', label: '档位', unit: '-', group: '动力总成', get: (v) => v.pt.gear },
  { key: 'EngineRpm', label: '发动机转速', unit: 'rpm', group: '动力总成', get: (v) => v.pt.engineRpm },
  { key: 'EngineTorque', label: '发动机扭矩', unit: 'N·m', group: '动力总成', get: (v) => v.pt.engineTorque },
  { key: 'DriveTorque', label: '差速器输入扭矩', unit: 'N·m', group: '动力总成', get: (v) => v.pt.outputTorque },
  { key: 'Lockup', label: '闭锁离合器', unit: '-', group: '动力总成', get: (v) => (v.pt.locked ? 1 : 0) },
  { key: 'ABS', label: 'ABS 作用', unit: '-', group: '主动安全', get: (v) => (v.absActive.some((a) => a) ? 1 : 0) },
  { key: 'ESC', label: 'ESC 作用', unit: '-', group: '主动安全', get: (v) => (v.escActive ? 1 : 0) },
  { key: 'TCS', label: 'TCS 作用', unit: '-', group: '主动安全', get: (v) => (v.tcsActive ? 1 : 0) },
  ...perWheel('Fz', '垂向力', 'N', '轮胎', (v, i) => v.fz[i]),
  ...perWheel('Fx', '纵向力', 'N', '轮胎', (v, i) => v.fx[i]),
  ...perWheel('Fy', '侧向力', 'N', '轮胎', (v, i) => v.fy[i]),
  ...perWheel('Mz', '回正力矩', 'N·m', '轮胎', (v, i) => v.mz[i]),
  ...perWheel('Alpha', '侧偏角', 'deg', '轮胎', (v, i) => v.slipAngle[i] * RAD),
  ...perWheel('Kappa', '滑移率', '-', '轮胎', (v, i) => v.slip[i]),
  ...perWheel('Camber', '对地外倾角', 'deg', '轮胎', (v, i) => v.gamma[i] * v.side[i] * RAD),
  ...perWheel('Vw', '轮速', 'km/h', '轮胎', (v, i) => v.omega[i] * v.rEff[i] * 3.6),
  ...perWheel('Mu', '路面附着系数', '-', '路面', (v, i) => v.muRoad[i]),
  ...perWheel('Zroad', '路面高度', 'mm', '路面', (v, i) => v.zRoad[i] * 1000),
  ...perWheel('Comp', '悬架压缩量', 'mm', '悬架', (v, i) => v.comp[i] * 1000),
  ...perWheel('Fs', '悬架动态力', 'N', '悬架', (v, i) => v.fsusp[i]),
  ...perWheel('Zu', '轮心垂向位移', 'mm', '悬架', (v, i) => v.zu[i] * 1000),
  ...perWheel('Tdrive', '驱动扭矩', 'N·m', '动力总成', (v, i) => v.driveT[i]),
  ...perWheel('Tbrake', '制动扭矩', 'N·m', '制动', (v, i) => v.brakeT[i]),
  ...perWheel('Spin', '车轮转角', 'rad', '轮胎', (v, i) => v.spin[i], true),
];

export const CHANNEL_MAP: Record<string, ChannelDef> = Object.fromEntries(CHANNELS.map((c) => [c.key, c]));

export function channelLabel(key: string): string {
  if (key === 't') return '时间 (s)';
  const c = CHANNEL_MAP[key];
  return c ? `${c.label} (${c.unit})` : key;
}
