// 动力总成：发动机外特性 + 液力变矩器（准静态）+ 闭锁离合器 + 自动变速器换挡逻辑
import type { Powertrain } from './params';
import { RPM, clamp, interp1, lerp } from './math';

// 变矩器容量系数（相对失速点）与速比 SR = ω涡轮/ω泵轮 的关系；SR>1 为反拖
const SR_TABLE = [0, 0.5, 0.7, 0.8, 0.87, 0.92, 0.96, 1.0, 1.04, 1.1, 1.3];
const CAP_TABLE = [1, 0.97, 0.9, 0.82, 0.7, 0.55, 0.32, 0, -0.4, -0.8, -1.2];

export class PowertrainModel {
  readonly p: Powertrain;
  gear = 1;
  shiftTimer = 0;
  sinceShift = 10;
  locked = false;
  engineW = 0; // rad/s
  engineTorque = 0; // N·m
  turbineTorque = 0;
  outputTorque = 0; // 差速器输入扭矩（已含主减速比）
  reflectedInertia = 0; // 闭锁时折算到车轮侧的发动机惯量 Ie·G²
  private c0: number;

  constructor(p: Powertrain) {
    this.p = p;
    const k = 60 / (2 * Math.PI);
    this.c0 = (k * k) / (p.converterK * p.converterK);
    this.engineW = p.idleRpm * RPM;
  }

  get nGears() {
    return this.p.gearRatios.length;
  }

  ratio(gear = this.gear) {
    return this.p.gearRatios[gear - 1] * this.p.finalDrive;
  }

  get engineRpm() {
    return this.engineW / RPM;
  }

  /** 发动机扭矩：油门插值外特性与倒拖摩擦扭矩，含怠速控制与断油 */
  engineTorqueAt(w: number, throttle: number): number {
    const p = this.p;
    const rpm = w / RPM;
    let thr = clamp(throttle, 0, 1);
    const idleThr = clamp((p.idleRpm - rpm) / 100, 0, 1) * 0.5;
    thr = Math.max(thr, idleThr);
    if (rpm > p.redlineRpm) thr = 0; // 断油
    const tMax = interp1(p.engineRpm, p.engineTorque, rpm);
    const tFric = -(p.frictionTorque0 + (p.frictionTorqueK * Math.max(rpm, 0)) / 1000);
    return thr * tMax + (1 - thr) * tFric;
  }

  /** 变矩器泵轮扭矩 */
  pumpTorque(we: number, wt: number): number {
    const sr = wt / Math.max(we, 1);
    return this.c0 * interp1(SR_TABLE, CAP_TABLE, sr) * we * we;
  }

  torqueRatio(sr: number): number {
    if (sr >= 0.85) return 1;
    return lerp(this.p.converterTorqueRatio, 1, Math.max(sr, 0) / 0.85);
  }

  /** 按当前车速选择初始档位 */
  init(wAxle: number) {
    const p = this.p;
    this.gear = 1;
    for (let g = 1; g <= this.nGears; g++) {
      const rpm = (wAxle * this.ratio(g)) / RPM;
      this.gear = g;
      if (rpm < lerp(p.upshiftRpmLight, p.upshiftRpmFull, 0.4)) break;
    }
    const wt = wAxle * this.ratio();
    this.locked = this.gear >= p.lockupGear && wt / RPM > p.lockupRpm;
    this.engineW = this.locked ? wt : Math.max(p.idleRpm * RPM, wt);
    this.shiftTimer = 0;
    this.sinceShift = 10;
  }

  /**
   * 推进一步
   * @param wAxle 差速器输入端等效车轮转速 rad/s
   * @returns 差速器输入扭矩（N·m，折算到车轮侧）
   */
  update(dt: number, wAxle: number, throttle: number): number {
    const p = this.p;
    this.sinceShift += dt;
    if (this.shiftTimer > 0) this.shiftTimer -= dt;

    let wt = wAxle * this.ratio();
    const rpmT = wt / RPM;
    if (this.shiftTimer <= 0 && this.sinceShift > 0.8) {
      const up = lerp(p.upshiftRpmLight, p.upshiftRpmFull, throttle);
      const down = lerp(p.downshiftRpmLight, p.downshiftRpmFull, throttle);
      if (this.gear < this.nGears && rpmT > up) {
        this.gear++;
        this.shiftTimer = p.shiftTime;
        this.sinceShift = 0;
      } else if (this.gear > 1 && rpmT < down) {
        this.gear--;
        this.shiftTimer = p.shiftTime;
        this.sinceShift = 0;
      }
    }
    const G = this.ratio();
    wt = wAxle * G;
    const shifting = this.shiftTimer > 0;
    const rpmT2 = wt / RPM;
    if (shifting || this.gear < p.lockupGear || rpmT2 < p.lockupRpm * 0.8) this.locked = false;
    else if (rpmT2 > p.lockupRpm) this.locked = true;

    if (this.locked) {
      this.engineW = wt;
      this.engineTorque = this.engineTorqueAt(wt, throttle);
      this.turbineTorque = this.engineTorque;
      this.reflectedInertia = p.engineInertia * G * G;
    } else {
      this.engineW = this.solveConverter(wt, throttle);
      this.engineTorque = this.engineTorqueAt(this.engineW, throttle);
      const tp = this.pumpTorque(this.engineW, wt);
      this.turbineTorque = tp * this.torqueRatio(wt / this.engineW);
      this.reflectedInertia = 0;
    }
    let out = this.turbineTorque * G;
    if (out > 0) out *= p.efficiency;
    if (shifting) out *= 0.35;
    this.outputTorque = out;
    return out;
  }

  /** 求解变矩器平衡转速：T_engine(ωe) = T_pump(ωe, ωt)，二分法 */
  private solveConverter(wt: number, throttle: number): number {
    const lo0 = 100 * RPM;
    const hi0 = Math.max(this.p.redlineRpm * 1.2 * RPM, wt * 1.4);
    const f = (we: number) => this.engineTorqueAt(we, throttle) - this.pumpTorque(we, wt);
    let lo = lo0, hi = hi0;
    if (f(lo) <= 0) return lo;
    if (f(hi) >= 0) return hi;
    // 用上一步结果缩小初始区间
    const w0 = this.engineW;
    const span = 40 * RPM;
    if (w0 - span > lo && f(w0 - span) > 0) lo = w0 - span;
    if (w0 + span < hi && f(w0 + span) < 0) hi = w0 + span;
    for (let i = 0; i < 30; i++) {
      const mid = 0.5 * (lo + hi);
      if (f(mid) > 0) lo = mid;
      else hi = mid;
      if (hi - lo < 0.05) break;
    }
    return 0.5 * (lo + hi);
  }

  /** 当前工况下，期望驱动力对应的油门开度（供驾驶员模型前馈） */
  throttleForTorque(tOut: number): number {
    const G = this.ratio();
    const tEng = tOut / (G * this.p.efficiency);
    const w = this.engineW;
    const tMax = this.engineTorqueAt(w, 1);
    const tMin = this.engineTorqueAt(w, 0);
    if (tMax - tMin < 1) return tEng > 0 ? 1 : 0;
    return clamp((tEng - tMin) / (tMax - tMin), 0, 1);
  }
}
