// 实时驾驶模式（类似 VI-CarRealTime 的驾驶员在环）：键盘 / 手柄 / 方向盘驾驶
import type { SimResult, SceneDesc } from '../core/types';
import type { RoadDef } from '../core/road';
import { Road } from '../core/road';
import { Vehicle, SIM_DT, type DriverInput } from '../core/vehicle';
import { cloneVehicle, type VehicleParams } from '../core/params';
import { CHANNELS, type DriverContext } from '../core/channels';
import { buildSplineTrack, TRACK_CONTROL_POINTS } from '../core/procedures';
import { Path, type PathPoint } from '../core/path';
import { clamp, lerp, RAD } from '../core/math';
import { maxIn, maxAbsIn } from '../core/analysis';
import { h, clear, toast, secHead } from './dom';
import { Animator, CAMERA_MODES } from './animator';
import { Hud } from './hud';
import { Plot } from './plot';
import { frameFromVehicle } from './frames';
import type { VehicleStore } from './store';

interface RtScene {
  id: string;
  name: string;
  desc: string;
  road: RoadDef;
  path?: Path;
  ribbon?: number;
  cones?: { x: number; y: number }[];
  start: { x: number; y: number; yaw: number };
}

function circlePath(R: number, cx: number, cy: number): Path {
  const pts: PathPoint[] = [];
  for (let i = 0; i < 360; i++) {
    const a = -Math.PI / 2 + (i / 360) * 2 * Math.PI;
    pts.push({ x: cx + R * Math.cos(a), y: cy + R + R * Math.sin(a) });
  }
  return new Path(pts, true);
}

function buildScenes(): RtScene[] {
  const track = buildSplineTrack(TRACK_CONTROL_POINTS, 1);
  const p0 = track.pointAt(0);
  const padCones: { x: number; y: number }[] = [];
  for (let i = 0; i < 10; i++) padCones.push({ x: 80 + i * 18, y: 0 });
  for (let i = 0; i < 6; i++) padCones.push({ x: 80 + i * 6, y: 40 }, { x: 80 + i * 6, y: 43 });
  return [
    {
      id: 'pad', name: '动态广场 (干沥青)', desc: '开阔试验场，μ = 1.0，前方有蛇行桩，可自由练习',
      road: { mu: 1 }, cones: padCones, start: { x: 0, y: 0, yaw: 0 },
    },
    {
      id: 'track', name: '操控赛道 1.3 km', desc: '闭合赛道，μ = 1.0',
      road: { mu: 1 }, path: track, ribbon: 12, start: { x: p0.x, y: p0.y, yaw: p0.heading },
    },
    {
      id: 'snow', name: '冰雪圆环 (μ=0.3)', desc: '低附着广场，半径 30 m 定圆，适合练习漂移与 ESC 体验',
      road: { mu: 0.3 }, path: circlePath(30, 40, 0), ribbon: 8, start: { x: 0, y: 0, yaw: 0 },
    },
    {
      id: 'split', name: '对开路面', desc: '左侧 μ=0.2 / 右侧 μ=1.0（x > 50 m），体验对开路面制动',
      road: { mu: 1, muPatches: [{ x0: 50, x1: 1500, y0: 0, y1: 50, mu: 0.2 }] },
      path: Path.fromFunction(-50, 1500, () => 0, 2), ribbon: 8, start: { x: 0, y: -0.2, yaw: 0 },
    },
    {
      id: 'rough', name: '颠簸路 (D 级随机路面)', desc: '直线 1 km 的 ISO 8608 D 级随机路面，体验平顺性',
      road: { mu: 1, random: { cls: 'D', x0: 30, x1: 1030, seed: 7 } },
      path: Path.fromFunction(-50, 1100, () => 0, 2), ribbon: 7, start: { x: 0, y: 0, yaw: 0 },
    },
  ];
}

export class Realtime {
  readonly el: HTMLDivElement;
  private animator: Animator;
  private hud: Hud;
  private scenes = buildScenes();
  private scene: RtScene;
  private veh!: Vehicle;
  private keys = new Set<string>();
  private steer = 0;
  private throttle = 0;
  private brake = 0;
  private handbrake = 0;
  private acc = 0;
  private last = 0;
  private visible = false;
  private paused = false;
  private recording = false;
  private rec: { t: number[]; ch: number[][] } | null = null;
  private recT0 = 0;
  private strip: { plot: Plot; key: string; color: string; label: string; data: number[] }[] = [];
  private stripT: number[] = [];
  private stripTimer = 0;
  private trailTimer = 0;
  private vp!: VehicleParams;
  private sceneSel!: HTMLSelectElement;
  private vehSel!: HTMLSelectElement;
  private recBtn!: HTMLButtonElement;
  private ctrlBox!: HTMLDivElement;
  private padInfo!: HTMLDivElement;
  private ggCanvas!: HTMLCanvasElement;
  private ggTrail: [number, number][] = [];
  onSaveRun: ((r: SimResult) => void) | null = null;

  constructor(private store: VehicleStore) {
    this.scene = this.scenes[0];
    const animBox = h('div', { class: 'anim-box rt' });
    this.animator = new Animator(animBox);
    this.animator.active = false;
    this.hud = new Hud(animBox);
    const camBar = h('div', { class: 'cam-bar seg' });
    const camBtns: Record<string, HTMLButtonElement> = {};
    for (const m of CAMERA_MODES) {
      const b = h('button', { class: m.id === 'chase' ? 'active' : '', onclick: () => this.animator.setCameraMode(m.id) }, m.label);
      camBtns[m.id] = b;
      camBar.appendChild(b);
    }
    this.animator.el.addEventListener('cameramode', (e) => {
      for (const [k, b] of Object.entries(camBtns)) b.classList.toggle('active', k === (e as CustomEvent).detail);
    });
    animBox.appendChild(camBar);
    this.ggCanvas = h('canvas', { class: 'gg', width: 150, height: 150 });
    animBox.appendChild(this.ggCanvas);
    animBox.appendChild(h('div', { class: 'rt-keys' },
      h('div', null, h('kbd', null, 'W'), '/', h('kbd', null, '↑'), ' 油门'),
      h('div', null, h('kbd', null, 'S'), '/', h('kbd', null, '↓'), ' 制动'),
      h('div', null, h('kbd', null, 'A'), h('kbd', null, 'D'), '/', h('kbd', null, '←'), h('kbd', null, '→'), ' 转向'),
      h('div', null, h('kbd', null, '空格'), ' 手刹  ', h('kbd', null, 'R'), ' 重置  ', h('kbd', null, 'C'), ' 视角  ', h('kbd', null, 'P'), ' 暂停'),
    ));

    // 右侧控制面板
    this.vehSel = h('select', { class: 'veh-select', onchange: (e: Event) => { this.store.select((e.target as HTMLSelectElement).value); } });
    this.sceneSel = h('select', { onchange: (e: Event) => { this.scene = this.scenes.find((s) => s.id === (e.target as HTMLSelectElement).value)!; this.resetVehicle(true); } },
      this.scenes.map((s) => h('option', { value: s.id }, s.name)));
    this.ctrlBox = h('div', { class: 'ctrl-box' });
    this.recBtn = h('button', { class: 'btn btn-primary', onclick: () => this.toggleRecord() }, '开始记录');
    this.padInfo = h('div', { class: 'hint', style: { marginTop: '0' } }, '未检测到手柄/方向盘（连接后按任意键激活）');
    const stripBox = h('div', { class: 'rt-strip' });
    const right = h('aside', { class: 'panel right rt-panel' },
      h('div', { class: 'card' }, secHead('Vehicle', '车辆'), this.vehSel),
      h('div', { class: 'card' }, secHead('Scene', '场景'), this.sceneSel, h('div', { class: 'hint scene-desc' })),
      h('div', { class: 'card' }, secHead('Controls', '主动安全系统'), this.ctrlBox),
      h('div', { class: 'card' }, secHead('Record', '数据记录'),
        h('div', { class: 'btn-row' }, this.recBtn, h('button', { class: 'btn', onclick: () => this.resetVehicle(true) }, '重置车辆')),
        h('div', { class: 'hint' }, '记录的数据可保存为仿真结果，在「试验仿真」页回放、绘图、导出 CSV。')),
      h('div', { class: 'card' }, secHead('Input', '输入设备'), this.padInfo),
      h('div', { class: 'card grow' }, secHead('Live', '实时曲线 · 最近 15 s'), stripBox),
    );
    for (const [key, label, color] of [['Vx', '车速 km/h', '#0071e3'], ['Ay', '侧向加速度 g', '#0071e3'], ['AVz', '横摆角速度 °/s', '#0071e3'], ['Beta', '质心侧偏角 °', '#0071e3']] as const) {
      const box = h('div', { class: 'strip-item' });
      stripBox.appendChild(box);
      this.strip.push({ plot: new Plot(box), key, color, label, data: [] });
    }
    this.el = h('div', { class: 'view realtime' }, h('main', { class: 'center' }, animBox), right);

    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepadconnected', (e) => {
      this.padInfo.textContent = `已连接：${(e as GamepadEvent).gamepad.id}（左摇杆/方向盘转向，RT 油门，LT 制动）`;
    });
    store.onChange(() => {
      this.renderVehSel();
      if (this.store.selected !== this.vp && this.visible) this.resetVehicle(false);
    });
    this.renderVehSel();
    this.resetVehicle(true);
    this.animator.start();
    requestAnimationFrame((t) => this.loop(t));
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.animator.active = v;
    if (v) {
      this.animator.resize();
      if (this.store.selected !== this.vp) this.resetVehicle(false);
      this.last = 0;
    } else {
      this.keys.clear();
    }
  }

  private renderVehSel() {
    clear(this.vehSel);
    for (const v of this.store.list) this.vehSel.appendChild(h('option', { value: v.id, selected: v.id === this.store.selectedId }, (v.builtin ? '★ ' : '') + v.name));
  }

  private renderControls() {
    clear(this.ctrlBox);
    const c = this.veh.p.controls;
    for (const [k, label] of [['abs', 'ABS 防抱死'], ['esc', 'ESC 车身稳定'], ['tcs', 'TCS 牵引力控制']] as const) {
      this.ctrlBox.appendChild(h('label', { class: 'switch-row' }, label,
        h('span', { class: 'switch' },
          h('input', { type: 'checkbox', checked: c[k], onchange: (e: Event) => { c[k] = (e.target as HTMLInputElement).checked; } }),
          h('span', { class: 'slider' }))));
    }
  }

  private sceneDesc(): SceneDesc {
    const s = this.scene;
    return {
      road: s.road,
      path: s.path ? { x: Array.from(s.path.xs), y: Array.from(s.path.ys), closed: s.path.closed } : undefined,
      ribbonWidth: s.ribbon,
      cones: s.cones,
    };
  }

  private resetVehicle(rebuildScene: boolean) {
    this.vp = this.store.selected;
    const vp = cloneVehicle(this.vp);
    this.veh = new Vehicle(vp, new Road(this.scene.road));
    const st = this.scene.start;
    this.veh.reset(0, st.x, st.y, st.yaw);
    this.steer = this.throttle = this.brake = 0;
    if (rebuildScene) {
      this.animator.setScene(this.sceneDesc());
      (this.el?.querySelector('.scene-desc') as HTMLElement | null)?.replaceChildren(this.scene.desc);
    }
    this.animator.setVehicles([{ id: 'rt-' + vp.id + Math.random(), vp }]);
    this.animator.clearTrail();
    this.animator.setFrames([frameFromVehicle(this.veh)]);
    this.ggTrail = [];
    if (this.ctrlBox) this.renderControls();
    if (this.recording) this.stopRecord(false);
    for (const s of this.strip) s.data = [];
    this.stripT = [];
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if (!this.visible) return;
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (down && !e.repeat) {
      if (k === 'r') this.resetVehicle(false);
      if (k === 'c') {
        const ids = CAMERA_MODES.map((m) => m.id);
        this.animator.setCameraMode(ids[(ids.indexOf(this.animator.cameraMode) + 1) % ids.length]);
      }
      if (k === 'p') this.paused = !this.paused;
    }
    if (down) this.keys.add(k); else this.keys.delete(k);
  }

  private readInput(dt: number): DriverInput {
    const k = this.keys;
    const maxSW = this.veh.p.steering.maxWheelAngle;
    const u = Math.abs(this.veh.u);
    // 随车速减小的键盘转向范围（模拟驾驶员在高速时的小转角操作）
    const range = lerp(maxSW * 0.9, 45, clamp(u / 38, 0, 1));
    let target = 0;
    if (k.has('a') || k.has('arrowleft')) target += range;
    if (k.has('d') || k.has('arrowright')) target -= range;
    const rate = target === 0 ? 700 : 420;
    this.steer += clamp(target - this.steer, -rate * dt, rate * dt);
    const thrOn = k.has('w') || k.has('arrowup');
    const brkOn = k.has('s') || k.has('arrowdown');
    this.throttle = clamp(this.throttle + (thrOn ? 2.5 : -5) * dt, 0, 1);
    this.brake = clamp(this.brake + (brkOn ? 3 : -6) * dt, 0, 1);
    this.handbrake = k.has(' ') ? 1 : 0;

    // 手柄 / 方向盘
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const ax = gp.axes[0] ?? 0;
      const rt = gp.buttons[7]?.value ?? 0;
      const lt = gp.buttons[6]?.value ?? 0;
      if (Math.abs(ax) > 0.06) this.steer = -Math.sign(ax) * (Math.abs(ax) - 0.06) / 0.94 * range;
      if (rt > 0.02) this.throttle = rt;
      if (lt > 0.02) this.brake = lt;
      if (gp.buttons[0]?.pressed) this.handbrake = 1;
      break;
    }
    return { steer: this.steer, throttle: this.throttle, brake: this.brake, handbrake: this.handbrake };
  }

  private loop(ts: number) {
    requestAnimationFrame((t) => this.loop(t));
    if (!this.visible) return;
    const dt = this.last ? Math.min(0.05, (ts - this.last) / 1000) : 0;
    this.last = ts;
    if (this.paused || dt === 0) return;
    const inp = this.readInput(dt);
    this.acc += dt;
    const ctx: DriverContext = { station: 0, pathError: 0, targetSpeed: NaN };
    let steps = 0;
    while (this.acc >= SIM_DT && steps < 200) {
      this.veh.step(SIM_DT, inp);
      this.acc -= SIM_DT;
      steps++;
      if (this.recording && this.rec && Math.round((this.veh.t - this.recT0) / SIM_DT) % 20 === 0) {
        this.rec.t.push(this.veh.t - this.recT0);
        CHANNELS.forEach((c, i) => this.rec!.ch[i].push(c.get(this.veh, ctx)));
      }
    }
    if (!Number.isFinite(this.veh.u) || Math.abs(this.veh.phi) > 1.2) {
      toast('车辆失稳/侧翻，已重置', 'error');
      this.resetVehicle(false);
      return;
    }
    const v = this.veh;
    this.animator.setFrames([frameFromVehicle(v)]);
    this.trailTimer += dt;
    if (this.trailTimer > 0.05) { this.trailTimer = 0; this.animator.pushTrail(v.X, v.Y); }
    this.hud.update({
      t: this.recording ? v.t - this.recT0 : undefined,
      speed: v.u * 3.6, gear: v.pt.gear, rpm: v.pt.engineRpm, sw: v.steerSW,
      ax: v.ax / 9.80665, ay: v.ay / 9.80665, r: v.r * RAD, beta: v.beta * RAD, roll: v.phi * RAD,
      throttle: v.throttle, brake: Math.max(v.brake, this.handbrake), abs: v.absActive.some((a) => a), esc: v.escActive, tcs: v.tcsActive,
    });
    this.drawGG(v.ay / 9.80665, v.ax / 9.80665);
    this.stripTimer += dt;
    if (this.stripTimer > 0.05) {
      this.stripTimer = 0;
      this.stripT.push(v.t);
      const vals: Record<string, number> = { Vx: v.u * 3.6, Ay: v.ay / 9.80665, AVz: v.r * RAD, Beta: v.beta * RAD };
      for (const s of this.strip) s.data.push(vals[s.key]);
      while (this.stripT.length && this.stripT[0] < v.t - 15) {
        this.stripT.shift();
        for (const s of this.strip) s.data.shift();
      }
      for (const s of this.strip) s.plot.setData({ series: [{ x: this.stripT, y: s.data, color: s.color, label: s.label }], xLabel: '时间 (s)', yLabel: '', xIsTime: true });
    }
  }

  private drawGG(ay: number, ax: number) {
    const c = this.ggCanvas;
    const g = c.getContext('2d')!;
    const S = c.width, R = S / 2 - 10, cx = S / 2, cy = S / 2;
    const sc = R / 1.2;
    g.clearRect(0, 0, S, S);
    const dark = document.documentElement.dataset.theme === 'dark';
    g.fillStyle = dark ? '#1c1c1e' : '#ffffff';
    g.beginPath(); g.arc(cx, cy, R + 8, 0, Math.PI * 2); g.fill();
    g.strokeStyle = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)';
    g.lineWidth = 1;
    for (const r of [0.4, 0.8, 1.2]) { g.beginPath(); g.arc(cx, cy, r * sc, 0, Math.PI * 2); g.stroke(); }
    g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
    this.ggTrail.push([ay, ax]);
    if (this.ggTrail.length > 90) this.ggTrail.shift();
    g.fillStyle = dark ? 'rgba(10,132,255,0.35)' : 'rgba(0,113,227,0.25)';
    for (const [a, b] of this.ggTrail) { g.beginPath(); g.arc(cx - a * sc, cy - b * sc, 1.6, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = dark ? '#0a84ff' : '#0071e3';
    g.beginPath(); g.arc(cx - ay * sc, cy - ax * sc, 5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = dark ? '#1c1c1e' : '#fff';
    g.lineWidth = 1.5;
    g.stroke();
    const font = '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
    g.fillStyle = '#86868b';
    g.font = `600 9px ${font}`;
    g.fillText('G-G', 10, 16);
    g.fillStyle = dark ? '#f5f5f7' : '#1d1d1f';
    g.font = `600 11px ${font}`;
    g.fillText(`${Math.hypot(ax, ay).toFixed(2)} g`, S - 50, 16);
  }

  private toggleRecord() {
    if (this.recording) this.stopRecord(true);
    else {
      this.recording = true;
      this.recT0 = this.veh.t;
      this.rec = { t: [], ch: CHANNELS.map(() => []) };
      this.recBtn.textContent = '停止并保存';
      this.recBtn.classList.remove('btn-primary');
      this.recBtn.classList.add('rec-on');
    }
  }

  private stopRecord(save: boolean) {
    this.recording = false;
    this.recBtn.textContent = '开始记录';
    this.recBtn.classList.remove('rec-on');
    this.recBtn.classList.add('btn-primary');
    const rec = this.rec;
    this.rec = null;
    if (!save || !rec || rec.t.length < 10) {
      if (save) toast('记录时间太短，未保存', 'error');
      return;
    }
    const n = rec.t.length;
    const ch: Record<string, Float32Array> = {};
    CHANNELS.forEach((c, i) => (ch[c.key] = Float32Array.from(rec.ch[i])));
    const t = Float32Array.from(rec.t);
    const vp = cloneVehicle(this.veh.p);
    const result: SimResult = {
      id: `rt-${Date.now().toString(36)}`,
      name: `#驾驶 ${this.scene.name}`,
      color: '#ff7a45',
      vehicle: vp,
      procedureId: 'realtime-' + this.scene.id,
      procedureName: '实时驾驶 · ' + this.scene.name,
      params: {},
      t, ch, n,
      dtOut: SIM_DT * 20,
      kpis: [],
      plots: [
        { title: '行驶轨迹', x: 'X', y: ['Y'], showPath: true, showCones: true, equalAxes: true },
        { title: '车速', y: ['Vx'] },
        { title: '方向盘转角', y: ['Steer_SW'] },
        { title: 'g-g 图', x: 'Ay', y: ['Ax'], equalAxes: true },
        { title: '横摆角速度', y: ['AVz'] },
        { title: '油门 / 制动', y: ['Throttle', 'BrakePedal'] },
      ],
      scene: this.sceneDesc(),
      wallMs: 0,
      createdAt: Date.now(),
      warnings: [],
    };
    const dist = (() => {
      let s = 0;
      for (let i = 1; i < n; i++) s += Math.hypot(ch.X[i] - ch.X[i - 1], ch.Y[i] - ch.Y[i - 1]);
      return s;
    })();
    result.kpis = [
      { label: '记录时长', value: t[n - 1], unit: 's', decimals: 2 },
      { label: '行驶距离', value: dist, unit: 'm', decimals: 1 },
      { label: '最高车速', value: maxIn(t, ch.Vx).value, unit: 'km/h', decimals: 1 },
      { label: '最大侧向加速度', value: Math.abs(maxAbsIn(t, ch.Ay).value), unit: 'g', decimals: 3 },
      { label: '最大纵向减速度', value: -Math.min(0, ...Array.from(ch.Ax)), unit: 'g', decimals: 3 },
      { label: '最大质心侧偏角', value: Math.abs(maxAbsIn(t, ch.Beta).value), unit: 'deg', decimals: 2 },
    ];
    this.onSaveRun?.(result);
    toast('已保存为仿真结果，可在"试验仿真"页查看');
  }
}
