// 车型库：内置车型 + 用户车型，持久化到 localStorage
import { BUILTIN_VEHICLES, cloneVehicle, type VehicleParams } from '../core/params';

const KEY = 'vdlab.vehicles.v1';
const SEL_KEY = 'vdlab.selectedVehicle';

function deepMerge<T>(template: T, data: any): T {
  if (Array.isArray(template)) return (Array.isArray(data) ? data : template) as T;
  if (template && typeof template === 'object') {
    const out: any = {};
    for (const k of Object.keys(template as any)) out[k] = deepMerge((template as any)[k], data?.[k]);
    for (const k of Object.keys(data ?? {})) if (!(k in out)) out[k] = data[k];
    return out;
  }
  if (data === undefined || data === null) return template;
  if (typeof template === 'number') return (typeof data === 'number' && Number.isFinite(data) ? data : template) as T;
  return data as T;
}

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* 隐私模式等 */ }
}

export class VehicleStore {
  list: VehicleParams[] = [];
  selectedId: string;
  private listeners: (() => void)[] = [];
  private saveTimer = 0;

  constructor() {
    const raw = safeGet(KEY);
    let stored: any[] = [];
    if (raw) {
      try { stored = JSON.parse(raw); } catch { stored = []; }
    }
    const byId = new Map(stored.map((v) => [v.id, v]));
    for (const b of BUILTIN_VEHICLES) {
      const s = byId.get(b.id);
      this.list.push(s ? deepMerge(cloneVehicle(b), s) : cloneVehicle(b));
      byId.delete(b.id);
    }
    for (const s of byId.values()) {
      const tpl = BUILTIN_VEHICLES.find((b) => b.bodyStyle === s.bodyStyle) ?? BUILTIN_VEHICLES[0];
      const v = deepMerge(cloneVehicle(tpl), s);
      v.builtin = false;
      this.list.push(v);
    }
    const sel = safeGet(SEL_KEY);
    this.selectedId = sel && this.list.some((v) => v.id === sel) ? sel : this.list[0].id;
  }

  onChange(fn: () => void) {
    this.listeners.push(fn);
  }

  private emit() {
    for (const f of this.listeners) f();
  }

  get selected(): VehicleParams {
    return this.get(this.selectedId) ?? this.list[0];
  }

  get(id: string) {
    return this.list.find((v) => v.id === id);
  }

  select(id: string) {
    this.selectedId = id;
    safeSet(SEL_KEY, id);
    this.emit();
  }

  /** 参数修改后调用（延迟保存） */
  touch() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 400);
    this.emit();
  }

  save() {
    safeSet(KEY, JSON.stringify(this.list));
  }

  duplicate(id: string): VehicleParams {
    const src = this.get(id)!;
    const v = cloneVehicle(src);
    v.id = `custom-${Date.now().toString(36)}`;
    v.name = src.name + ' (副本)';
    v.builtin = false;
    this.list.push(v);
    this.save();
    this.select(v.id);
    return v;
  }

  remove(id: string) {
    const v = this.get(id);
    if (!v || v.builtin) return;
    this.list = this.list.filter((x) => x.id !== id);
    this.save();
    this.select(this.list[0].id);
  }

  resetBuiltin(id: string) {
    const b = BUILTIN_VEHICLES.find((x) => x.id === id);
    if (!b) return;
    const i = this.list.findIndex((x) => x.id === id);
    this.list[i] = cloneVehicle(b);
    this.save();
    this.emit();
  }

  importJSON(text: string): VehicleParams {
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || !data.body || !data.powertrain) throw new Error('不是有效的车辆参数文件');
    const tpl = BUILTIN_VEHICLES.find((b) => b.bodyStyle === data.bodyStyle) ?? BUILTIN_VEHICLES[0];
    const v = deepMerge(cloneVehicle(tpl), data);
    v.id = `custom-${Date.now().toString(36)}`;
    v.builtin = false;
    this.list.push(v);
    this.save();
    this.select(v.id);
    return v;
  }
}
