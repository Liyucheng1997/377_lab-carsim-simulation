// 车辆参数编辑界面（类似 CarSim 的数据集界面）
import type { VehicleParams, TireParams, AxleSuspension } from '../core/params';
import { computeDerived } from '../core/params';
import { TireModel } from '../core/tire';
import { PowertrainModel } from '../core/powertrain';
import { h, clear, fmt, download, toast, secHead } from './dom';
import { icon } from './icons';
import { Plot, type Series } from './plot';
import type { VehicleStore } from './store';

interface Field {
  key: string;
  label: string;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  type?: 'number' | 'text' | 'select' | 'bool' | 'color' | 'array' | 'textarea';
  options?: { value: string; label: string }[];
  help?: string;
}

interface Section {
  id: string;
  title: string;
  en: string;
  icon: string;
  obj: (v: VehicleParams) => any;
  groups: { title: string; fields: Field[] }[];
  chart?: 'tire' | 'engine' | 'damper' | 'none';
}

const suspFields = (): { title: string; fields: Field[] }[] => [
  {
    title: '质量与弹性元件',
    fields: [
      { key: 'unsprungMass', label: '非簧载质量（每侧）', unit: 'kg', step: 1 },
      { key: 'springRate', label: '弹簧刚度（轮心）', unit: 'N/m', step: 500 },
      { key: 'arbRate', label: '横向稳定杆刚度（轮心）', unit: 'N/m', step: 500, help: '按左右车轮行程差定义的等效线刚度' },
      { key: 'bumpTravel', label: '压缩行程（至缓冲块）', unit: 'm', step: 0.005 },
      { key: 'reboundTravel', label: '复原行程（至限位）', unit: 'm', step: 0.005 },
      { key: 'bumpStopRate', label: '缓冲块刚度', unit: 'N/m', step: 10000 },
    ],
  },
  {
    title: '减振器',
    fields: [
      { key: 'damperBump', label: '压缩阻尼（低速）', unit: 'N·s/m', step: 100 },
      { key: 'damperRebound', label: '复原阻尼（低速）', unit: 'N·s/m', step: 100 },
      { key: 'damperKnee', label: '阻尼拐点速度', unit: 'm/s', step: 0.01 },
      { key: 'damperHighRatio', label: '高速段阻尼比例', unit: '-', step: 0.05 },
    ],
  },
  {
    title: '运动学与弹性运动学 (K&C)',
    fields: [
      { key: 'rollCenterHeight', label: '侧倾中心高度', unit: 'm', step: 0.01 },
      { key: 'antiPitch', label: '抗点头 / 抗下蹲率', unit: '0–1', step: 0.05 },
      { key: 'camberStatic', label: '静态外倾角', unit: 'deg', step: 0.1 },
      { key: 'camberGain', label: '外倾角随压缩变化', unit: 'deg/m', step: 1 },
      { key: 'toeStatic', label: '静态前束（前束为正）', unit: 'deg', step: 0.05 },
      { key: 'bumpSteer', label: '轮跳转向（前束增加为正）', unit: 'deg/m', step: 0.5 },
      { key: 'complianceSteer', label: '侧向力柔度转向', unit: 'deg/kN', step: 0.01, help: '正值表示不足转向趋势' },
    ],
  },
];

const tireFields = (): { title: string; fields: Field[] }[] => [
  {
    title: '尺寸与垂向特性',
    fields: [
      { key: 'label', label: '轮胎规格', type: 'text' },
      { key: 'unloadedRadius', label: '自由半径', unit: 'm', step: 0.001 },
      { key: 'width', label: '断面宽度', unit: 'm', step: 0.005 },
      { key: 'verticalStiffness', label: '垂向刚度', unit: 'N/m', step: 5000 },
      { key: 'verticalDamping', label: '垂向阻尼', unit: 'N·s/m', step: 10 },
      { key: 'nominalLoad', label: '名义载荷 Fz0', unit: 'N', step: 100 },
    ],
  },
  {
    title: '魔术公式 · 附着与刚度',
    fields: [
      { key: 'muX', label: '纵向峰值附着系数 μx', unit: '-', step: 0.01 },
      { key: 'muY', label: '侧向峰值附着系数 μy', unit: '-', step: 0.01 },
      { key: 'loadSensitivity', label: '附着系数载荷敏感度', unit: '-', step: 0.01 },
      { key: 'kxCoeff', label: '纵滑刚度系数 Kx/Fz', unit: '-', step: 0.5 },
      { key: 'kyCoeff', label: '侧偏刚度系数 Kα/Fz0', unit: '1/rad', step: 0.5 },
      { key: 'camberCoeff', label: '外倾刚度系数 Kγ/Fz', unit: '1/rad', step: 0.05 },
      { key: 'rollingResistance', label: '滚动阻力系数', unit: '-', step: 0.001 },
      { key: 'pneumaticTrail', label: '轮胎拖距', unit: 'm', step: 0.001 },
    ],
  },
  {
    title: '魔术公式 · 曲线形状',
    fields: [
      { key: 'cx', label: '纵向形状因子 Cx', unit: '-', step: 0.05 },
      { key: 'ex', label: '纵向曲率因子 Ex', unit: '-', step: 0.05 },
      { key: 'cy', label: '侧向形状因子 Cy', unit: '-', step: 0.05 },
      { key: 'ey', label: '侧向曲率因子 Ey', unit: '-', step: 0.05 },
      { key: 'combinedX', label: '联合滑移 Bxα', unit: '-', step: 0.5 },
      { key: 'combinedY', label: '联合滑移 Byκ', unit: '-', step: 0.5 },
      { key: 'relaxX', label: '纵向松弛长度', unit: 'm', step: 0.01 },
      { key: 'relaxY', label: '侧向松弛长度', unit: 'm', step: 0.01 },
    ],
  },
];

const SECTIONS: Section[] = [
  {
    id: 'body', title: '车身与质量', en: 'Body', icon: 'car', obj: (v) => v.body, chart: 'none',
    groups: [
      {
        title: '质量与惯量（簧上质量）',
        fields: [
          { key: 'sprungMass', label: '簧上质量', unit: 'kg', step: 10 },
          { key: 'ixx', label: '侧倾转动惯量 Ixx', unit: 'kg·m²', step: 10 },
          { key: 'iyy', label: '俯仰转动惯量 Iyy', unit: 'kg·m²', step: 10 },
          { key: 'izz', label: '横摆转动惯量 Izz', unit: 'kg·m²', step: 10 },
          { key: 'cgHeight', label: '簧上质心高度', unit: 'm', step: 0.01 },
          { key: 'cgToFront', label: '簧上质心至前轴距离', unit: 'm', step: 0.01 },
        ],
      },
      {
        title: '尺寸',
        fields: [
          { key: 'wheelbase', label: '轴距', unit: 'm', step: 0.01 },
          { key: 'trackFront', label: '前轮距', unit: 'm', step: 0.01 },
          { key: 'trackRear', label: '后轮距', unit: 'm', step: 0.01 },
          { key: 'length', label: '车长（动画）', unit: 'm', step: 0.01 },
          { key: 'width', label: '车宽', unit: 'm', step: 0.01 },
          { key: 'height', label: '车高（动画）', unit: 'm', step: 0.01 },
          { key: 'frontOverhang', label: '前悬长度', unit: 'm', step: 0.01 },
        ],
      },
    ],
  },
  { id: 'suspFront', title: '前悬架', en: 'Front suspension', icon: 'spring', obj: (v) => v.suspFront, groups: suspFields(), chart: 'damper' },
  { id: 'suspRear', title: '后悬架', en: 'Rear suspension', icon: 'spring', obj: (v) => v.suspRear, groups: suspFields(), chart: 'damper' },
  { id: 'tireFront', title: '前轮胎', en: 'Front tyre', icon: 'tire', obj: (v) => v.tireFront, groups: tireFields(), chart: 'tire' },
  { id: 'tireRear', title: '后轮胎', en: 'Rear tyre', icon: 'tire', obj: (v) => v.tireRear, groups: tireFields(), chart: 'tire' },
  {
    id: 'powertrain', title: '动力总成', en: 'Powertrain', icon: 'gear', obj: (v) => v.powertrain, chart: 'engine',
    groups: [
      {
        title: '驱动形式',
        fields: [
          { key: 'driveType', label: '驱动形式', type: 'select', options: [{ value: 'FWD', label: '前驱 FWD' }, { value: 'RWD', label: '后驱 RWD' }, { value: 'AWD', label: '四驱 AWD' }] },
          { key: 'frontTorqueSplit', label: 'AWD 前轴扭矩比例', unit: '0–1', step: 0.05 },
          { key: 'lsdCoupling', label: '限滑差速器耦合系数', unit: 'N·m·s/rad', step: 5, help: '0 为开式差速器' },
          { key: 'wheelInertia', label: '车轮转动惯量（每轮）', unit: 'kg·m²', step: 0.05 },
        ],
      },
      {
        title: '发动机',
        fields: [
          { key: 'engineRpm', label: '外特性转速点', unit: 'rpm', type: 'array' },
          { key: 'engineTorque', label: '外特性扭矩', unit: 'N·m', type: 'array' },
          { key: 'idleRpm', label: '怠速', unit: 'rpm', step: 50 },
          { key: 'redlineRpm', label: '断油转速', unit: 'rpm', step: 100 },
          { key: 'engineInertia', label: '曲轴转动惯量', unit: 'kg·m²', step: 0.01 },
          { key: 'frictionTorque0', label: '倒拖扭矩常数项', unit: 'N·m', step: 1 },
          { key: 'frictionTorqueK', label: '倒拖扭矩随转速增量', unit: 'N·m/krpm', step: 0.5 },
        ],
      },
      {
        title: '液力变矩器与变速器',
        fields: [
          { key: 'converterK', label: '变矩器失速 K 因子', unit: 'rpm/√(N·m)', step: 5 },
          { key: 'converterTorqueRatio', label: '失速变矩比', unit: '-', step: 0.1 },
          { key: 'lockupGear', label: '闭锁离合器最低档位', unit: '档', step: 1 },
          { key: 'lockupRpm', label: '闭锁转速', unit: 'rpm', step: 50 },
          { key: 'gearRatios', label: '各档传动比', type: 'array' },
          { key: 'finalDrive', label: '主减速比', unit: '-', step: 0.01 },
          { key: 'efficiency', label: '传动效率', unit: '-', step: 0.01 },
          { key: 'shiftTime', label: '换挡时间', unit: 's', step: 0.05 },
          { key: 'upshiftRpmLight', label: '升档转速（小油门）', unit: 'rpm', step: 100 },
          { key: 'upshiftRpmFull', label: '升档转速（全油门）', unit: 'rpm', step: 100 },
          { key: 'downshiftRpmLight', label: '降档转速（小油门）', unit: 'rpm', step: 100 },
          { key: 'downshiftRpmFull', label: '降档转速（全油门）', unit: 'rpm', step: 100 },
        ],
      },
    ],
  },
  {
    id: 'brakes', title: '制动系统', en: 'Brakes', icon: 'disc', obj: (v) => v.brakes, chart: 'none',
    groups: [{
      title: '液压制动',
      fields: [
        { key: 'maxPressure', label: '踏板全行程主缸压力', unit: 'MPa', step: 0.5 },
        { key: 'frontGain', label: '前轮制动效能（每轮）', unit: 'N·m/MPa', step: 5 },
        { key: 'rearGain', label: '后轮制动效能（每轮）', unit: 'N·m/MPa', step: 5 },
        { key: 'timeConstant', label: '建压时间常数', unit: 's', step: 0.01 },
      ],
    }],
  },
  {
    id: 'steering', title: '转向系统', en: 'Steering', icon: 'steering', obj: (v) => v.steering, chart: 'none',
    groups: [{
      title: '转向器',
      fields: [
        { key: 'ratio', label: '转向系传动比', unit: '-', step: 0.1 },
        { key: 'maxWheelAngle', label: '方向盘最大转角', unit: 'deg', step: 10 },
        { key: 'ackermann', label: '阿克曼率', unit: '0–1', step: 0.05 },
      ],
    }],
  },
  {
    id: 'aero', title: '空气动力学', en: 'Aero', icon: 'wind', obj: (v) => v.aero, chart: 'none',
    groups: [{
      title: '气动系数',
      fields: [
        { key: 'cd', label: '风阻系数 Cd', unit: '-', step: 0.01 },
        { key: 'area', label: '迎风面积', unit: 'm²', step: 0.05 },
        { key: 'clFront', label: '前轴升力系数（负为下压力）', unit: '-', step: 0.01 },
        { key: 'clRear', label: '后轴升力系数（负为下压力）', unit: '-', step: 0.01 },
        { key: 'height', label: '风阻作用点高度', unit: 'm', step: 0.01 },
      ],
    }],
  },
  {
    id: 'controls', title: '主动安全', en: 'Controls', icon: 'shield', obj: (v) => v.controls, chart: 'none',
    groups: [{
      title: '电子控制系统',
      fields: [
        { key: 'abs', label: '防抱死制动 ABS', type: 'bool' },
        { key: 'esc', label: '车身电子稳定 ESC', type: 'bool' },
        { key: 'tcs', label: '牵引力控制 TCS', type: 'bool' },
      ],
    }],
  },
];

export class ParamEditor {
  readonly el: HTMLDivElement;
  private section = 'body';
  private nav: HTMLDivElement;
  private form: HTMLDivElement;
  private side: HTMLDivElement;
  private header: HTMLDivElement;
  private charts: Plot[] = [];

  constructor(private store: VehicleStore) {
    this.header = h('div', { class: 'pe-header card' });
    this.nav = h('div', { class: 'pe-nav card' });
    this.form = h('div', { class: 'pe-form' });
    this.side = h('div', { class: 'pe-side' });
    this.el = h('div', { class: 'view pe' }, this.header, h('div', { class: 'pe-body' }, this.nav, this.form, this.side));
    store.onChange(() => this.refreshHeader());
    this.render();
  }

  private get v() {
    return this.store.selected;
  }

  render() {
    this.refreshHeader();
    this.renderNav();
    this.renderForm();
    this.renderSide();
  }

  private refreshHeader() {
    const v = this.v;
    clear(this.header);
    const sel = h('select', {
      class: 'veh-select',
      onchange: (e: Event) => {
        this.store.select((e.target as HTMLSelectElement).value);
        this.renderForm();
        this.renderSide();
      },
    }, this.store.list.map((x) => h('option', { value: x.id, selected: x.id === v.id }, (x.builtin ? '★ ' : '') + x.name)));
    const fileIn = h('input', {
      type: 'file', accept: '.json,application/json', style: { display: 'none' },
      onchange: async (e: Event) => {
        const f = (e.target as HTMLInputElement).files?.[0];
        if (!f) return;
        try {
          const nv = this.store.importJSON(await f.text());
          toast(`已导入车型：${nv.name}`);
          this.render();
        } catch (err) {
          toast('导入失败：' + (err as Error).message, 'error');
        }
      },
    });
    this.header.append(
      h('div', { class: 'pe-title' }, h('span', { class: 'swatch', style: { background: v.color } }), sel),
      h('div', { class: 'pe-actions' },
        h('button', { class: 'btn btn-primary', onclick: () => { this.store.duplicate(v.id); this.render(); toast('已创建车型副本，可自由修改'); } }, icon('plus', 14), '复制为新车型'),
        v.builtin ? h('button', { class: 'btn', onclick: () => { if (confirm('将该内置车型恢复为出厂参数？')) { this.store.resetBuiltin(v.id); this.render(); } } }, '恢复出厂参数') : null,
        !v.builtin ? h('button', { class: 'btn btn-danger', onclick: () => { if (confirm(`删除车型「${v.name}」？`)) { this.store.remove(v.id); this.render(); } } }, '删除') : null,
        h('button', { class: 'btn', onclick: () => fileIn.click() }, '导入 JSON'),
        h('button', { class: 'btn', onclick: () => download(`${v.name}.json`, JSON.stringify(v, null, 2), 'application/json') }, '导出 JSON'),
        fileIn,
      ),
    );
  }

  private renderNav() {
    clear(this.nav);
    this.nav.appendChild(h('div', { class: 'pe-nav-head' }, '车辆子系统'));
    for (const s of SECTIONS) {
      this.nav.appendChild(h('button', {
        class: 'pe-nav-item' + (s.id === this.section ? ' active' : ''),
        onclick: () => { this.section = s.id; this.renderNav(); this.renderForm(); this.renderSide(); },
      }, icon(s.icon, 17), s.title));
    }
  }

  private renderForm() {
    clear(this.form);
    const v = this.v;
    const sec = SECTIONS.find((s) => s.id === this.section)!;
    const obj = sec.obj(v);
    if (sec.id === 'body') {
      this.form.appendChild(this.group('Profile', '基本信息', [
        this.input(v, { key: 'name', label: '车型名称', type: 'text' }),
        this.input(v, { key: 'description', label: '描述', type: 'textarea' }),
        this.input(v, { key: 'bodyStyle', label: '车身造型（动画）', type: 'select', options: [{ value: 'sedan', label: '三厢轿车' }, { value: 'hatch', label: '两厢车' }, { value: 'suv', label: 'SUV' }, { value: 'coupe', label: '跑车' }] }),
        this.input(v, { key: 'color', label: '车身颜色', type: 'color' }),
      ]));
    }
    for (const g of sec.groups) this.form.appendChild(this.group(sec.en, g.title, g.fields.map((f) => this.input(obj, f))));
    if (v.builtin) this.form.appendChild(h('p', { class: 'pe-tip' }, '提示：内置车型的修改会自动保存在浏览器中，可随时「恢复出厂参数」。建议先「复制为新车型」再改，方便对比。'));
  }

  private group(en: string, title: string, rows: HTMLElement[]) {
    return h('section', { class: 'pe-group card' }, secHead(en, title), h('div', { class: 'pe-grid' }, rows));
  }

  private input(obj: any, f: Field): HTMLElement {
    const id = `f-${this.section}-${f.key}`;
    const val = obj[f.key];
    const changed = () => {
      this.store.touch();
      this.renderSide();
    };
    let ctrl: HTMLElement;
    switch (f.type) {
      case 'text':
        ctrl = h('input', { id, type: 'text', value: val ?? '', oninput: (e: Event) => { obj[f.key] = (e.target as HTMLInputElement).value; changed(); } });
        break;
      case 'textarea':
        ctrl = h('textarea', { id, rows: 2, value: val ?? '', oninput: (e: Event) => { obj[f.key] = (e.target as HTMLTextAreaElement).value; changed(); } });
        break;
      case 'color':
        ctrl = h('input', { id, type: 'color', value: val, oninput: (e: Event) => { obj[f.key] = (e.target as HTMLInputElement).value; changed(); } });
        break;
      case 'select':
        ctrl = h('select', { id, onchange: (e: Event) => { obj[f.key] = (e.target as HTMLSelectElement).value; changed(); } },
          (f.options ?? []).map((o) => h('option', { value: o.value, selected: o.value === val }, o.label)));
        break;
      case 'bool':
        ctrl = h('label', { class: 'switch' },
          h('input', { id, type: 'checkbox', checked: !!val, onchange: (e: Event) => { obj[f.key] = (e.target as HTMLInputElement).checked; changed(); } }),
          h('span', { class: 'slider' }));
        break;
      case 'array': {
        const inp = h('input', {
          id, type: 'text', class: 'mono', value: (val as number[]).join(', '),
          onchange: (e: Event) => {
            const el = e.target as HTMLInputElement;
            const arr = el.value.split(/[,，\s]+/).filter(Boolean).map(Number);
            if (arr.length < 1 || arr.some((x) => !Number.isFinite(x))) {
              el.classList.add('invalid');
              toast('请输入以逗号分隔的数字', 'error');
              return;
            }
            el.classList.remove('invalid');
            obj[f.key] = arr;
            changed();
          },
        });
        ctrl = inp;
        break;
      }
      default:
        ctrl = h('input', {
          id, type: 'number', value: String(val), step: f.step ?? 'any',
          oninput: (e: Event) => {
            const x = parseFloat((e.target as HTMLInputElement).value);
            if (Number.isFinite(x)) { obj[f.key] = x; changed(); }
          },
        });
    }
    return h('div', { class: 'pe-row' + (f.type === 'array' || f.type === 'textarea' ? ' wide' : '') },
      h('label', { for: id, title: f.help ?? '' }, f.label, f.help ? h('span', { class: 'help', title: f.help }, ' ⓘ') : null),
      ctrl,
      h('span', { class: 'unit' }, f.unit ?? ''));
  }

  private renderSide() {
    clear(this.side);
    this.charts = [];
    const v = this.v;
    let d;
    try { d = computeDerived(v); } catch { return; }
    const sec = SECTIONS.find((s) => s.id === this.section)!;
    const row = (k: string, val: string) => h('tr', null, h('td', null, k), h('td', null, val));
    this.side.appendChild(h('div', { class: 'card' },
      secHead('Summary', '整车特性（线性估算）'),
      h('table', { class: 'kv' },
        row('整备质量', `${fmt(d.totalMass, 0)} kg`),
        row('前/后轴荷', `${fmt(d.frontWeightPct, 1)} / ${fmt(100 - d.frontWeightPct, 1)} %`),
        row('整车质心高度', `${fmt(d.hTotal, 3)} m`),
        row('偏频 前/后', `${fmt(d.rideFreqFront, 2)} / ${fmt(d.rideFreqRear, 2)} Hz`),
        row('侧倾刚度前轴占比', `${fmt(d.rollStiffnessFrontPct, 1)} %`),
        row('侧倾梯度', `${fmt(d.rollGradient, 2)} deg/g`),
        row('不足转向度', `${fmt(d.understeerGradient, 2)} deg/g`),
        row(d.charSpeed >= 0 ? '特征车速' : '临界车速', `${fmt(Math.abs(d.charSpeed), 0)} km/h`),
        row('峰值功率', `${fmt(d.peakPowerKw, 0)} kW @ ${fmt(d.peakPowerRpm, 0)} rpm`),
        row('峰值扭矩', `${fmt(d.peakTorque, 0)} N·m`),
        row('功重比', `${fmt(d.powerToWeight, 0)} kW/t`),
        row('理论最高车速', `${fmt(d.topSpeedKph, 0)} km/h`),
        row('前轴制动力分配', `${fmt(d.brakeFrontPct, 1)} %`),
      )));
    if (sec.chart === 'tire') this.tireCharts(sec.obj(v) as TireParams);
    if (sec.chart === 'engine') this.engineChart(v);
    if (sec.chart === 'damper') this.damperChart(sec.obj(v) as AxleSuspension);
  }

  private chartCard(title: string): HTMLDivElement {
    const box = h('div', { class: 'chart-box' });
    this.side.appendChild(h('div', { class: 'card' }, h('h3', null, title), box));
    return box;
  }

  private tireCharts(tp: TireParams) {
    const tm = new TireModel(tp);
    const loads = [0.5, 1, 1.5].map((f) => f * tp.nominalLoad);
    const colors = ['#0071e3', '#c93400', '#248a3d'];
    const out = { fx: 0, fy: 0, mz: 0 };
    const sy: Series[] = [], sx: Series[] = [];
    loads.forEach((fz, k) => {
      const a: number[] = [], fy: number[] = [], kk: number[] = [], fx: number[] = [];
      for (let deg = 0; deg <= 15; deg += 0.25) {
        tm.compute(0, Math.tan((deg * Math.PI) / 180), 0, fz, 1, out);
        a.push(deg); fy.push(out.fy);
      }
      for (let s = -0.5; s <= 0.5001; s += 0.01) {
        tm.compute(s, 0, 0, fz, 1, out);
        kk.push(s); fx.push(out.fx);
      }
      const label = `Fz=${(fz / 1000).toFixed(1)} kN`;
      sy.push({ x: a, y: fy, color: colors[k], label });
      sx.push({ x: kk, y: fx, color: colors[k], label });
    });
    const p1 = new Plot(this.chartCard('侧向力 Fy – 侧偏角'));
    p1.setData({ series: sy, xLabel: '侧偏角 (deg)', yLabel: 'Fy (N)' });
    const p2 = new Plot(this.chartCard('纵向力 Fx – 滑移率'));
    p2.setData({ series: sx, xLabel: '滑移率 (-)', yLabel: 'Fx (N)' });
    // 联合工况摩擦圆
    const sc: Series[] = [];
    [0, 2, 4, 8].forEach((deg, k) => {
      const fx: number[] = [], fy: number[] = [];
      for (let s = -0.3; s <= 0.3001; s += 0.005) {
        tm.compute(s, Math.tan((deg * Math.PI) / 180), 0, tp.nominalLoad, 1, out);
        fx.push(out.fx); fy.push(out.fy);
      }
      sc.push({ x: fy, y: fx, color: ['#aeaeb2', '#0071e3', '#c93400', '#248a3d'][k], label: `α=${deg}°` });
    });
    const p3 = new Plot(this.chartCard('联合滑移（名义载荷）Fx – Fy'));
    p3.setData({ series: sc, xLabel: 'Fy (N)', yLabel: 'Fx (N)', equal: true });
    this.charts.push(p1, p2, p3);
  }

  private engineChart(v: VehicleParams) {
    const P = v.powertrain;
    const pt = new PowertrainModel(P);
    const rpm: number[] = [], tq: number[] = [], pw: number[] = [], fr: number[] = [];
    for (let r = Math.min(P.engineRpm[0], P.idleRpm); r <= P.redlineRpm; r += 50) {
      const w = (r * Math.PI) / 30;
      const t = pt.engineTorqueAt(w, 1);
      rpm.push(r); tq.push(t); pw.push((t * w) / 1000); fr.push(pt.engineTorqueAt(w, 0));
    }
    const p1 = new Plot(this.chartCard('发动机外特性'));
    p1.setData({
      series: [
        { x: rpm, y: tq, color: '#0071e3', label: '扭矩 N·m' },
        { x: rpm, y: pw, color: '#c93400', label: '功率 kW' },
        { x: rpm, y: fr, color: '#aeaeb2', label: '倒拖扭矩 N·m', dash: [4, 3] },
      ],
      xLabel: '转速 (rpm)', yLabel: '',
    });
    // 各档驱动力 – 车速
    const r = v.tireRear.unloadedRadius * 0.98;
    const ser: Series[] = [];
    const palette = ['#0071e3', '#c93400', '#248a3d', '#6e6e73', '#5e5ce6', '#0a9396', '#a2845e', '#1d1d1f', '#aeaeb2'];
    P.gearRatios.forEach((g, i) => {
      const xs: number[] = [], ys: number[] = [];
      for (let e = P.engineRpm[0]; e <= P.redlineRpm; e += 50) {
        const w = (e * Math.PI) / 30;
        const vk = (w / (g * P.finalDrive)) * r * 3.6;
        xs.push(vk); ys.push((pt.engineTorqueAt(w, 1) * g * P.finalDrive * P.efficiency) / r / 1000);
      }
      ser.push({ x: xs, y: ys, color: palette[i % palette.length], label: `${i + 1}档` });
    });
    const p2 = new Plot(this.chartCard('各档驱动力 – 车速（闭锁）'));
    p2.setData({ series: ser, xLabel: '车速 (km/h)', yLabel: '驱动力 (kN)' });
    this.charts.push(p1, p2);
  }

  private damperChart(s: AxleSuspension) {
    const xs: number[] = [], ys: number[] = [];
    for (let vv = -1; vv <= 1.0001; vv += 0.01) {
      const coef = vv > 0 ? s.damperBump : s.damperRebound;
      const a = Math.abs(vv);
      const f = a <= s.damperKnee ? coef * vv : Math.sign(vv) * (coef * s.damperKnee + coef * s.damperHighRatio * (a - s.damperKnee));
      xs.push(vv); ys.push(f);
    }
    const p = new Plot(this.chartCard('减振器力 – 速度（压缩为正）'));
    p.setData({ series: [{ x: xs, y: ys, color: '#0071e3', label: '阻尼力 N' }], xLabel: '速度 (m/s)', yLabel: 'N' });
    const cx: number[] = [], cy: number[] = [];
    for (let c = -s.reboundTravel - 0.01; c <= s.bumpTravel + 0.02; c += 0.001) {
      let f = s.springRate * c;
      if (c > s.bumpTravel) { const e = c - s.bumpTravel; f += s.bumpStopRate * e * (1 + 30 * e); }
      else if (c < -s.reboundTravel) f += s.bumpStopRate * (c + s.reboundTravel);
      cx.push(c * 1000); cy.push(f);
    }
    const p2 = new Plot(this.chartCard('弹簧 + 缓冲块力 – 压缩量（相对静平衡）'));
    p2.setData({ series: [{ x: cx, y: cy, color: '#0071e3', label: '弹性力 N' }], xLabel: '压缩量 (mm)', yLabel: 'N' });
    this.charts.push(p, p2);
  }
}
