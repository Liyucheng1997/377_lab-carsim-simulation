// 驾驶员模型：预瞄路径跟踪（转向）+ PI 车速控制（油门/制动）
import type { Vehicle } from './vehicle';
import type { Path } from './path';
import { RAD, clamp, GRAVITY, AIR_DENSITY } from './math';

export interface PathFollowerOptions {
  previewTime: number; // s 预瞄时间
  minPreview: number; // m 最小预瞄距离
  lag: number; // s 驾驶员神经肌肉滞后
  maxRate: number; // deg/s 方向盘最大转速
  gain: number; // 转向增益修正
  yawGain: number; // 横摆角速度反馈增益 rad/(rad/s)
}

export const DEFAULT_PATH_FOLLOWER: PathFollowerOptions = {
  previewTime: 0.9,
  minPreview: 6,
  lag: 0.06,
  maxRate: 1000,
  gain: 1,
  yawGain: 0.08,
};

/** 单点预瞄（纯跟踪 Pure Pursuit）+ 不足转向补偿 */
export class PathFollower {
  idx = -1;
  station = 0;
  error = 0;
  steer = 0;
  private readonly kus: number;
  constructor(public path: Path, veh: Vehicle, public opt: PathFollowerOptions = DEFAULT_PATH_FOLLOWER) {
    this.kus = veh.derived.kus;
    const pr = path.project(veh.X, veh.Y);
    this.idx = pr.idx;
    this.station = pr.s;
  }

  update(veh: Vehicle, dt: number): number {
    const pr = this.path.project(veh.X, veh.Y, this.idx);
    this.idx = pr.idx;
    this.station = pr.s;
    this.error = pr.e;
    const u = Math.max(Math.abs(veh.u), 1);
    const Lp = Math.max(this.opt.minPreview, u * this.opt.previewTime);
    const tg = this.path.pointAt(pr.s + Lp);
    const dx = tg.x - veh.X, dy = tg.y - veh.Y;
    const h = veh.psi + veh.beta; // 速度方向
    const xl = Math.cos(h) * dx + Math.sin(h) * dy;
    const yl = -Math.sin(h) * dx + Math.cos(h) * dy;
    const k = (2 * yl) / Math.max(xl * xl + yl * yl, 1);
    const L = veh.p.body.wheelbase;
    // 前馈：预瞄曲率 + 不足转向补偿；反馈：期望横摆角速度与实际之差
    const delta = (L + Math.max(this.kus, -0.5 * L / (u * u)) * u * u) * k + this.opt.yawGain * (u * k - veh.r);
    const target = delta * veh.p.steering.ratio * RAD * this.opt.gain;
    const maxSW = veh.p.steering.maxWheelAngle;
    const want = clamp(target, -maxSW, maxSW);
    const lagged = this.steer + (want - this.steer) * Math.min(1, dt / Math.max(this.opt.lag, dt));
    const maxStep = this.opt.maxRate * dt;
    this.steer += clamp(lagged - this.steer, -maxStep, maxStep);
    return this.steer;
  }
}

/** 车速 PI 控制器，带基于动力总成/制动模型的前馈 */
export class SpeedController {
  integ = 0;
  constructor(public kp = 1.2, public ki = 0.35) {}

  update(veh: Vehicle, vTarget: number, dt: number): { throttle: number; brake: number } {
    const e = vTarget - veh.u;
    this.integ = clamp(this.integ + e * dt, -4, 4);
    const aCmd = this.kp * e + this.ki * this.integ;
    const p = veh.p;
    const fr = (p.tireFront.rollingResistance + p.tireRear.rollingResistance) / 2;
    const resist = 0.5 * AIR_DENSITY * p.aero.cd * p.aero.area * veh.u * Math.abs(veh.u) + fr * veh.m * GRAVITY;
    const F = veh.m * aCmd + resist;
    if (F >= 0) return { throttle: veh.throttleForForce(F), brake: 0 };
    return { throttle: 0, brake: veh.pedalForForce(-F) };
  }
}
