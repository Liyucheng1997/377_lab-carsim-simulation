// 仿真试验工作区：工况设置 → 运行 → 动画回放 / 曲线 / 指标 / 多次结果对比
import type { SimResult, PlotSpec, Procedure } from '../core/types';
import { PROCEDURES, PROCEDURE_MAP, defaultParams } from '../core/procedures';
import { runSimulation, resultToCSV } from '../core/simulator';
import { CHANNELS, CHANNEL_MAP, channelLabel } from '../core/channels';
import { h, clear, fmt, download, toast, secHead } from './dom';
import { icon } from './icons';
import { computeDerived } from '../core/params';
import { Animator, CAMERA_MODES } from './animator';
import { Plot, type Series, type Marker } from './plot';
import { Hud } from './hud';
import { frameAt, chAt } from './frames';
import type { VehicleStore } from './store';
import type { CarFrame } from './carModel';

// 数据配色：主题蓝打头，其余为沉稳纯色（只用于区分曲线 / 结果，不做界面装饰）
const RUN_COLORS = ['#0071e3', '#c93400', '#248a3d', '#6e6e73', '#5e5ce6', '#0a9396', '#a2845e', '#1d1d1f'];
const SERIES_COLORS = ['#0071e3', '#c93400', '#248a3d', '#6e6e73', '#5e5ce6', '#0a9396'];
const DASHES: (number[] | undefined)[] = [undefined, [6, 3], [2, 3], [8, 3, 2, 3]];
const PARAMS_KEY = 'vdlab.procParams';
const PROC_KEY = 'vdlab.procedure';

export class Workspace {
  readonly el: HTMLDivElement;
  private animator: Animator;
  private hud: Hud;
  private plots: Plot[] = [];
  private plotSpecs: PlotSpec[] = [];
  private plotGrid: HTMLDivElement;
  private runs: SimResult[] = [];
  private activeId: string | null = null;
  private compare = new Set<string>();
  private t = 0;
  private playing = false;
  private speed = 1;
  private loop = false;
  private procId = 'dlc';
  private procParams: Record<string, Record<string, any>> = {};
  private colorIdx = 0;
  private lastFrame = 0;
  private visible = true;
  // DOM refs
  private procList!: HTMLDivElement;
  private paramBox!: HTMLDivElement;
  private procInfo!: HTMLDivElement;
  private vehSelect!: HTMLSelectElement;
  private runBtn!: HTMLButtonElement;
  private slider!: HTMLInputElement;
  private timeLbl!: HTMLSpanElement;
  private playBtn!: HTMLButtonElement;
  private kpiBox!: HTMLDivElement;
  private runList!: HTMLDivElement;
  private camBtns: Record<string, HTMLButtonElement> = {};
  private emptyMsg!: HTMLDivElement;
  private vehMeta!: HTMLDivElement;

  constructor(private store: VehicleStore) {
    try {
      const raw = localStorage.getItem(PARAMS_KEY);
      if (raw) this.procParams = JSON.parse(raw);
      const pid = localStorage.getItem(PROC_KEY);
      if (pid && PROCEDURE_MAP[pid]) this.procId = pid;
    } catch { /* ignore */ }

    // ---------------- 左侧：车辆与工况 ----------------
    this.vehSelect = h('select', { class: 'veh-select', onchange: (e: Event) => store.select((e.target as HTMLSelectElement).value) });
    this.procList = h('div', { class: 'proc-list' });
    this.paramBox = h('div', { class: 'param-box' });
    this.procInfo = h('div', { class: 'proc-info' });
    this.runBtn = h('button', { class: 'btn btn-primary run-btn', onclick: () => this.run() });
    this.setRunLabel(false);
    this.vehMeta = h('div', { class: 'veh-meta' });
    const left = h('aside', { class: 'panel left' },
      h('div', { class: 'card' }, secHead('Vehicle', '车辆模型'), this.vehSelect, this.vehMeta),
      h('div', { class: 'card grow' }, secHead('Procedure', '试验工况'), this.procList),
      h('div', { class: 'card' }, secHead('Setup', '工况参数'), this.procInfo, this.paramBox),
      h('div', { class: 'card run-card' }, this.runBtn,
        h('div', { class: 'hint', style: { textAlign: 'center', marginTop: '8px' } }, 'Ctrl + Enter 运行 · 空格 播放 / 暂停')),
    );

    // ---------------- 中部：动画 + 曲线 ----------------
    const animBox = h('div', { class: 'anim-box' });
    this.animator = new Animator(animBox);
    this.hud = new Hud(animBox);
    this.emptyMsg = h('div', { class: 'anim-empty' }, '选择车辆与试验工况，点击「运行仿真」开始');
    animBox.appendChild(this.emptyMsg);
    const camBar = h('div', { class: 'cam-bar seg' });
    for (const m of CAMERA_MODES) {
      const b = h('button', { onclick: () => this.animator.setCameraMode(m.id) }, m.label);
      this.camBtns[m.id] = b;
      camBar.appendChild(b);
    }
    const forceBtn = h('button', {
      class: 'force', title: '显示轮胎力矢量（蓝：水平力，绿：垂向力）',
      onclick: () => { this.animator.showForces = !this.animator.showForces; forceBtn.classList.toggle('active', this.animator.showForces); this.renderFrame(); },
    }, '受力');
    camBar.appendChild(forceBtn);
    animBox.appendChild(camBar);
    this.animator.el.addEventListener('cameramode', (e) => {
      const m = (e as CustomEvent).detail;
      for (const [k, b] of Object.entries(this.camBtns)) b.classList.toggle('active', k === m);
      this.renderFrame();
    });
    this.camBtns.chase.classList.add('active');

    this.playBtn = h('button', { class: 'icon-btn play', title: '播放/暂停', onclick: () => this.togglePlay() }, icon('play', 15));
    this.slider = h('input', {
      type: 'range', min: 0, max: 1, step: 0.01, value: 0, class: 'timeline',
      oninput: (e: Event) => { this.t = parseFloat((e.target as HTMLInputElement).value); this.renderFrame(); },
    });
    this.timeLbl = h('span', { class: 'time-lbl' }, '0.00 / 0.00 s');
    const speedSel = h('select', { class: 'speed-sel', onchange: (e: Event) => (this.speed = parseFloat((e.target as HTMLSelectElement).value)) },
      [0.1, 0.25, 0.5, 1, 2, 4].map((s) => h('option', { value: s, selected: s === 1 }, `${s}×`)));
    const loopChk = h('label', { class: 'chk' }, h('input', { type: 'checkbox', onchange: (e: Event) => (this.loop = (e.target as HTMLInputElement).checked) }), '循环');
    const playbar = h('div', { class: 'playbar' },
      h('button', { class: 'icon-btn', title: '回到开始', onclick: () => { this.t = 0; this.renderFrame(); } }, icon('skip-back', 15)),
      this.playBtn,
      h('button', { class: 'icon-btn', title: '跳到结束', onclick: () => { this.t = this.tEnd; this.renderFrame(); } }, icon('skip-forward', 15)),
      this.slider, this.timeLbl, speedSel, loopChk,
    );
    this.plotGrid = h('div', { class: 'plot-grid' });
    const center = h('main', { class: 'center' }, animBox, playbar, this.plotGrid);

    // ---------------- 右侧：指标与结果 ----------------
    this.kpiBox = h('div', { class: 'kpi-box' });
    this.runList = h('div', { class: 'run-list' });
    const right = h('aside', { class: 'panel right' },
      h('div', { class: 'card' }, secHead('Metrics', '评价指标'), this.kpiBox),
      h('div', { class: 'card grow' },
        secHead('Runs', '仿真结果', h('button', { class: 'link', onclick: () => this.clearRuns() }, '清空')),
        this.runList,
        h('div', { class: 'hint' }, '勾选「对比」可叠加曲线与指标，并在动画中显示半透明对比车。')),
    );

    this.el = h('div', { class: 'view workspace' }, left, center, right);

    store.onChange(() => { this.renderVehSelect(); this.previewScene(); });
    this.renderVehSelect();
    this.renderProcList();
    this.renderParams();
    this.buildPlots(PROCEDURE_MAP[this.procId].setup(this.params(), store.selected).plots);
    this.previewScene();
    this.renderRuns();
    this.animator.start();

    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      const tag = (e.target as HTMLElement).tagName;
      if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); this.run(); }
      else if (e.key === ' ' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA' && tag !== 'BUTTON') { e.preventDefault(); this.togglePlay(); }
    });
    requestAnimationFrame((ts) => this.tick(ts));
  }

  /** 外部（实时驾驶）保存的结果 */
  addRun(r: SimResult) {
    r.color = RUN_COLORS[this.colorIdx++ % RUN_COLORS.length];
    const num = this.runs.length ? Math.max(...this.runs.map((x) => parseInt(x.name.match(/^#(\d+)/)?.[1] ?? '0'))) + 1 : 1;
    r.name = r.name.replace(/^#\S*/, `#${num}`);
    this.runs.unshift(r);
    this.t = 0;
    this.setActive(r.id);
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.animator.active = v;
    if (v) this.animator.resize();
  }

  // ---------------------------------------------------------------------------
  private get active(): SimResult | null {
    return this.runs.find((r) => r.id === this.activeId) ?? null;
  }
  private get tEnd(): number {
    const r = this.active;
    return r && r.n ? r.t[r.n - 1] : 0;
  }
  private get proc(): Procedure {
    return PROCEDURE_MAP[this.procId];
  }
  private params(): Record<string, any> {
    const p = this.proc;
    return { ...defaultParams(p), ...(this.procParams[p.id] ?? {}) };
  }

  private renderVehSelect() {
    clear(this.vehSelect);
    for (const v of this.store.list) this.vehSelect.appendChild(h('option', { value: v.id, selected: v.id === this.store.selectedId }, (v.builtin ? '★ ' : '') + v.name));
    const v = this.store.selected;
    clear(this.vehMeta);
    try {
      const d = computeDerived(v);
      const pill = (label: string, val: string) => h('span', { class: 'pill' }, label, h('b', null, val));
      this.vehMeta.append(
        pill('', v.powertrain.driveType),
        pill('质量 ', `${d.totalMass.toFixed(0)} kg`),
        pill('功率 ', `${d.peakPowerKw.toFixed(0)} kW`),
        pill('不足转向 ', `${d.understeerGradient.toFixed(1)}°/g`),
      );
    } catch { /* 参数不完整时忽略 */ }
  }

  private setRunLabel(busy: boolean) {
    clear(this.runBtn);
    if (!busy) this.runBtn.append(icon('play', 14));
    this.runBtn.append(busy ? '仿真计算中…' : '运行仿真');
  }

  private setPlayIcon(playing: boolean) {
    this.playBtn.replaceChildren(icon(playing ? 'pause' : 'play', 15));
  }

  private renderProcList() {
    clear(this.procList);
    const cats = [...new Set(PROCEDURES.map((p) => p.category))];
    for (const c of cats) {
      this.procList.appendChild(h('div', { class: 'proc-cat' }, c));
      for (const p of PROCEDURES.filter((x) => x.category === c)) {
        this.procList.appendChild(h('button', {
          class: 'proc-item' + (p.id === this.procId ? ' active' : ''),
          title: p.description,
          onclick: () => {
            this.procId = p.id;
            try { localStorage.setItem(PROC_KEY, p.id); } catch { /* ignore */ }
            this.renderProcList();
            this.renderParams();
            if (!this.active || this.active.procedureId !== p.id) this.buildPlots(p.setup(this.params(), this.store.selected).plots);
            this.previewScene();
          },
        }, h('span', { class: 'proc-name' }, p.name), h('span', { class: 'proc-std' }, p.standard)));
      }
    }
  }

  private renderParams() {
    const p = this.proc;
    clear(this.paramBox);
    this.procInfo.textContent = p.description;
    const vals = this.params();
    const save = () => {
      try { localStorage.setItem(PARAMS_KEY, JSON.stringify(this.procParams)); } catch { /* ignore */ }
    };
    for (const d of p.params) {
      const set = (v: any) => {
        this.procParams[p.id] = { ...(this.procParams[p.id] ?? {}), [d.key]: v };
        save();
      };
      let ctrl: HTMLElement;
      if (d.type === 'select') {
        ctrl = h('select', { onchange: (e: Event) => { set((e.target as HTMLSelectElement).value); this.previewScene(); } },
          (d.options ?? []).map((o) => h('option', { value: o.value, selected: o.value === vals[d.key] }, o.label)));
      } else {
        ctrl = h('input', {
          type: 'number', value: String(vals[d.key]), step: d.step ?? 'any', min: d.min, max: d.max,
          onchange: (e: Event) => {
            const el = e.target as HTMLInputElement;
            let x = parseFloat(el.value);
            if (!Number.isFinite(x)) { el.value = String(vals[d.key]); return; }
            if (d.min !== undefined) x = Math.max(d.min, x);
            if (d.max !== undefined) x = Math.min(d.max, x);
            el.value = String(x);
            set(x);
            this.previewScene();
          },
        });
      }
      this.paramBox.appendChild(h('div', { class: 'p-row', title: d.help ?? '' },
        h('label', null, d.label, d.help ? h('span', { class: 'help' }, ' ⓘ') : null), ctrl, h('span', { class: 'unit' }, d.unit ?? '')));
    }
    this.paramBox.appendChild(h('button', {
      class: 'link', style: { alignSelf: 'flex-start', marginTop: '2px' }, onclick: () => { delete this.procParams[p.id]; save(); this.renderParams(); this.previewScene(); },
    }, '恢复默认参数'));
  }

  /** 未运行时在动画中预览工况场景与车辆初始位置 */
  private previewScene() {
    if (this.active && this.active.procedureId === this.procId && this.active.vehicle.id === this.store.selectedId) return;
    if (this.active) return; // 已有结果时保持显示结果
    try {
      const vp = this.store.selected;
      const setup = this.proc.setup(this.params(), vp);
      this.animator.setScene({ road: setup.road, path: setup.path ? { x: Array.from(setup.path.xs), y: Array.from(setup.path.ys), closed: setup.path.closed } : undefined, ribbonWidth: setup.ribbonWidth, cones: setup.cones });
      this.animator.setVehicles([{ id: 'preview-' + vp.id + JSON.stringify(vp).length, vp }]);
      this.animator.clearTrail();
      const z = [0, 0, 0, 0];
      this.animator.setFrames([{ X: setup.init.x, Y: setup.init.y, yaw: setup.init.yaw, zs: 0, roll: 0, pitch: 0, zu: z, steer: z, spin: z, fx: z, fy: z, fz: [4000, 4000, 4000, 4000] }]);
    } catch (e) {
      console.error(e);
    }
  }

  // ---------------------------------------------------------------------------
  private run() {
    if (this.runBtn.disabled) return;
    this.runBtn.disabled = true;
    this.setRunLabel(true);
    setTimeout(() => {
      try {
        const vp = this.store.selected;
        const p = this.proc;
        const color = RUN_COLORS[this.colorIdx++ % RUN_COLORS.length];
        const num = this.runs.length ? Math.max(...this.runs.map((r) => parseInt(r.name.match(/^#(\d+)/)?.[1] ?? '0'))) + 1 : 1;
        const r = runSimulation(vp, p, this.params(), { name: `#${num} ${p.name}`, color });
        this.runs.unshift(r);
        if (this.runs.length > 30) {
          const drop = this.runs.filter((x) => !this.compare.has(x.id)).pop();
          if (drop) this.runs = this.runs.filter((x) => x !== drop);
        }
        this.setActive(r.id);
        this.t = 0;
        this.playing = true;
        this.setPlayIcon(true);
        for (const w of r.warnings) toast(w, 'error');
        toast(`仿真完成：${r.n} 个采样点，仿真时长 ${r.t[r.n - 1].toFixed(2)} s，计算耗时 ${r.wallMs.toFixed(0)} ms`);
      } catch (e) {
        console.error(e);
        toast('仿真失败：' + (e as Error).message, 'error');
      } finally {
        this.runBtn.disabled = false;
        this.setRunLabel(false);
      }
    }, 30);
  }

  private setActive(id: string) {
    const prev = this.active;
    this.activeId = id;
    const r = this.active!;
    this.compare.delete(id);
    this.emptyMsg.style.display = 'none';
    this.animator.setScene(r.scene);
    if (!prev || prev.procedureId !== r.procedureId) this.buildPlots(r.plots);
    this.slider.max = String(this.tEnd);
    this.slider.step = String(r.dtOut);
    this.t = Math.min(this.t, this.tEnd);
    this.updateVehicles();
    this.animator.setTrail(r.ch.X, r.ch.Y, r.n);
    this.renderRuns();
    this.renderKpis();
    this.updatePlots();
    this.renderFrame();
  }

  private comparedRuns(): SimResult[] {
    return this.runs.filter((r) => this.compare.has(r.id) && r.id !== this.activeId);
  }

  private updateVehicles() {
    const r = this.active;
    if (!r) return;
    const ghosts = this.comparedRuns().filter((c) => c.procedureId === r.procedureId);
    this.animator.setVehicles([
      { id: r.id, vp: r.vehicle },
      ...ghosts.map((g) => ({ id: g.id, vp: g.vehicle, ghost: true, color: g.color })),
    ]);
  }

  private renderRuns() {
    clear(this.runList);
    if (!this.runs.length) {
      this.runList.appendChild(h('div', { class: 'empty' }, '还没有仿真结果'));
      return;
    }
    for (const r of this.runs) {
      const isActive = r.id === this.activeId;
      const item = h('div', { class: 'run-item' + (isActive ? ' active' : ''), onclick: () => this.setActive(r.id) },
        h('span', { class: 'swatch', style: { background: r.color } }),
        h('div', { class: 'run-meta' },
          h('div', { class: 'run-name' }, h('span', { class: 'no' }, r.name.split(' ')[0]), r.name.split(' ').slice(1).join(' ')),
          h('div', { class: 'run-sub' }, `${r.vehicle.name} · ${new Date(r.createdAt).toLocaleTimeString()}`)),
        h('div', { class: 'run-actions' },
          isActive ? h('span', { class: 'badge' }, '当前') : h('label', { class: 'chk', onclick: (e: Event) => e.stopPropagation() },
            h('input', {
              type: 'checkbox', checked: this.compare.has(r.id),
              onchange: (e: Event) => {
                if ((e.target as HTMLInputElement).checked) this.compare.add(r.id); else this.compare.delete(r.id);
                this.updateVehicles(); this.updatePlots(); this.renderKpis(); this.renderFrame();
              },
            }), '对比'),
          h('button', { class: 'link', title: '导出 CSV', onclick: (e: Event) => { e.stopPropagation(); download(`${r.name}.csv`, resultToCSV(r), 'text/csv'); } }, 'CSV'),
          h('button', { class: 'link muted', title: '删除', onclick: (e: Event) => { e.stopPropagation(); this.removeRun(r.id); } }, icon('x', 13)),
        ));
      this.runList.appendChild(item);
    }
  }

  private removeRun(id: string) {
    this.runs = this.runs.filter((r) => r.id !== id);
    this.compare.delete(id);
    if (this.activeId === id) {
      this.activeId = null;
      if (this.runs.length) this.setActive(this.runs[0].id);
      else this.reset();
    } else {
      this.updateVehicles(); this.updatePlots(); this.renderKpis(); this.renderRuns();
    }
  }

  private clearRuns() {
    this.runs = [];
    this.compare.clear();
    this.activeId = null;
    this.reset();
  }

  private reset() {
    this.playing = false;
    this.setPlayIcon(false);
    this.emptyMsg.style.display = '';
    this.animator.clearTrail();
    this.renderRuns();
    this.renderKpis();
    this.updatePlots();
    this.previewScene();
  }

  private renderKpis() {
    clear(this.kpiBox);
    const r = this.active;
    if (!r) {
      this.kpiBox.appendChild(h('div', { class: 'empty' }, '运行仿真后，这里按标准给出评价指标'));
      return;
    }
    const cols = [r, ...this.comparedRuns().filter((c) => c.procedureId === r.procedureId)];
    const head = h('tr', null, h('th', null, '指标'), cols.map((c) => h('th', null, h('span', { class: 'swatch sm', style: { background: c.color } }), c.name.split(' ')[0])));
    const body = r.kpis.map((k, i) => h('tr', null,
      h('td', { title: k.note ?? '' }, k.label, k.unit ? h('span', { class: 'unit' }, ` ${k.unit}`) : null),
      cols.map((c) => {
        const kk = c.kpis[i];
        if (!kk) return h('td', null, '—');
        return h('td', { class: 'num', title: kk.note ?? '' }, fmt(kk.value, kk.decimals ?? 2),
          kk.pass === true ? h('span', { class: 'verdict pass' }, '通过') : kk.pass === false ? h('span', { class: 'verdict fail' }, '未通过') : null);
      })));
    this.kpiBox.appendChild(h('h3', { class: 'kpi-title' }, r.procedureName, h('small', null, r.vehicle.name)));
    this.kpiBox.appendChild(h('table', { class: 'kpi' }, h('thead', null, head), h('tbody', null, body)));
    if (r.warnings.length) this.kpiBox.appendChild(h('div', { class: 'warn' }, r.warnings.join(' ')));
    this.kpiBox.appendChild(h('div', { class: 'meta-line' }, `计算耗时 ${r.wallMs.toFixed(0)} ms · 积分步长 0.5 ms · 输出 ${Math.round(1 / r.dtOut)} Hz`));
  }

  // ---------------------------------------------------------------------------
  private buildPlots(specs: PlotSpec[]) {
    this.plotSpecs = specs.map((s) => ({ ...s, y: [...s.y] }));
    clear(this.plotGrid);
    this.plots = [];
    this.plotSpecs.forEach((spec, idx) => {
      const title = h('span', { class: 'plot-title' }, spec.title);
      const editBox = h('div', { class: 'plot-edit' });
      const card = h('div', { class: 'plot-card' },
        h('div', { class: 'plot-head' }, title,
          h('button', { class: 'icon-btn', title: '更改通道', onclick: () => { editBox.classList.toggle('open'); if (editBox.classList.contains('open')) this.renderPlotEditor(editBox, idx, title); } }, icon('sliders', 14)),
        ), editBox);
      this.plotGrid.appendChild(card);
      const p = new Plot(card);
      p.onSeek = (x) => { this.t = Math.max(0, Math.min(this.tEnd, x)); this.renderFrame(); };
      this.plots.push(p);
    });
    this.updatePlots();
  }

  private renderPlotEditor(box: HTMLDivElement, idx: number, title: HTMLElement) {
    clear(box);
    const spec = this.plotSpecs[idx];
    const groups = [...new Set(CHANNELS.filter((c) => !c.hidden).map((c) => c.group))];
    const chSelect = (value: string, allowNone: boolean, withTime: boolean, onChange: (v: string) => void) =>
      h('select', { onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
        allowNone ? h('option', { value: '' }, '（无）') : null,
        withTime ? h('option', { value: 't', selected: value === 't' }, '时间 t (s)') : null,
        groups.map((g) => h('optgroup', { label: g },
          CHANNELS.filter((c) => c.group === g && !c.hidden).map((c) => h('option', { value: c.key, selected: c.key === value }, `${c.label} (${c.unit})`)))));
    const apply = () => {
      spec.title = spec.y.map((k) => CHANNEL_MAP[k]?.label ?? k).join(' / ') + (spec.x && spec.x !== 't' ? ` – ${CHANNEL_MAP[spec.x]?.label ?? spec.x}` : '');
      title.textContent = spec.title;
      spec.showCones = spec.showPath = spec.x === 'X' && spec.y.includes('Y');
      spec.equalAxes = spec.showCones;
      this.updatePlots();
    };
    box.appendChild(h('div', { class: 'pe-line' }, h('label', null, 'X 轴'), chSelect(spec.x ?? 't', false, true, (v) => { spec.x = v === 't' ? undefined : v; apply(); })));
    for (let k = 0; k < 4; k++) {
      box.appendChild(h('div', { class: 'pe-line' }, h('label', null, `Y${k + 1}`),
        chSelect(spec.y[k] ?? '', k > 0, false, (v) => {
          const ys = [...spec.y];
          if (v) ys[k] = v; else ys.splice(k, 1);
          spec.y = ys.filter(Boolean);
          if (!spec.y.length) spec.y = ['Vx'];
          apply();
          this.renderPlotEditor(box, idx, title);
        })));
    }
    box.appendChild(h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '8px' } }, h('button', { class: 'btn btn-primary btn-sm', onclick: () => box.classList.remove('open') }, '完成')));
  }

  private updatePlots() {
    const r = this.active;
    const runs = r ? [r, ...this.comparedRuns()] : [];
    this.plotSpecs.forEach((spec, idx) => {
      const p = this.plots[idx];
      const series: Series[] = [];
      const multi = runs.length > 1;
      runs.forEach((run) => {
        spec.y.forEach((key, k) => {
          const y = run.ch[key];
          const x = spec.x ? run.ch[spec.x] : run.t;
          if (!y || !x) return;
          const lbl = CHANNEL_MAP[key]?.label ?? key;
          series.push({
            x, y, n: run.n,
            color: multi ? run.color : SERIES_COLORS[k % SERIES_COLORS.length],
            label: multi ? `${run.name.split(' ')[0]} ${spec.y.length > 1 ? lbl : ''}`.trim() : lbl,
            dash: multi ? DASHES[k % DASHES.length] : undefined,
          });
        });
      });
      const markers: Marker[] = spec.showCones && r?.scene.cones ? r.scene.cones.map((c) => ({ x: c.x, y: c.y, color: '#c93400' })) : [];
      const refLines = spec.showPath && r?.scene.path ? [{ x: r.scene.path.x, y: r.scene.path.y, color: '#aeaeb2', dash: [4, 4] }] : [];
      const units = [...new Set(spec.y.map((k) => CHANNEL_MAP[k]?.unit ?? ''))].join(', ');
      p.setData({
        series, markers, refLines,
        xLabel: spec.x ? channelLabel(spec.x) : '时间 (s)',
        yLabel: units,
        equal: spec.equalAxes,
        xIsTime: !spec.x,
      }, true);
    });
  }

  private togglePlay() {
    if (!this.active) return;
    if (!this.playing && this.t >= this.tEnd - 1e-6) this.t = 0;
    this.playing = !this.playing;
    this.setPlayIcon(this.playing);
  }

  private tick(ts: number) {
    requestAnimationFrame((t) => this.tick(t));
    const dt = this.lastFrame ? Math.min(0.1, (ts - this.lastFrame) / 1000) : 0;
    this.lastFrame = ts;
    if (!this.visible || !this.active) return;
    if (this.playing) {
      this.t += dt * this.speed;
      if (this.t >= this.tEnd) {
        if (this.loop) this.t = 0;
        else { this.t = this.tEnd; this.playing = false; this.setPlayIcon(false); }
      }
      this.renderFrame();
    }
  }

  private renderFrame() {
    const r = this.active;
    if (!r) return;
    const t = this.t;
    const frames: CarFrame[] = [frameAt(r, t)];
    const ghosts = this.comparedRuns().filter((c) => c.procedureId === r.procedureId);
    for (const g of ghosts) frames.push(frameAt(g, Math.min(t, g.t[g.n - 1])));
    this.animator.setFrames(frames);
    const c = (k: string) => chAt(r, k, t);
    this.hud.update({
      t, speed: c('Vx'), gear: Math.round(c('Gear')), rpm: c('EngineRpm'), sw: c('Steer_SW'),
      ax: c('Ax'), ay: c('Ay'), r: c('AVz'), beta: c('Beta'), roll: c('Roll'),
      throttle: c('Throttle') / 100, brake: c('BrakePedal') / 100,
      abs: c('ABS') > 0.5, esc: c('ESC') > 0.5, tcs: c('TCS') > 0.5,
    });
    this.slider.value = String(t);
    this.timeLbl.textContent = `${t.toFixed(2)} / ${this.tEnd.toFixed(2)} s`;
    // 曲线游标
    const runs = [r, ...this.comparedRuns()];
    this.plotSpecs.forEach((spec, idx) => {
      const live: Marker[] = [];
      if (spec.x) {
        for (const run of runs) {
          const tt = Math.min(t, run.t[run.n - 1]);
          const x = chAt(run, spec.x, tt);
          for (const yk of spec.y) {
            const isTraj = spec.x === 'X' && yk === 'Y';
            live.push({ x, y: chAt(run, yk, tt), color: run.color, shape: isTraj ? 'car' : 'dot', heading: isTraj ? chAt(run, 'Yaw', tt) * Math.PI / 180 : 0 });
          }
        }
      }
      this.plots[idx].setCursor(spec.x ? null : t, live);
    });
  }
}
