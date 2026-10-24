// 车辆参数定义与预置车型库
import { deepClone } from './math';

export type DriveType = 'FWD' | 'RWD' | 'AWD';
export type BodyStyle = 'sedan' | 'hatch' | 'suv' | 'coupe';

/** 单个车桥的悬架参数（左右对称，量值均为轮心等效） */
export interface AxleSuspension {
  unsprungMass: number; // kg 每侧非簧载质量
  springRate: number; // N/m 轮心刚度
  damperBump: number; // N·s/m 压缩阻尼（低速段）
  damperRebound: number; // N·s/m 复原阻尼（低速段）
  damperKnee: number; // m/s 阻尼拐点速度
  damperHighRatio: number; // 拐点后阻尼系数比例
  arbRate: number; // N/m 横向稳定杆（轮心等效，按左右行程差）
  rollCenterHeight: number; // m 侧倾中心高度
  antiPitch: number; // 0..1 前：抗点头 / 后：抗下蹲(抗抬升)
  camberStatic: number; // deg 静态外倾角（负外倾为负）
  camberGain: number; // deg/m 外倾角随压缩量变化
  toeStatic: number; // deg 静态前束（前束为正）
  bumpSteer: number; // deg/m 轮跳转向（压缩时前束增加为正）
  complianceSteer: number; // deg/kN 侧向力柔度转向（正值为不足转向趋势）
  bumpTravel: number; // m 压缩行程（到缓冲块）
  reboundTravel: number; // m 复原行程（到限位）
  bumpStopRate: number; // N/m 缓冲块刚度
}

/** 魔术公式（简化版 Pacejka MF）轮胎参数 */
export interface TireParams {
  label: string;
  unloadedRadius: number; // m
  width: number; // m
  verticalStiffness: number; // N/m
  verticalDamping: number; // N·s/m
  nominalLoad: number; // N 名义载荷 Fz0
  muX: number; // 纵向峰值附着系数（Fz0）
  muY: number; // 侧向峰值附着系数（Fz0）
  loadSensitivity: number; // 附着系数载荷敏感度 dμ/μ per dFz/Fz0
  kxCoeff: number; // 纵滑刚度 / Fz
  kyCoeff: number; // 侧偏刚度 / Fz0 （在 Fz0 时，1/rad）
  cx: number; // 纵向形状因子 C
  ex: number; // 纵向曲率因子 E
  cy: number; // 侧向形状因子 C
  ey: number; // 侧向曲率因子 E
  relaxX: number; // m 纵向松弛长度
  relaxY: number; // m 侧向松弛长度
  rollingResistance: number; // 滚动阻力系数
  camberCoeff: number; // 外倾刚度 / Fz (1/rad)
  combinedX: number; // 联合工况：侧偏对纵向力的削弱 Bxα
  combinedY: number; // 联合工况：纵滑对侧向力的削弱 Byκ
  pneumaticTrail: number; // m 轮胎拖距
}

export interface Powertrain {
  driveType: DriveType;
  frontTorqueSplit: number; // AWD 前轴扭矩分配比例
  engineRpm: number[]; // 外特性转速点
  engineTorque: number[]; // 外特性扭矩 N·m
  idleRpm: number;
  redlineRpm: number;
  engineInertia: number; // kg·m²
  frictionTorque0: number; // N·m 发动机摩擦扭矩常数项
  frictionTorqueK: number; // N·m/1000rpm 摩擦扭矩随转速增量
  converterK: number; // 液力变矩器失速 K 因子 rpm/√(N·m)
  converterTorqueRatio: number; // 失速变矩比
  lockupGear: number; // 闭锁离合器允许结合的最低档位
  lockupRpm: number; // 闭锁离合器结合的涡轮转速
  gearRatios: number[];
  finalDrive: number;
  efficiency: number;
  shiftTime: number; // s 换挡时间（动力中断）
  upshiftRpmLight: number;
  upshiftRpmFull: number;
  downshiftRpmLight: number;
  downshiftRpmFull: number;
  lsdCoupling: number; // N·m/(rad/s) 限滑差速器（粘性）
  wheelInertia: number; // kg·m² 每个车轮（含制动盘）
}

export interface Brakes {
  maxPressure: number; // MPa 踏板全行程主缸压力
  frontGain: number; // N·m/MPa 每个前轮
  rearGain: number; // N·m/MPa 每个后轮
  timeConstant: number; // s 制动系统建压时间常数
}

export interface Steering {
  ratio: number; // 转向系传动比
  maxWheelAngle: number; // deg 方向盘最大转角
  ackermann: number; // 0..1 阿克曼率
}

export interface Aero {
  cd: number;
  area: number; // m²
  clFront: number; // 前轴升力系数（负为下压力）
  clRear: number;
  height: number; // m 风阻作用点高度
}

export interface Controls {
  abs: boolean;
  esc: boolean;
  tcs: boolean;
}

export interface BodyParams {
  sprungMass: number; // kg
  ixx: number; // kg·m² 簧上质量侧倾惯量
  iyy: number; // 俯仰惯量
  izz: number; // 横摆惯量
  wheelbase: number; // m
  cgToFront: number; // m 簧上质心到前轴距离
  cgHeight: number; // m 簧上质心高度
  trackFront: number; // m
  trackRear: number; // m
  length: number; // m 外形（动画用）
  width: number;
  height: number;
  frontOverhang: number;
}

export interface VehicleParams {
  id: string;
  name: string;
  description: string;
  color: string;
  bodyStyle: BodyStyle;
  builtin?: boolean;
  body: BodyParams;
  suspFront: AxleSuspension;
  suspRear: AxleSuspension;
  tireFront: TireParams;
  tireRear: TireParams;
  powertrain: Powertrain;
  brakes: Brakes;
  steering: Steering;
  aero: Aero;
  controls: Controls;
}

// ---------------------------------------------------------------------------
// 预置车型
// ---------------------------------------------------------------------------

function tire(over: Partial<TireParams>): TireParams {
  return {
    label: '205/55 R16',
    unloadedRadius: 0.316,
    width: 0.205,
    verticalStiffness: 230000,
    verticalDamping: 150,
    nominalLoad: 4000,
    muX: 1.05,
    muY: 1.0,
    loadSensitivity: -0.12,
    kxCoeff: 18,
    kyCoeff: 17,
    cx: 1.6,
    ex: 0.2,
    cy: 1.4,
    ey: -0.4,
    relaxX: 0.12,
    relaxY: 0.42,
    rollingResistance: 0.012,
    camberCoeff: 0.9,
    combinedX: 9,
    combinedY: 7,
    pneumaticTrail: 0.035,
    ...over,
  };
}

function susp(over: Partial<AxleSuspension>): AxleSuspension {
  return {
    unsprungMass: 40,
    springRate: 26000,
    damperBump: 1900,
    damperRebound: 4200,
    damperKnee: 0.13,
    damperHighRatio: 0.45,
    arbRate: 15000,
    rollCenterHeight: 0.08,
    antiPitch: 0.2,
    camberStatic: -0.8,
    camberGain: -30,
    toeStatic: 0.1,
    bumpSteer: 0,
    complianceSteer: 0.1,
    bumpTravel: 0.075,
    reboundTravel: 0.09,
    bumpStopRate: 250000,
    ...over,
  };
}

const COMPACT_FWD: VehicleParams = {
  id: 'compact-fwd',
  name: 'C级 前驱两厢车',
  description: '1.5T 发动机 + 6AT，前麦弗逊/后扭力梁，前置前驱，典型家用紧凑型车。',
  color: '#b8322a',
  bodyStyle: 'hatch',
  builtin: true,
  body: {
    sprungMass: 1170, ixx: 420, iyy: 1650, izz: 1850,
    wheelbase: 2.64, cgToFront: 1.03, cgHeight: 0.55,
    trackFront: 1.55, trackRear: 1.54,
    length: 4.37, width: 1.8, height: 1.46, frontOverhang: 0.88,
  },
  suspFront: susp({ unsprungMass: 42, springRate: 26000, damperBump: 1900, damperRebound: 4200, arbRate: 16000, rollCenterHeight: 0.07, antiPitch: 0.2, camberStatic: -0.8, camberGain: -30, toeStatic: 0.1, bumpSteer: -4, complianceSteer: 0.18 }),
  suspRear: susp({ unsprungMass: 36, springRate: 23000, damperBump: 1500, damperRebound: 3400, arbRate: 5000, rollCenterHeight: 0.12, antiPitch: 0.15, camberStatic: -1.2, camberGain: -15, toeStatic: 0.2, bumpSteer: 3, complianceSteer: 0.05 }),
  tireFront: tire({}),
  tireRear: tire({}),
  powertrain: {
    driveType: 'FWD', frontTorqueSplit: 1,
    engineRpm: [700, 1000, 1500, 1750, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500],
    engineTorque: [110, 150, 215, 250, 250, 250, 250, 250, 250, 245, 232, 215, 190, 150],
    idleRpm: 750, redlineRpm: 6300, engineInertia: 0.16,
    frictionTorque0: 12, frictionTorqueK: 6,
    converterK: 140, converterTorqueRatio: 2.0, lockupGear: 2, lockupRpm: 1200,
    gearRatios: [4.459, 2.508, 1.556, 1.142, 0.851, 0.672], finalDrive: 3.32, efficiency: 0.92,
    shiftTime: 0.35, upshiftRpmLight: 2000, upshiftRpmFull: 6000, downshiftRpmLight: 1050, downshiftRpmFull: 2900,
    lsdCoupling: 0, wheelInertia: 1.1,
  },
  brakes: { maxPressure: 12, frontGain: 175, rearGain: 45, timeConstant: 0.06 },
  steering: { ratio: 15.5, maxWheelAngle: 520, ackermann: 0.6 },
  aero: { cd: 0.3, area: 2.2, clFront: 0.05, clRear: 0.08, height: 0.55 },
  controls: { abs: true, esc: true, tcs: true },
};

const SEDAN_RWD: VehicleParams = {
  id: 'sedan-rwd',
  name: 'D级 后驱运动轿车',
  description: '2.0T 发动机 + 8AT，前双叉臂/后多连杆，前置后驱，限滑差速器，接近 50:50 配重。',
  color: '#0071e3',
  bodyStyle: 'sedan',
  builtin: true,
  body: {
    sprungMass: 1470, ixx: 560, iyy: 2350, izz: 2650,
    wheelbase: 2.85, cgToFront: 1.4, cgHeight: 0.53,
    trackFront: 1.58, trackRear: 1.6,
    length: 4.75, width: 1.83, height: 1.44, frontOverhang: 0.85,
  },
  suspFront: susp({ unsprungMass: 45, springRate: 30000, damperBump: 2200, damperRebound: 4800, arbRate: 22000, rollCenterHeight: 0.09, antiPitch: 0.25, camberStatic: -0.8, camberGain: -35, toeStatic: 0.1, bumpSteer: -3, complianceSteer: 0.14 }),
  suspRear: susp({ unsprungMass: 48, springRate: 33000, damperBump: 2300, damperRebound: 5000, arbRate: 9000, rollCenterHeight: 0.13, antiPitch: 0.3, camberStatic: -1.3, camberGain: -25, toeStatic: 0.25, bumpSteer: 3, complianceSteer: 0.05 }),
  tireFront: tire({ label: '225/45 R18', unloadedRadius: 0.325, width: 0.225, verticalStiffness: 260000, nominalLoad: 4500, muX: 1.1, muY: 1.05, kyCoeff: 18 }),
  tireRear: tire({ label: '255/40 R18', unloadedRadius: 0.326, width: 0.255, verticalStiffness: 270000, nominalLoad: 4500, muX: 1.1, muY: 1.05, kyCoeff: 19.5 }),
  powertrain: {
    driveType: 'RWD', frontTorqueSplit: 0,
    engineRpm: [700, 1000, 1450, 2000, 3000, 4000, 4800, 5500, 6000, 6500, 7000],
    engineTorque: [140, 230, 350, 350, 350, 350, 350, 330, 300, 250, 180],
    idleRpm: 700, redlineRpm: 6500, engineInertia: 0.18,
    frictionTorque0: 14, frictionTorqueK: 7,
    converterK: 125, converterTorqueRatio: 2.1, lockupGear: 2, lockupRpm: 1150,
    gearRatios: [4.714, 3.143, 2.106, 1.667, 1.285, 1.0, 0.839, 0.667], finalDrive: 3.15, efficiency: 0.91,
    shiftTime: 0.25, upshiftRpmLight: 1800, upshiftRpmFull: 6300, downshiftRpmLight: 1100, downshiftRpmFull: 3200,
    lsdCoupling: 15, wheelInertia: 1.3,
  },
  brakes: { maxPressure: 12, frontGain: 210, rearGain: 110, timeConstant: 0.05 },
  steering: { ratio: 14.5, maxWheelAngle: 500, ackermann: 0.5 },
  aero: { cd: 0.27, area: 2.3, clFront: 0.04, clRear: 0.06, height: 0.53 },
  controls: { abs: true, esc: true, tcs: true },
};

const SUV_AWD: VehicleParams = {
  id: 'suv-awd',
  name: '中大型 四驱SUV',
  description: '2.5T 发动机 + 8AT，全时四驱（前 40 / 后 60），质心高，用于侧翻与稳定性评价。',
  color: '#3a3a3c',
  bodyStyle: 'suv',
  builtin: true,
  body: {
    sprungMass: 1900, ixx: 850, iyy: 3500, izz: 3800,
    wheelbase: 2.9, cgToFront: 1.33, cgHeight: 0.7,
    trackFront: 1.64, trackRear: 1.65,
    length: 4.85, width: 1.93, height: 1.75, frontOverhang: 0.92,
  },
  suspFront: susp({ unsprungMass: 55, springRate: 36000, damperBump: 2800, damperRebound: 6000, arbRate: 30000, rollCenterHeight: 0.11, antiPitch: 0.2, camberStatic: -0.5, camberGain: -25, toeStatic: 0.1, bumpSteer: -4, complianceSteer: 0.16, bumpTravel: 0.09, reboundTravel: 0.11 }),
  suspRear: susp({ unsprungMass: 58, springRate: 38000, damperBump: 2700, damperRebound: 5800, arbRate: 12000, rollCenterHeight: 0.15, antiPitch: 0.25, camberStatic: -0.8, camberGain: -20, toeStatic: 0.2, bumpSteer: 3, complianceSteer: 0.05, bumpTravel: 0.09, reboundTravel: 0.11 }),
  tireFront: tire({ label: '255/55 R19', unloadedRadius: 0.375, width: 0.255, verticalStiffness: 270000, nominalLoad: 6000, muX: 1.0, muY: 0.95, loadSensitivity: -0.13, kyCoeff: 15, relaxY: 0.5 }),
  tireRear: tire({ label: '255/55 R19', unloadedRadius: 0.375, width: 0.255, verticalStiffness: 270000, nominalLoad: 6000, muX: 1.0, muY: 0.95, loadSensitivity: -0.13, kyCoeff: 15.5, relaxY: 0.5 }),
  powertrain: {
    driveType: 'AWD', frontTorqueSplit: 0.4,
    engineRpm: [700, 1000, 1700, 2500, 3500, 4500, 5000, 5500, 6000, 6300],
    engineTorque: [160, 260, 420, 420, 420, 420, 400, 370, 330, 280],
    idleRpm: 700, redlineRpm: 6200, engineInertia: 0.22,
    frictionTorque0: 16, frictionTorqueK: 8,
    converterK: 115, converterTorqueRatio: 2.2, lockupGear: 2, lockupRpm: 1150,
    gearRatios: [4.714, 3.143, 2.106, 1.667, 1.285, 1.0, 0.839, 0.667], finalDrive: 3.4, efficiency: 0.88,
    shiftTime: 0.3, upshiftRpmLight: 1800, upshiftRpmFull: 6000, downshiftRpmLight: 1100, downshiftRpmFull: 3100,
    lsdCoupling: 10, wheelInertia: 1.8,
  },
  brakes: { maxPressure: 12, frontGain: 260, rearGain: 130, timeConstant: 0.06 },
  steering: { ratio: 15.8, maxWheelAngle: 520, ackermann: 0.5 },
  aero: { cd: 0.33, area: 2.75, clFront: 0.06, clRear: 0.1, height: 0.75 },
  controls: { abs: true, esc: true, tcs: true },
};

const SPORTS_RWD: VehicleParams = {
  id: 'sports-rwd',
  name: '高性能 后驱跑车',
  description: '3.0T 发动机 + 8 速双离合，前双叉臂/后多连杆，宽胎、下压力套件、机械限滑。',
  color: '#c93400',
  bodyStyle: 'coupe',
  builtin: true,
  body: {
    sprungMass: 1330, ixx: 420, iyy: 1700, izz: 1950,
    wheelbase: 2.45, cgToFront: 1.32, cgHeight: 0.45,
    trackFront: 1.59, trackRear: 1.56,
    length: 4.52, width: 1.85, height: 1.3, frontOverhang: 0.95,
  },
  suspFront: susp({ unsprungMass: 40, springRate: 42000, damperBump: 3000, damperRebound: 6500, arbRate: 28000, rollCenterHeight: 0.05, antiPitch: 0.3, camberStatic: -1.5, camberGain: -40, toeStatic: 0.05, bumpSteer: -2, complianceSteer: 0.08, bumpTravel: 0.06, reboundTravel: 0.07 }),
  suspRear: susp({ unsprungMass: 45, springRate: 48000, damperBump: 3300, damperRebound: 7000, arbRate: 14000, rollCenterHeight: 0.08, antiPitch: 0.4, camberStatic: -2.0, camberGain: -30, toeStatic: 0.2, bumpSteer: 2, complianceSteer: 0.03, bumpTravel: 0.06, reboundTravel: 0.07 }),
  tireFront: tire({ label: '245/35 R20', unloadedRadius: 0.34, width: 0.245, verticalStiffness: 300000, nominalLoad: 3800, muX: 1.25, muY: 1.2, kyCoeff: 20, cy: 1.5, relaxY: 0.38 }),
  tireRear: tire({ label: '305/30 R20', unloadedRadius: 0.342, width: 0.305, verticalStiffness: 320000, nominalLoad: 4500, muX: 1.25, muY: 1.2, kyCoeff: 21.5, cy: 1.5, relaxY: 0.38 }),
  powertrain: {
    driveType: 'RWD', frontTorqueSplit: 0,
    engineRpm: [800, 1000, 1500, 2000, 2500, 5500, 6000, 6500, 7000, 7500],
    engineTorque: [200, 300, 450, 530, 530, 530, 500, 460, 400, 300],
    idleRpm: 800, redlineRpm: 7200, engineInertia: 0.15,
    frictionTorque0: 18, frictionTorqueK: 8,
    converterK: 110, converterTorqueRatio: 1.6, lockupGear: 1, lockupRpm: 1500,
    gearRatios: [3.91, 2.29, 1.58, 1.18, 0.94, 0.79, 0.67, 0.55], finalDrive: 3.44, efficiency: 0.93,
    shiftTime: 0.12, upshiftRpmLight: 2200, upshiftRpmFull: 7000, downshiftRpmLight: 1200, downshiftRpmFull: 3800,
    lsdCoupling: 40, wheelInertia: 1.4,
  },
  brakes: { maxPressure: 13, frontGain: 260, rearGain: 150, timeConstant: 0.04 },
  steering: { ratio: 13, maxWheelAngle: 450, ackermann: 0.4 },
  aero: { cd: 0.31, area: 2.0, clFront: -0.08, clRear: -0.15, height: 0.45 },
  controls: { abs: true, esc: true, tcs: true },
};

export const BUILTIN_VEHICLES: VehicleParams[] = [COMPACT_FWD, SEDAN_RWD, SUV_AWD, SPORTS_RWD];

export function cloneVehicle(v: VehicleParams): VehicleParams {
  return deepClone(v);
}

/** 由参数推导的车辆特性（用于参数界面的"车辆特性汇总"和驾驶员模型） */
export interface DerivedProps {
  totalMass: number;
  frontWeightPct: number;
  cgX: number; // 整车质心相对簧上质心的纵向偏移（向前为正）
  a: number; // 整车质心到前轴
  b: number; // 整车质心到后轴
  hTotal: number; // 整车质心高度
  rideFreqFront: number; // Hz
  rideFreqRear: number;
  rollStiffnessFront: number; // N·m/rad
  rollStiffnessRear: number;
  rollStiffnessFrontPct: number;
  rollGradient: number; // deg/g
  corneringStiffFront: number; // N/rad（整轴）
  corneringStiffRear: number;
  understeerGradient: number; // deg/g（线性两自由度估算）
  kus: number; // rad/(m/s²)
  charSpeed: number; // km/h 特征车速（不足转向）/ 临界车速（过度转向时为负）
  peakPowerKw: number;
  peakPowerRpm: number;
  peakTorque: number;
  topSpeedKph: number;
  powerToWeight: number; // kW/t
  brakeFrontPct: number;
}

export function corneringStiffness(t: TireParams, fz: number): number {
  const fz0 = t.nominalLoad;
  return (t.kyCoeff * fz0 * Math.sin(2 * Math.atan(fz / (2 * fz0)))) / Math.sin(2 * Math.atan(0.5));
}

export function computeDerived(v: VehicleParams): DerivedProps {
  const g = 9.80665;
  const B = v.body;
  const L = B.wheelbase;
  const muF = v.suspFront.unsprungMass;
  const muR = v.suspRear.unsprungMass;
  const m = B.sprungMass + 2 * muF + 2 * muR;
  const aS = B.cgToFront;
  const bS = L - aS;
  const cgX = (2 * muF * aS - 2 * muR * bS) / m;
  const a = aS - cgX;
  const b = L - a;
  const rF = v.tireFront.unloadedRadius;
  const rR = v.tireRear.unloadedRadius;
  const hTotal = (B.sprungMass * B.cgHeight + 2 * muF * rF + 2 * muR * rR) / m;

  const msF = (B.sprungMass * bS) / L / 2;
  const msR = (B.sprungMass * aS) / L / 2;
  const series = (k1: number, k2: number) => (k1 * k2) / (k1 + k2);
  const kRideF = series(v.suspFront.springRate, v.tireFront.verticalStiffness);
  const kRideR = series(v.suspRear.springRate, v.tireRear.verticalStiffness);
  const rideFreqFront = Math.sqrt(kRideF / msF) / (2 * Math.PI);
  const rideFreqRear = Math.sqrt(kRideR / msR) / (2 * Math.PI);

  const tf = B.trackFront;
  const tr = B.trackRear;
  // 侧倾刚度：弹簧 + 稳定杆（稳定杆按左右行程差定义 → 等效 2*k_arb）
  const rollStiffnessFront = ((v.suspFront.springRate + 2 * v.suspFront.arbRate) * tf * tf) / 2;
  const rollStiffnessRear = ((v.suspRear.springRate + 2 * v.suspRear.arbRate) * tr * tr) / 2;
  const kPhi = rollStiffnessFront + rollStiffnessRear;
  const hrc = (v.suspFront.rollCenterHeight * bS + v.suspRear.rollCenterHeight * aS) / L;
  const hArm = B.cgHeight - hrc;
  const rollGradient = ((B.sprungMass * g * hArm) / (kPhi - B.sprungMass * g * hArm)) * (180 / Math.PI);

  const fzF = (m * g * b) / L / 2;
  const fzR = (m * g * a) / L / 2;
  const corneringStiffFront = 2 * corneringStiffness(v.tireFront, fzF);
  const corneringStiffRear = 2 * corneringStiffness(v.tireRear, fzR);
  const kusTire = (m / L) * (b / corneringStiffFront - a / corneringStiffRear);
  // 柔度转向：每 m/s² 侧向加速度对应的前/后轮转角变化
  const deg = Math.PI / 180;
  const kusComply = (v.suspFront.complianceSteer * ((m * b) / L / 2) + v.suspRear.complianceSteer * ((m * a) / L / 2)) * 1e-3 * deg;
  // 侧倾转向：轮跳转向 × 轮距/2 × 侧倾梯度
  const rollPerAy = rollGradient / 9.80665 * deg; // rad per m/s²
  const kusRoll = (-v.suspFront.bumpSteer * (tf / 2) + v.suspRear.bumpSteer * (tr / 2)) * deg * rollPerAy;
  const kus = kusTire + kusComply + kusRoll;
  const understeerGradient = kus * g * (180 / Math.PI);
  const charSpeed = kus > 0 ? Math.sqrt(L / kus) * 3.6 : kus < 0 ? -Math.sqrt(-L / kus) * 3.6 : Infinity;

  const P = v.powertrain;
  let peakPowerKw = 0, peakPowerRpm = 0, peakTorque = 0;
  for (let rpm = P.engineRpm[0]; rpm <= Math.min(P.redlineRpm, P.engineRpm[P.engineRpm.length - 1]); rpm += 25) {
    let t = 0;
    // 线性插值
    const xs = P.engineRpm, ys = P.engineTorque;
    for (let i = 0; i < xs.length - 1; i++) {
      if (rpm >= xs[i] && rpm <= xs[i + 1]) {
        t = ys[i] + ((ys[i + 1] - ys[i]) * (rpm - xs[i])) / (xs[i + 1] - xs[i]);
        break;
      }
    }
    peakTorque = Math.max(peakTorque, t);
    const pw = (t * rpm * 2 * Math.PI) / 60 / 1000;
    if (pw > peakPowerKw) { peakPowerKw = pw; peakPowerRpm = rpm; }
  }
  // 最高车速：功率平衡（简化）
  const rho = 1.206;
  const fr = (v.tireFront.rollingResistance + v.tireRear.rollingResistance) / 2;
  let topSpeed = 0;
  const rw = rR;
  for (let vk = 50; vk <= 400; vk += 1) {
    const vs = vk / 3.6;
    const need = (0.5 * rho * v.aero.cd * v.aero.area * vs * vs + fr * m * g) * vs / 1000;
    // 当前速度下各挡位可用功率
    let avail = 0;
    for (const gr of P.gearRatios) {
      const rpm = (vs / rw) * gr * P.finalDrive * 60 / (2 * Math.PI);
      if (rpm > P.redlineRpm) continue;
      let t = 0;
      const xs = P.engineRpm, ys = P.engineTorque;
      if (rpm <= xs[0]) t = ys[0];
      else for (let i = 0; i < xs.length - 1; i++) {
        if (rpm >= xs[i] && rpm <= xs[i + 1]) { t = ys[i] + ((ys[i + 1] - ys[i]) * (rpm - xs[i])) / (xs[i + 1] - xs[i]); break; }
      }
      avail = Math.max(avail, (t * rpm * 2 * Math.PI) / 60 / 1000 * P.efficiency);
    }
    if (avail >= need) topSpeed = vk; else if (vk > 60) break;
  }
  const brakeF = v.brakes.frontGain;
  const brakeR = v.brakes.rearGain;
  return {
    totalMass: m,
    frontWeightPct: (b / L) * 100,
    cgX, a, b, hTotal,
    rideFreqFront, rideFreqRear,
    rollStiffnessFront, rollStiffnessRear,
    rollStiffnessFrontPct: (rollStiffnessFront / kPhi) * 100,
    rollGradient,
    corneringStiffFront, corneringStiffRear,
    understeerGradient, kus, charSpeed,
    peakPowerKw, peakPowerRpm, peakTorque,
    topSpeedKph: topSpeed,
    powerToWeight: peakPowerKw / (m / 1000),
    brakeFrontPct: (brakeF / (brakeF + brakeR)) * 100,
  };
}
