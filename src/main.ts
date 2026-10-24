// VDLab 应用入口
import './styles.css';
import { h } from './ui/dom';
import { icon } from './ui/icons';
import { VehicleStore } from './ui/store';
import { Workspace } from './ui/workspace';
import { ParamEditor } from './ui/paramEditor';
import { Realtime } from './ui/realtime';
import { helpView } from './ui/help';

type Tab = 'sim' | 'params' | 'realtime' | 'help';

// 主题：只切 <html data-theme>，组件全部引用变量
function applyTheme(t: 'light' | 'dark') {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('vdlab.theme', t); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('vdlab-theme', { detail: t }));
}
let theme: 'light' | 'dark' = 'light';
try {
  const saved = localStorage.getItem('vdlab.theme');
  theme = saved === 'dark' || saved === 'light' ? saved : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
} catch { /* ignore */ }
document.documentElement.dataset.theme = theme;

const store = new VehicleStore();
const app = document.getElementById('app')!;

const workspace = new Workspace(store);
let editor: ParamEditor | null = null;
let realtime: Realtime | null = null;
let help: HTMLElement | null = null;

const views = h('div', { class: 'views' }, workspace.el);
const tabs: Record<Tab, HTMLButtonElement> = {
  sim: h('button', { onclick: () => show('sim') }, '试验仿真'),
  params: h('button', { onclick: () => show('params') }, '车辆参数'),
  realtime: h('button', { onclick: () => show('realtime') }, '实时驾驶'),
  help: h('button', { onclick: () => show('help') }, '模型说明'),
};

const themeBtn = h('button', { class: 'tb-round', title: '切换深色 / 浅色', 'aria-label': '切换主题' });
const renderThemeBtn = () => themeBtn.replaceChildren(icon(theme === 'dark' ? 'sun' : 'moon', 17));
renderThemeBtn();
themeBtn.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  applyTheme(theme);
  renderThemeBtn();
});

app.append(
  h('header', { class: 'titlebar' },
    h('div', { class: 'brand' },
      h('div', { class: 'logo-mark' }, 'V'),
      h('div', { class: 'brand-text' }, h('b', null, 'VDLab'), h('span', null, '车辆动力学仿真'))),
    h('nav', { class: 'seg lg' }, Object.values(tabs)),
    h('div', { class: 'top-right' },
      h('span', { class: 'status', title: '全部计算在本地浏览器完成' }, h('span', { class: 'dot ok' }), '本地实时计算'),
      themeBtn,
      h('a', { class: 'tb-round', href: 'https://liyucheng.me', title: '访问 liyucheng.me', target: '_blank', rel: 'noopener' }, icon('arrow-up-right', 17)),
    ),
  ),
  views,
);

function show(t: Tab) {
  for (const [k, b] of Object.entries(tabs)) b.classList.toggle('active', k === t);
  for (const c of Array.from(views.children)) (c as HTMLElement).style.display = 'none';
  workspace.setVisible(t === 'sim');
  realtime?.setVisible(false);
  if (t === 'sim') workspace.el.style.display = '';
  if (t === 'params') {
    if (!editor) { editor = new ParamEditor(store); views.appendChild(editor.el); }
    else editor.render();
    editor.el.style.display = '';
  }
  if (t === 'realtime') {
    if (!realtime) {
      realtime = new Realtime(store);
      realtime.onSaveRun = (r) => workspace.addRun(r);
      views.appendChild(realtime.el);
    }
    realtime.el.style.display = '';
    realtime.setVisible(true);
  }
  if (t === 'help') {
    if (!help) { help = helpView(); views.appendChild(help); }
    help.style.display = '';
  }
  try { localStorage.setItem('vdlab.tab', t); } catch { /* ignore */ }
}

let initial: Tab = 'sim';
try {
  const t = localStorage.getItem('vdlab.tab') as Tab | null;
  if (t && t in tabs) initial = t;
} catch { /* ignore */ }
show(initial);

if (import.meta.env.DEV) (window as any).__vdlab = { workspace, store, get realtime() { return realtime; } };
