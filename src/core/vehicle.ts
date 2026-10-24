// 整车动力学模型（14 自由度 + 轮胎瞬态 + 动力总成 + 制动/ABS/ESC/TCS）
//
// 坐标系：ISO 8855，x 向前、y 向左、z 向上；横摆逆时针为正；侧倾左侧抬起为正；俯仰点头为正。
// 自由度：
//   簧上质量：纵向 u、侧向 v、横摆 r（整车质量），垂向 zs、侧倾 φ、俯仰 θ（簧上质量）
//   4 × 非簧载质量垂向 zu
//   4 × 车轮旋转 ω
//   附加状态：4 × 纵向/侧向轮胎松弛滑移（一阶松弛长度模型）
// 积分：固定步长半隐式欧拉，松弛方程用指数积分，制动器用静摩擦钳位处理车轮抱死。
import type { VehicleParams, AxleSuspension, DerivedProps } from './params';
import { computeDerived } from './params';
import { TireModel, type TireOutput } from './tire';
import { PowertrainModel } from './powertrain';
import { Road } from './road';
import { AIR_DENSITY, DEG, GRAVITY, clamp } from './math';

export interface DriverInput {
  steer: number; // 方向盘转角 deg（左转为正）
  throttle: number; // 0..1
  brake: number; // 0..1 制动踏板
  handbrake?: number; // 0..1 驻车制动（作用于后轮）
}

export const SIM_DT = 0.0005; // s 固定积分步长（2 kHz）
export const FL = 0, FR = 1, RL = 2, RR = 3;
export const WHEEL_NAMES = ['L1', 'R1', 'L2', 'R2'];
const V_LOW = 2.0; // m/s 低速阻尼过渡速度
const V_LEAK = 0.1; // m/s 轮胎松弛方程的最低等效速度

export class Vehicle {
  readonly p: VehicleParams;
  readonly road: Road;
  readonly derived: DerivedProps;

  // ---- 常量 ----
  readonly m: number;
  readonly ms: number;
  readonly hs: number;
  readonly izz: number;
  readonly aS: number;
  readonly bS: number;
  readonly mu = new Float64Array(4);
  readonly xw = new Float64Array(4); // 相对整车质心
  readonly xs = new Float64Array(4); // 相对簧上质心
  readonly yw = new Float64Array(4);
  readonly side = [1, -1, 1, -1];
  readonly fs0 = new Float64Array(4);
  readonly fz0 = new Float64Array(4);
  readonly rEff = new Float64Array(4);
  readonly r0 = new Float64Array(4);
  readonly tires: TireModel[];
  readonly susp: AxleSuspension[];
  readonly driveShare = new Float64Array(4);
  readonly hrcRoll: number;
  private readonly tanAnti = new Float64Array(4);
  private readonly cdx = new Float64Array(4);
  private readonly cdy = new Float64Array(4);

  // ---- 状态 ----
  t = 0;
  X = 0; Y = 0; psi = 0;
  u = 0; v = 0; r = 0;
  zs = 0; vzs = 0;
  phi = 0; p_ = 0;
  theta = 0; q = 0;
  readonly zu = new Float64Array(4);
  readonly vzu = new Float64Array(4);
  readonly omega = new Float64Array(4);
  readonly spin = new Float64Array(4);
  readonly kap = new Float64Array(4);
  readonly alp = new Float64Array(4);
  private readonly zrPrev = new Float64Array(4);
  readonly pt: PowertrainModel;
  pMaster = 0;
  readonly pWheel = new Float64Array(4);
  private readonly absP = new Float64Array(4);
  readonly absActive = [false, false, false, false];
  private readonly escP = new Float64Array(4);
  private readonly pTmp = new Float64Array(4);
  private gma = 0;
  private readonly fyFilt = new Float64Array(4); // 柔度转向用的滤波侧向力
  escActive = false;
  tcsFactor = 1;
  tcsActive = false;

  // ---- 输出（每步更新）----
  readonly fx = new Float64Array(4);
  readonly fy = new Float64Array(4);
  readonly fz = new Float64Array(4);
  readonly mz = new Float64Array(4);
  readonly fxV = new Float64Array(4);
  readonly fyV = new Float64Array(4);
  readonly delta = new Float64Array(4);
  readonly comp = new Float64Array(4);
  readonly fsusp = new Float64Array(4);
  readonly slip = new Float64Array(4); // 实际滑移率
  readonly slipAngle = new Float64Array(4); // ISO 侧偏角 rad
  readonly gamma = new Float64Array(4); // 对地外倾（侧倾）角 rad
  readonly driveT = new Float64Array(4);
  readonly brakeT = new Float64Array(4);
  readonly muRoad = new Float64Array(4);
  readonly zRoad = new Float64Array(4);
  ax = 0; ay = 0; azs = 0; rdot = 0;
  steerSW = 0;
  throttle = 0;
  brake = 0;
  drag = 0;

  private readonly tireOut: TireOutput = { fx: 0, fy: 0, mz: 0 };

  constructor(p: VehicleParams, road: Road) {
    this.p = p;
    this.road = road;
    this.derived = computeDerived(p);
    const B = p.body;
    const L = B.wheelbase;
    this.ms = B.sprungMass;
    this.aS = B.cgToFront;
    this.bS = L - B.cgToFront;
    this.susp = [p.suspFront, p.suspFront, p.suspRear, p.suspRear];
    this.tires = [new TireModel(p.tireFront), new TireModel(p.tireFront), new TireModel(p.tireRear), new TireModel(p.tireRear)];
    for (let i = 0; i < 4; i++) this.mu[i] = this.susp[i].unsprungMass;
    this.m = this.ms + this.mu[0] + this.mu[1] + this.mu[2] + this.mu[3];
    const cgX = this.derived.cgX;
    const tf = B.trackFront / 2, tr = B.trackRear / 2;
    const xsArr = [this.aS, this.aS, -this.bS, -this.bS];
    const ywArr = [tf, -tf, tr, -tr];
    for (let i = 0; i < 4; i++) {
      this.xs[i] = xsArr[i];
      this.xw[i] = xsArr[i] - cgX;
      this.yw[i] = ywArr[i];
    }
    this.hs = B.cgHeight;
    let izz = B.izz;
    for (let i = 0; i < 4; i++) izz += this.mu[i] * (this.xw[i] ** 2 + this.yw[i] ** 2);
    izz += this.ms * cgX * cgX;
    this.izz = izz;
    // 静载
    const fsF = (this.ms * GRAVITY * this.bS) / L / 2;
    const fsR = (this.ms * GRAVITY * this.aS) / L / 2;
    for (let i = 0; i < 4; i++) {
      this.fs0[i] = i < 2 ? fsF : fsR;
      this.fz0[i] = this.fs0[i] + this.mu[i] * GRAVITY;
      const tp = this.tires[i].p;
      this.r0[i] = tp.unloadedRadius;
      this.rEff[i] = tp.unloadedRadius - this.fz0[i] / tp.verticalStiffness / 3;
      // 低速阻尼：按轮胎松弛"弹簧"与车轮角质量配置临界阻尼比 ~0.5
      const mCorner = this.m / 4;
      const kx = (tp.kxCoeff * this.fz0[i]) / tp.relaxX;
      const ky = (tp.kyCoeff * tp.nominalLoad) / tp.relaxY;
      this.cdx[i] = Math.sqrt(kx * mCorner);
      this.cdy[i] = Math.sqrt(ky * mCorner);
    }
    this.hrcRoll = (p.suspFront.rollCenterHeight * this.bS + p.suspRear.rollCenterHeight * this.aS) / L;
    const tanF = (p.suspFront.antiPitch * this.hs) / L;
    const tanR = (p.suspRear.antiPitch * this.hs) / L;
    this.tanAnti[0] = this.tanAnti[1] = -tanF;
    this.tanAnti[2] = this.tanAnti[3] = tanR;
    // 驱动扭矩分配
    const P = p.powertrain;
    const sf = P.driveType === 'FWD' ? 1 : P.driveType === 'RWD' ? 0 : clamp(P.frontTorqueSplit, 0, 1);
    this.driveShare[0] = this.driveShare[1] = sf / 2;
    this.driveShare[2] = this.driveShare[3] = (1 - sf) / 2;
    this.pt = new PowertrainModel(P);
  }

  /** 初始化到给定车速与位置 */
  reset(speed: number, x = 0, y = 0, psi = 0) {
    this.t = 0;
    this.X = x; this.Y = y; this.psi = psi;
    this.u = speed; this.v = 0; this.r = 0;
    this.zs = 0; this.vzs = 0; this.phi = 0; this.p_ = 0; this.theta = 0; this.q = 0;
    const c = Math.cos(psi), s = Math.sin(psi);
    for (let i = 0; i < 4; i++) {
      const cx = x + c * this.xw[i] - s * this.yw[i];
      const cy = y + s * this.xw[i] + c * this.yw[i];
      const zr = this.road.height(cx, cy);
      this.zrPrev[i] = zr;
      this.zu[i] = zr;
      this.vzu[i] = 0;
      this.omega[i] = speed / this.rEff[i];
      this.spin[i] = 0;
      this.kap[i] = 0;
      this.alp[i] = 0;
      this.pWheel[i] = 0;
      this.absP[i] = 0;
      this.absActive[i] = false;
      this.escP[i] = 0;
      this.fz[i] = this.fz0[i];
      this.fy[i] = 0;
      this.fyFilt[i] = 0;
    }
    this.pMaster = 0;
    this.gma = 0;
    this.tcsFactor = 1;
    this.escActive = false;
    this.pt.init(this.axleSpeed());
  }

  /** 差速器输入端等效车轮转速 */
  private axleSpeed(): number {
    const sf = this.driveShare[0] * 2;
    const wF = (this.omega[FL] + this.omega[FR]) / 2;
    const wR = (this.omega[RL] + this.omega[RR]) / 2;
    return sf * wF + (1 - sf) * wR;
  }

  /** 将期望的总驱动力（N）换算为油门开度（驾驶员模型前馈） */
  throttleForForce(force: number): number {
    const r = (this.rEff[0] + this.rEff[2]) / 2;
    return this.pt.throttleForTorque(force * r);
  }

  /** 将期望的总制动力（N）换算为制动踏板开度 */
  pedalForForce(force: number): number {
    const b = this.p.brakes;
    const r = (this.rEff[0] + this.rEff[2]) / 2;
    const fMax = (b.maxPressure * 2 * (b.frontGain + b.rearGain)) / r;
    return clamp(force / fMax, 0, 1);
  }

  get speed() {
    return Math.hypot(this.u, this.v);
  }

  get beta() {
    return Math.abs(this.u) > 0.5 ? Math.atan2(this.v, Math.abs(this.u)) : 0;
  }

  step(dt: number, inp: DriverInput) {
    const P = this.p;
    const L = P.body.wheelbase;
    const cpsi = Math.cos(this.psi), spsi = Math.sin(this.psi);

    // ---------------- 转向系统 ----------------
    const maxSW = P.steering.maxWheelAngle;
    this.steerSW = clamp(inp.steer, -maxSW, maxSW);
    const d = (this.steerSW / P.steering.ratio) * DEG;
    let dL = d, dR = d;
    const ack = P.steering.ackermann;
    const tfh = P.body.trackFront / 2;
    if (Math.abs(d) > 1e-4 && ack > 0) {
      const R = Math.max(L / Math.tan(Math.abs(d)), tfh + 0.2);
      const din = Math.atan(L / (R - tfh));
      const dout = Math.atan(L / (R + tfh));
      if (d > 0) { dL = d + ack * (din - d); dR = d + ack * (dout - d); }
      else { dL = d + ack * (-dout - d); dR = d + ack * (-din - d); }
    }

    // ---------------- 垂向：悬架与轮胎载荷 ----------------
    for (let i = 0; i < 4; i++) {
      const s = this.susp[i];
      const zc = this.zs - this.xs[i] * this.theta + this.yw[i] * this.phi;
      const vzc = this.vzs - this.xs[i] * this.q + this.yw[i] * this.p_;
      const c = this.zu[i] - zc;
      const cd = this.vzu[i] - vzc;
      this.comp[i] = c;
      let F = s.springRate * c;
      const coef = cd > 0 ? s.damperBump : s.damperRebound;
      const acd = Math.abs(cd);
      F += acd <= s.damperKnee ? coef * cd : Math.sign(cd) * (coef * s.damperKnee + coef * s.damperHighRatio * (acd - s.damperKnee));
      if (c > s.bumpTravel) {
        const e = c - s.bumpTravel;
        F += s.bumpStopRate * e * (1 + 30 * e);
      } else if (c < -s.reboundTravel) {
        F += s.bumpStopRate * (c + s.reboundTravel);
      }
      this.fsusp[i] = F;

      const cx = this.X + cpsi * this.xw[i] - spsi * this.yw[i];
      const cy = this.Y + spsi * this.xw[i] + cpsi * this.yw[i];
      const zr = this.road.height(cx, cy);
      const vzr = (zr - this.zrPrev[i]) / dt;
      this.zrPrev[i] = zr;
      this.zRoad[i] = zr;
      this.muRoad[i] = this.road.mu(cx, cy);
      const tp = this.tires[i].p;
      const fzT = this.fz0[i] + tp.verticalStiffness * (zr - this.zu[i]) + tp.verticalDamping * (vzr - this.vzu[i]);
      this.fz[i] = fzT > 0 ? fzT : 0;
    }
    // 横向稳定杆
    {
      const dF = (this.comp[FL] - this.comp[FR]) * P.suspFront.arbRate;
      this.fsusp[FL] += dF; this.fsusp[FR] -= dF;
      const dR2 = (this.comp[RL] - this.comp[RR]) * P.suspRear.arbRate;
      this.fsusp[RL] += dR2; this.fsusp[RR] -= dR2;
    }

    // ---------------- 车轮转角（含前束 / 轮跳转向 / 侧向力柔度转向）----------------
    for (let i = 0; i < 4; i++) {
      const s = this.susp[i];
      const base = i === FL ? dL : i === FR ? dR : 0;
      this.fyFilt[i] += (this.fy[i] - this.fyFilt[i]) * Math.min(1, dt / 0.02);
      // 柔度转向：正值为不足转向趋势（前轮顺侧向力反向转，后轮同向转）
      const comply = (i < 2 ? -1 : 1) * s.complianceSteer * this.fyFilt[i] * 1e-3;
      this.delta[i] = base + (comply - this.side[i] * (s.toeStatic + s.bumpSteer * this.comp[i])) * DEG;
    }

    // ---------------- 轮胎力 ----------------
    const vxw = [0, 0, 0, 0];
    const vyw = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const vx = this.u - this.r * this.yw[i];
      const vy = this.v + this.r * this.xw[i];
      const cd = Math.cos(this.delta[i]), sd = Math.sin(this.delta[i]);
      const vxi = vx * cd + vy * sd;
      const vyi = -vx * sd + vy * cd;
      vxw[i] = vxi; vyw[i] = vyi;
      const s = this.susp[i];
      const gam = this.side[i] * (s.camberStatic + s.camberGain * this.comp[i]) * DEG - this.phi;
      this.gamma[i] = gam;
      const fz = this.fz[i];
      const out = this.tires[i].compute(this.kap[i], this.alp[i], gam, fz, this.muRoad[i], this.tireOut);
      let fx = out.fx, fy = out.fy;
      const w = 1 - Math.abs(vxi) / V_LOW;
      if (w > 0 && fz > 0) {
        const ld = fz / this.fz0[i];
        fx += w * this.cdx[i] * ld * (this.omega[i] * this.rEff[i] - vxi);
        fy += w * this.cdy[i] * ld * -vyi;
        const lim = 1.1 * this.muRoad[i] * Math.max(this.tires[i].p.muX, this.tires[i].p.muY) * fz;
        const mag = Math.hypot(fx, fy);
        if (mag > lim) { fx *= lim / mag; fy *= lim / mag; }
      }
      this.fx[i] = fx;
      this.fy[i] = fy;
      this.mz[i] = out.mz;
      this.fxV[i] = fx * cd - fy * sd;
      this.fyV[i] = fx * sd + fy * cd;
      const avx = Math.max(Math.abs(vxi), 0.5);
      this.slip[i] = (this.omega[i] * this.rEff[i] - vxi) / avx;
      // 输出侧偏角取瞬态滑移状态（与侧向力同号，左转时为正）
      this.slipAngle[i] = Math.atan(this.alp[i]);
    }

    // ---------------- 空气动力 ----------------
    const A = P.aero.area;
    const qd = 0.5 * AIR_DENSITY * A * this.u * this.u;
    const drag = 0.5 * AIR_DENSITY * P.aero.cd * A * this.u * Math.abs(this.u);
    const liftF = P.aero.clFront * qd;
    const liftR = P.aero.clRear * qd;
    this.drag = drag;

    // ---------------- 平面运动（整车质量）----------------
    let sumFx = -drag, sumFy = 0, mzSum = 0;
    for (let i = 0; i < 4; i++) {
      sumFx += this.fxV[i];
      sumFy += this.fyV[i];
      mzSum += this.xw[i] * this.fyV[i] - this.yw[i] * this.fxV[i] + this.mz[i];
    }
    const ax = sumFx / this.m;
    const ay = sumFy / this.m;
    const du = ax + this.v * this.r;
    const dv = ay - this.u * this.r;
    const dr = mzSum / this.izz;
    this.ax = ax; this.ay = ay; this.rdot = dr;

    // ---------------- 簧上质量垂向 / 侧倾 / 俯仰 ----------------
    let sumFb = 0, rollM = 0, pitchM = 0, sumFxs = 0, sumFys = 0;
    const fb = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const fxs = this.fxV[i] - this.mu[i] * ax;
      const fys = this.fyV[i] - this.mu[i] * ay;
      const hrc = this.susp[i].rollCenterHeight;
      // 连杆几何（侧倾中心 / 抗点头）引起的顶起力
      const jack = (-fys * hrc) / this.yw[i] + fxs * this.tanAnti[i];
      const F = this.fsusp[i] + jack;
      fb[i] = F;
      sumFb += F;
      rollM += this.yw[i] * F;
      pitchM += -this.xs[i] * F;
      sumFxs += fxs;
      sumFys += fys;
    }
    const hs = this.hs;
    const azs = (sumFb + liftF + liftR) / this.ms;
    const dp = (rollM + hs * sumFys + this.ms * GRAVITY * (hs - this.hrcRoll) * this.phi) / P.body.ixx;
    const dq = (pitchM - hs * sumFxs - (P.aero.height - hs) * drag - this.aS * liftF + this.bS * liftR) / P.body.iyy;
    this.azs = azs;

    // ---------------- 主动安全：ESC / TCS ----------------
    let throttle = clamp(inp.throttle, 0, 1);
    this.escActive = false;
    const escTarget = [0, 0, 0, 0];
    if (P.controls.esc && this.u > 5) {
      const dAvg = (this.delta[FL] + this.delta[FR]) / 2;
      const kus = Math.max(this.derived.kus, 0);
      const rLin = (this.u * dAvg) / (L + kus * this.u * this.u);
      const muEst = this.road.mu(this.X, this.Y);
      const rMax = (0.85 * muEst * GRAVITY) / this.u;
      const rRef = clamp(rLin, -rMax, rMax);
      const e = this.r - rRef;
      const db = 0.035 + 0.12 * Math.abs(rRef);
      const beta = this.beta;
      const betaExceed = Math.abs(beta) > 0.1 && beta * this.r < 0;
      if (Math.abs(e) > db || betaExceed) {
        const over = Math.abs(this.r) > Math.abs(rRef) || this.r * rRef < 0 || betaExceed;
        const mag = Math.max(Math.abs(e) - db, 0) + (betaExceed ? (Math.abs(beta) - 0.1) * 3 : 0);
        const pr = Math.min(P.brakes.maxPressure, 70 * mag);
        if (over) escTarget[e > 0 ? FR : FL] = pr;
        else escTarget[e < 0 ? RL : RR] = pr * 0.7;
        if (pr > 0.3) {
          this.escActive = true;
          throttle *= 0.3;
        }
      }
    }
    for (let i = 0; i < 4; i++) this.escP[i] += (escTarget[i] - this.escP[i]) * Math.min(1, dt / 0.05);

    this.tcsActive = false;
    if (P.controls.tcs && throttle > 0) {
      let maxSlip = 0;
      for (let i = 0; i < 4; i++) {
        if (this.driveShare[i] <= 0) continue;
        const s = (this.omega[i] * this.rEff[i] - vxw[i]) / Math.max(Math.abs(vxw[i]), 2);
        maxSlip = Math.max(maxSlip, s);
      }
      if (maxSlip > 0.15) this.tcsFactor -= 3 * dt;
      else this.tcsFactor += 1.0 * dt;
      this.tcsFactor = clamp(this.tcsFactor, 0.05, 1);
      throttle *= this.tcsFactor;
      this.tcsActive = this.tcsFactor < 0.98;
    } else {
      this.tcsFactor = Math.min(1, this.tcsFactor + dt);
    }
    this.throttle = throttle;

    // ---------------- 动力总成 ----------------
    const tOut = this.pt.update(dt, this.axleSpeed(), throttle);
    for (let i = 0; i < 4; i++) this.driveT[i] = tOut * this.driveShare[i];
    const lsd = P.powertrain.lsdCoupling;
    if (lsd > 0) {
      if (this.driveShare[FL] > 0) {
        const tl = lsd * (this.omega[FL] - this.omega[FR]);
        this.driveT[FL] -= tl; this.driveT[FR] += tl;
      }
      if (this.driveShare[RL] > 0) {
        const tl = lsd * (this.omega[RL] - this.omega[RR]);
        this.driveT[RL] -= tl; this.driveT[RR] += tl;
      }
    }

    // ---------------- 制动系统 / ABS ----------------
    const Bk = P.brakes;
    this.brake = clamp(inp.brake, 0, 1);
    this.pMaster += (this.brake * Bk.maxPressure - this.pMaster) * Math.min(1, dt / Bk.timeConstant);
    const pw = this.pTmp;
    for (let i = 0; i < 4; i++) {
      pw[i] = this.pMaster;
      if (P.controls.abs && Math.abs(vxw[i]) > 2 && pw[i] > 0.2) {
        const s = (this.omega[i] * this.rEff[i] - vxw[i]) / Math.abs(vxw[i]);
        if (!this.absActive[i] && s < -0.14) {
          this.absActive[i] = true;
          this.absP[i] = this.pWheel[i];
        }
        if (this.absActive[i]) {
          if (s < -0.14) this.absP[i] -= 140 * dt;
          else if (s > -0.07) this.absP[i] += 45 * dt;
          this.absP[i] = clamp(this.absP[i], 0, pw[i]);
          if (this.absP[i] >= pw[i] - 1e-3 && s > -0.07) this.absActive[i] = false;
          pw[i] = this.absP[i];
        }
      } else {
        this.absActive[i] = false;
      }
    }
    if (P.controls.abs) {
      // 后轴低选（select-low）：保证后轴侧向稳定
      if (this.absActive[RL] || this.absActive[RR]) pw[RL] = pw[RR] = Math.min(pw[RL], pw[RR]);
      // 前轴横摆力矩延迟（GMA）：对开路面上高附着侧压力缓慢建立
      if (this.absActive[FL] || this.absActive[FR]) {
        this.gma = Math.min(this.gma + 5 * dt, Bk.maxPressure);
        const lo = pw[FL] < pw[FR] ? FL : FR, hi = lo === FL ? FR : FL;
        pw[hi] = Math.min(pw[hi], pw[lo] + 1 + this.gma);
      } else {
        this.gma = 0;
      }
    }
    for (let i = 0; i < 4; i++) {
      const p = Math.max(pw[i], this.escP[i]);
      this.pWheel[i] = p;
      const gain = i < 2 ? Bk.frontGain : Bk.rearGain;
      let tb = p * gain;
      if (i >= 2 && inp.handbrake) tb += inp.handbrake * 2500;
      this.brakeT[i] = tb;
    }

    // ================= 积分：先速度 =================
    this.u += du * dt;
    this.v += dv * dt;
    this.r += dr * dt;
    this.vzs += azs * dt;
    this.p_ += dp * dt;
    this.q += dq * dt;
    for (let i = 0; i < 4; i++) {
      const azu = (this.fz[i] - this.fz0[i] - fb[i]) / this.mu[i];
      this.vzu[i] += azu * dt;

      const tp = this.tires[i].p;
      const R = this.rEff[i];
      const I = P.powertrain.wheelInertia + this.pt.reflectedInertia * this.driveShare[i];
      const trr = tp.rollingResistance * this.fz[i] * R * clamp(this.omega[i] / 0.5, -1, 1);
      const wFree = this.omega[i] + (dt * (this.driveT[i] - R * this.fx[i] - trr)) / I;
      const dB = (dt * this.brakeT[i]) / I;
      this.omega[i] = Math.abs(wFree) <= dB ? 0 : wFree - Math.sign(wFree) * dB;
    }

    // ================= 再位置 =================
    this.psi += this.r * dt;
    const c2 = Math.cos(this.psi), s2 = Math.sin(this.psi);
    this.X += (this.u * c2 - this.v * s2) * dt;
    this.Y += (this.u * s2 + this.v * c2) * dt;
    this.zs += this.vzs * dt;
    this.phi += this.p_ * dt;
    this.theta += this.q * dt;
    for (let i = 0; i < 4; i++) {
      this.zu[i] += this.vzu[i] * dt;
      this.spin[i] += this.omega[i] * dt;

      // 轮胎松弛方程：σ dκ/dt + |Vx| κ = Vsx（指数积分，无条件稳定）
      const tp = this.tires[i].p;
      const avx = Math.abs(vxw[i]);
      const vsx = this.omega[i] * this.rEff[i] - vxw[i];
      const vsy = -vyw[i];
      // 低速时以 V_LEAK 为下限，使静止后的残余变形缓慢释放（避免前后轮"互顶"）
      const avxE = Math.max(avx, V_LEAK);
      const ex = Math.exp((-avxE * dt) / tp.relaxX);
      const ey = Math.exp((-avxE * dt) / tp.relaxY);
      const kss = vsx / avxE, ass = vsy / avxE;
      this.kap[i] = kss + (this.kap[i] - kss) * ex;
      this.alp[i] = ass + (this.alp[i] - ass) * ey;
      this.kap[i] = clamp(this.kap[i], -3, 3);
      this.alp[i] = clamp(this.alp[i], -2, 2);
    }
    this.t += dt;
  }
}
