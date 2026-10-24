// 动画叠加仪表（车速、档位、方向盘、加速度、踏板、主动安全指示）
import { h } from './dom';

export interface HudData {
  t?: number;
  speed: number; // km/h
  gear: number;
  rpm: number;
  sw: number; // deg
  ax: number; // g
  ay: number; // g
  r: number; // deg/s
  beta: number; // deg
  roll: number; // deg
  throttle: number; // 0..1
  brake: number; // 0..1
  abs: boolean;
  esc: boolean;
  tcs: boolean;
}

const WHEEL_SVG = `<svg viewBox="-50 -50 100 100" width="58" height="58">
<circle r="44" fill="none" stroke="currentColor" stroke-width="8"/>
<circle r="10" fill="currentColor"/>
<path d="M-42 4 L-10 6 L-10 -4 L-42 -6 Z M42 4 L10 6 L10 -4 L42 -6 Z M-6 10 L6 10 L5 42 L-5 42 Z" fill="currentColor"/>
<rect x="-4" y="-50" width="8" height="10" rx="2" style="fill:var(--primary)"/></svg>`;

export class Hud {
  readonly el: HTMLDivElement;
  private q: Record<string, HTMLElement> = {};
  private wheel: HTMLDivElement;

  constructor(parent: HTMLElement, compact = false) {
    const cell = (key: string, label: string, unit: string) => {
      const v = h('b', null, '0');
      this.q[key] = v;
      return h('div', { class: 'hud-cell' }, h('span', null, label), v, h('i', null, unit));
    };
    this.wheel = h('div', { class: 'hud-wheel' });
    this.wheel.innerHTML = WHEEL_SVG;
    const thr = h('div', { class: 'bar-fill thr' });
    const brk = h('div', { class: 'bar-fill brk' });
    this.q.thr = thr;
    this.q.brk = brk;
    const lamp = (key: string, text: string) => (this.q[key] = h('span', { class: 'lamp' }, text));
    const speed = h('div', { class: 'hud-speed' });
    this.q.speed = speed;
    const gear = h('div', { class: 'hud-gear' });
    this.q.gear = gear;
    this.q.time = h('div', { class: 'hud-time' });
    this.el = h('div', { class: 'hud' + (compact ? ' compact' : '') },
      h('div', { class: 'hud-top' },
        h('div', null, speed, h('div', { class: 'hud-unit' }, 'KM/H')),
        h('div', { class: 'hud-right' }, gear, this.q.time),
      ),
      h('div', { class: 'hud-mid' },
        h('div', { class: 'hud-wheel-box' }, this.wheel, (this.q.sw = h('div', { class: 'hud-sw' }, '0°'))),
        h('div', { class: 'hud-bars' },
          h('div', { class: 'bar' }, thr), h('div', { class: 'bar' }, brk),
          h('div', { class: 'bar-lbl' }, h('span', null, '油门'), h('span', null, '制动'))),
        h('div', { class: 'hud-lamps' }, lamp('abs', 'ABS'), lamp('esc', 'ESC'), lamp('tcs', 'TCS')),
      ),
      h('div', { class: 'hud-grid' },
        cell('ay', '侧向加速度', 'g'), cell('ax', '纵向加速度', 'g'), cell('r', '横摆角速度', '°/s'),
        cell('beta', '质心侧偏角', '°'), cell('roll', '侧倾角', '°'), cell('rpm', '发动机', 'rpm'),
      ),
    );
    parent.appendChild(this.el);
  }

  update(d: HudData) {
    const q = this.q;
    q.speed.textContent = Math.abs(d.speed).toFixed(0);
    q.gear.textContent = `${d.gear} 档`;
    q.time.textContent = d.t !== undefined ? `t = ${d.t.toFixed(2)} s` : '';
    q.sw.textContent = `${d.sw.toFixed(0)}°`;
    this.wheel.style.transform = `rotate(${-d.sw}deg)`;
    q.ay.textContent = d.ay.toFixed(2);
    q.ax.textContent = d.ax.toFixed(2);
    q.r.textContent = d.r.toFixed(1);
    q.beta.textContent = d.beta.toFixed(1);
    q.roll.textContent = d.roll.toFixed(1);
    q.rpm.textContent = d.rpm.toFixed(0);
    q.thr.style.height = `${Math.min(100, d.throttle * 100)}%`;
    q.brk.style.height = `${Math.min(100, d.brake * 100)}%`;
    q.abs.classList.toggle('on', d.abs);
    q.esc.classList.toggle('on', d.esc);
    q.tcs.classList.toggle('on', d.tcs);
  }
}
