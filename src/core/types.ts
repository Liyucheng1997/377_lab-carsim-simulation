// 仿真结果与工况相关的公共类型
import type { VehicleParams, Controls } from './params';
import type { RoadDef } from './road';
import type { Path } from './path';
import type { Vehicle, DriverInput } from './vehicle';
import type { DriverContext } from './channels';

export interface Cone { x: number; y: number }

export interface PlotSpec {
  title: string;
  x?: string; // 默认时间 't'
  y: string[];
  showCones?: boolean;
  showPath?: boolean;
  equalAxes?: boolean;
}

export interface KPI {
  label: string;
  value: number | string;
  unit?: string;
  decimals?: number;
  pass?: boolean | null; // 法规/标准判定
  note?: string;
}

export interface SceneDesc {
  road: RoadDef;
  path?: { x: number[]; y: number[]; closed: boolean };
  ribbonWidth?: number; // 沿参考路径绘制的路面宽度
  cones?: Cone[];
  startLine?: number;
}

export interface ParamDef {
  key: string;
  label: string;
  unit?: string;
  type: 'number' | 'select';
  default: number | string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
  help?: string;
}

export type DriverFn = (veh: Vehicle, t: number, dt: number, ctx: DriverContext) => DriverInput;

export interface ProcedureSetup {
  duration: number;
  init: { speed: number; x: number; y: number; yaw: number };
  road: RoadDef;
  path?: Path;
  ribbonWidth?: number;
  cones?: Cone[];
  controls?: Partial<Controls>;
  driver: DriverFn;
  stop?: (veh: Vehicle, t: number, ctx: DriverContext) => boolean;
  kpis: (r: SimResult) => KPI[];
  plots: PlotSpec[];
}

export interface Procedure {
  id: string;
  name: string;
  category: string;
  standard: string;
  description: string;
  params: ParamDef[];
  setup: (p: Record<string, any>, vp: VehicleParams) => ProcedureSetup;
}

export interface SimResult {
  id: string;
  name: string;
  color: string;
  vehicle: VehicleParams;
  procedureId: string;
  procedureName: string;
  params: Record<string, any>;
  t: Float32Array;
  ch: Record<string, Float32Array>;
  n: number;
  dtOut: number;
  kpis: KPI[];
  plots: PlotSpec[];
  scene: SceneDesc;
  wallMs: number;
  createdAt: number;
  warnings: string[];
}
