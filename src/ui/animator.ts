// 三维动画器（Three.js）：场景、道路、桩桶、车辆、相机
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { SceneDesc } from '../core/types';
import type { VehicleParams } from '../core/params';
import { Road } from '../core/road';
import { CarRig, type CarFrame } from './carModel';

export type CameraMode = 'chase' | 'orbit' | 'top' | 'side' | 'driver' | 'front';

export const CAMERA_MODES: { id: CameraMode; label: string }[] = [
  { id: 'chase', label: '跟随' },
  { id: 'orbit', label: '自由' },
  { id: 'side', label: '侧视' },
  { id: 'front', label: '前视' },
  { id: 'top', label: '俯视' },
  { id: 'driver', label: '驾驶员' },
];

// 场景配色：浅色 = 明亮摄影棚；深色 = 夜间试验场。随 <html data-theme> 切换
interface Palette {
  sky: [string, string, string];
  fog: number;
  ground: string;
  gridMajor: string;
  gridMinor: string;
  noise: number;
  road: number;
  edge: number;
  uneven: number;
  ice: number;
  path: number;
  trail: number;
  hemi: [number, number, number];
  sun: number;
  env: number;
}
const LIGHT: Palette = {
  sky: ['#ffffff', '#f7f7f9', '#ececf0'], fog: 0xf3f4f7,
  ground: '#e6e6ea', gridMajor: 'rgba(0,0,0,0.10)', gridMinor: 'rgba(0,0,0,0.04)', noise: 8,
  road: 0xc4c6cc, edge: 0xffffff, uneven: 0xb6b8bf, ice: 0xd6ecff,
  path: 0x8e8e93, trail: 0x0071e3, hemi: [0xffffff, 0xd8d8de, 0.9], sun: 1.9, env: 0.55,
};
const DARK: Palette = {
  sky: ['#000000', '#0b0b0d', '#1c1c1e'], fog: 0x111113,
  ground: '#1c1c1e', gridMajor: 'rgba(255,255,255,0.10)', gridMinor: 'rgba(255,255,255,0.04)', noise: 6,
  road: 0x3a3a3c, edge: 0xaeaeb2, uneven: 0x48484a, ice: 0x29466a,
  path: 0x8e8e93, trail: 0x0a84ff, hemi: [0xcfd8ff, 0x202024, 0.55], sun: 1.3, env: 0.35,
};
const currentPalette = (): Palette => (document.documentElement.dataset.theme === 'dark' ? DARK : LIGHT);

export class Animator {
  readonly el: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private sun: THREE.DirectionalLight;
  private sceneGroup = new THREE.Group();
  private cars: { id: string; rig: CarRig }[] = [];
  private trail: THREE.Line;
  private trailPos: Float32Array;
  private trailN = 0;
  private mode: CameraMode = 'chase';
  private lastTarget = new THREE.Vector3();
  private chaseYaw = 0;
  private running = false;
  private needsFit = true;
  private road: Road | null = null;
  showForces = false;
  active = true;
  private pal: Palette = currentPalette();
  private ground!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private hemi!: THREE.HemisphereLight;
  private lastScene: SceneDesc | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'animator';
    parent.appendChild(this.el);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.el.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    this.camera.position.set(-8, 3, 6);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.enabled = false;
    this.controls.addEventListener('start', () => {
      if (this.mode !== 'orbit') this.setCameraMode('orbit');
    });

    this.scene.background = skyTexture(this.pal);
    // 环境光照贴图：让车漆与金属轮辋有真实反射
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = this.pal.env;
    this.scene.fog = new THREE.Fog(this.pal.fog, 180, 1300);
    this.hemi = new THREE.HemisphereLight(this.pal.hemi[0], this.pal.hemi[1], this.pal.hemi[2]);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff6ec, this.pal.sun);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -25; sc.right = 25; sc.top = 25; sc.bottom = -25; sc.near = 1; sc.far = 120;
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);

    // 地面：试验场沥青 + 10 m 网格
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(8000, 8000),
      new THREE.MeshStandardMaterial({ map: gridTexture(this.pal), roughness: 0.95, metalness: 0 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.scene.add(this.sceneGroup);

    this.trailPos = new Float32Array(3 * 20000);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    tg.setDrawRange(0, 0);
    this.trail = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: this.pal.trail }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
    window.addEventListener('vdlab-theme', () => this.applyTheme());

    new ResizeObserver(() => this.resize()).observe(this.el);
    this.resize();
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      if (!this.active) return;
      if (this.mode === 'orbit') this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    const w = Math.max(10, r.width), hgt = Math.max(10, r.height);
    this.renderer.setSize(w, hgt, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = hgt + 'px';
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
  }

  /** 主题切换：天空、雾、地面、灯光、道路配色 */
  private applyTheme() {
    const pal = currentPalette();
    if (pal === this.pal) return;
    this.pal = pal;
    (this.scene.background as THREE.Texture | null)?.dispose();
    this.scene.background = skyTexture(pal);
    (this.scene.fog as THREE.Fog).color.setHex(pal.fog);
    this.scene.environmentIntensity = pal.env;
    this.hemi.color.setHex(pal.hemi[0]);
    this.hemi.groundColor.setHex(pal.hemi[1]);
    this.hemi.intensity = pal.hemi[2];
    this.sun.intensity = pal.sun;
    this.ground.material.map?.dispose();
    this.ground.material.map = gridTexture(pal);
    this.ground.material.needsUpdate = true;
    (this.trail.material as THREE.LineBasicMaterial).color.setHex(pal.trail);
    const fit = this.needsFit;
    this.setScene(this.lastScene);
    this.needsFit = fit;
  }

  setCameraMode(m: CameraMode) {
    this.mode = m;
    this.controls.enabled = m === 'orbit';
    this.needsFit = true;
    this.el.dispatchEvent(new CustomEvent('cameramode', { detail: m }));
  }

  get cameraMode() {
    return this.mode;
  }

  /** 设置场景（道路、桩桶、路面特征） */
  setScene(desc: SceneDesc | null) {
    disposeGroup(this.sceneGroup);
    this.lastScene = desc;
    if (!desc) { this.road = null; return; }
    this.road = new Road(desc.road);
    const g = this.sceneGroup;
    const pal = this.pal;
    if (desc.path && desc.ribbonWidth) g.add(buildRibbon(desc.path.x, desc.path.y, desc.path.closed, desc.ribbonWidth, pal));
    if (desc.path) {
      const pts = desc.path.x.map((x, i) => new THREE.Vector3(x, 0.025, -desc.path!.y[i]));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: pal.path, dashSize: 1.2, gapSize: 1.6, transparent: true, opacity: 0.8 }));
      line.computeLineDistances();
      g.add(line);
    }
    if (desc.cones?.length) g.add(buildCones(desc.cones));
    for (const p of desc.road.muPatches ?? []) {
      const w = Math.min(p.x1, p.x0 + 2000) - p.x0, d = Math.min(p.y1, 30) - Math.max(p.y0, -30);
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, d),
        new THREE.MeshStandardMaterial({ color: pal.ice, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.85 }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x0 + w / 2, 0.018, -(Math.max(p.y0, -30) + d / 2));
      m.receiveShadow = true;
      g.add(m);
    }
    const road = this.road;
    const ur = road.unevenRange();
    if (ur) g.add(buildUneven(road, ur[0], ur[1], pal));
    this.needsFit = true;
  }

  /** 设置车辆（第一辆为主车，其余为半透明对比车） */
  setVehicles(list: { id: string; vp: VehicleParams; ghost?: boolean; color?: string }[]) {
    const key = (l: typeof list) => l.map((c) => c.id).join('|');
    if (key(list) === this.cars.map((c) => c.id).join('|')) return;
    for (const c of this.cars) { this.scene.remove(c.rig.root); c.rig.dispose(); }
    this.cars = list.map((c) => {
      const rig = new CarRig(c.vp, { ghost: c.ghost, color: c.color });
      this.scene.add(rig.root);
      return { id: c.id, rig };
    });
    this.needsFit = true;
  }

  setTrail(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number) {
    const step = Math.max(1, Math.ceil(n / 20000));
    let k = 0;
    for (let i = 0; i < n && k < 20000; i += step, k++) {
      this.trailPos[3 * k] = xs[i];
      this.trailPos[3 * k + 1] = 0.04;
      this.trailPos[3 * k + 2] = -ys[i];
    }
    this.trailN = k;
    const attr = this.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true;
    this.trail.geometry.setDrawRange(0, k);
    this.trail.geometry.computeBoundingSphere();
  }

  /** 实时模式：追加轨迹点 */
  pushTrail(x: number, y: number) {
    if (this.trailN >= 20000) {
      this.trailPos.copyWithin(0, 3 * 5000);
      this.trailN -= 5000;
    }
    const k = this.trailN++;
    this.trailPos[3 * k] = x;
    this.trailPos[3 * k + 1] = 0.04;
    this.trailPos[3 * k + 2] = -y;
    (this.trail.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    this.trail.geometry.setDrawRange(0, this.trailN);
  }

  clearTrail() {
    this.trailN = 0;
    this.trail.geometry.setDrawRange(0, 0);
  }

  setFrames(frames: CarFrame[]) {
    frames.forEach((f, i) => {
      const c = this.cars[i];
      if (!c) return;
      if (this.road) f.zRoad = this.road.height(f.X, f.Y);
      c.rig.showForces = this.showForces && i === 0;
      c.rig.setFrame(f);
    });
    if (frames[0]) this.updateCamera(frames[0]);
  }

  private updateCamera(f: CarFrame) {
    const target = new THREE.Vector3(f.X, 0.7, -f.Y);
    const cam = this.camera;
    // 平滑跟随的航向（避免俯视/跟随镜头抖动）
    let dy = f.yaw - this.chaseYaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    this.chaseYaw += this.needsFit ? dy : dy * 0.08;
    const cy = Math.cos(this.chaseYaw), sy = Math.sin(this.chaseYaw);
    switch (this.mode) {
      case 'chase': {
        cam.position.set(f.X - cy * 9, 3.2, -(f.Y - sy * 9));
        cam.lookAt(target.x + cy * 3, 0.9, target.z - sy * 3);
        break;
      }
      case 'side': {
        cam.position.set(f.X - sy * 0.0 + 0, 1.6, -(f.Y + 14));
        cam.lookAt(target);
        break;
      }
      case 'front': {
        cam.position.set(f.X + cy * 9, 2.2, -(f.Y + sy * 9));
        cam.lookAt(target);
        break;
      }
      case 'top': {
        cam.position.set(f.X, 45, -f.Y + 0.01);
        cam.up.set(cy, 0, -sy);
        cam.lookAt(f.X, 0, -f.Y);
        break;
      }
      case 'driver': {
        const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
        const ex = f.X - c * 0.3 + -s * 0.37, ey = f.Y - s * 0.3 + c * 0.37;
        cam.position.set(ex, 1.15 + f.zs, -ey);
        cam.lookAt(ex + c * 20, 1.0, -(ey + s * 20));
        break;
      }
      case 'orbit': {
        if (this.needsFit) {
          cam.position.set(f.X - 7, 3.5, -(f.Y - 6));
          this.controls.target.copy(target);
        } else {
          const delta = target.clone().sub(this.lastTarget);
          cam.position.add(delta);
          this.controls.target.add(delta);
        }
        break;
      }
    }
    if (this.mode !== 'top') cam.up.set(0, 1, 0);
    this.lastTarget.copy(target);
    this.needsFit = false;
    this.sun.position.set(target.x + 30, 50, target.z + 20);
    this.sun.target.position.copy(target);
  }

  dispose() {
    this.running = false;
    this.renderer.dispose();
  }
}

// ---------------------------------------------------------------------------
function disposeGroup(g: THREE.Group) {
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else if (mat) mat.dispose();
    });
  }
}

function skyTexture(pal: Palette): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, pal.sky[0]);
  grd.addColorStop(0.5, pal.sky[1]);
  grd.addColorStop(1, pal.sky[2]);
  g.fillStyle = grd;
  g.fillRect(0, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function gridTexture(pal: Palette): THREE.Texture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.fillStyle = pal.ground;
  g.fillRect(0, 0, S, S);
  // 沥青颗粒噪声
  const img = g.getImageData(0, 0, S, S);
  let seed = 7;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const n = ((seed / 2147483647) - 0.5) * pal.noise;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = pal.gridMajor;
  g.lineWidth = 3;
  g.strokeRect(0, 0, S, S);
  g.strokeStyle = pal.gridMinor;
  g.lineWidth = 1.5;
  for (let k = 1; k < 5; k++) {
    g.beginPath(); g.moveTo((k * S) / 5, 0); g.lineTo((k * S) / 5, S); g.stroke();
    g.beginPath(); g.moveTo(0, (k * S) / 5); g.lineTo(S, (k * S) / 5); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(800, 800); // 每格 10 m
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function buildRibbon(xs: number[], ys: number[], closed: boolean, width: number, pal: Palette): THREE.Group {
  const g = new THREE.Group();
  const n = xs.length;
  const strip = (off0: number, off1: number, yh: number, mat: THREE.Material) => {
    const pos: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = closed ? (i - 1 + n) % n : Math.max(0, i - 1);
      const b = closed ? (i + 1) % n : Math.min(n - 1, i + 1);
      let tx = xs[b] - xs[a], ty = ys[b] - ys[a];
      const l = Math.hypot(tx, ty) || 1;
      tx /= l; ty /= l;
      const nx = -ty, ny = tx;
      pos.push(xs[i] + nx * off0, yh, -(ys[i] + ny * off0));
      pos.push(xs[i] + nx * off1, yh, -(ys[i] + ny * off1));
      if (i < n - 1) {
        const k = 2 * i;
        idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.receiveShadow = true;
    return m;
  };
  const asphalt = new THREE.MeshStandardMaterial({ color: pal.road, roughness: 0.92, side: THREE.DoubleSide });
  const white = new THREE.MeshStandardMaterial({ color: pal.edge, roughness: 0.5, side: THREE.DoubleSide });
  const hw = width / 2;
  g.add(strip(-hw, hw, 0.01, asphalt));
  g.add(strip(hw - 0.35, hw - 0.2, 0.014, white));
  g.add(strip(-hw + 0.2, -hw + 0.35, 0.014, white));
  return g;
}

function buildCones(cones: { x: number; y: number }[]): THREE.Group {
  const g = new THREE.Group();
  const coneGeo = new THREE.ConeGeometry(0.15, 0.5, 16);
  coneGeo.translate(0, 0.28, 0);
  const baseGeo = new THREE.BoxGeometry(0.36, 0.04, 0.36);
  baseGeo.translate(0, 0.02, 0);
  const orange = new THREE.MeshStandardMaterial({ color: 0xe8590c, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d1d1f, roughness: 0.8 });
  const im = new THREE.InstancedMesh(coneGeo, orange, cones.length);
  const ib = new THREE.InstancedMesh(baseGeo, dark, cones.length);
  const m = new THREE.Matrix4();
  cones.forEach((c, i) => {
    m.makeTranslation(c.x, 0, -c.y);
    im.setMatrixAt(i, m);
    ib.setMatrixAt(i, m);
  });
  im.castShadow = true;
  g.add(im, ib);
  return g;
}

function buildUneven(road: Road, x0: number, x1: number, pal: Palette): THREE.Mesh {
  const W = 7, dx = 0.1, dy = 0.25;
  const nx = Math.min(20000, Math.ceil((x1 - x0) / dx) + 1);
  const ny = Math.ceil(W / dy) + 1;
  const pos = new Float32Array(nx * ny * 3);
  const step = (x1 - x0) / (nx - 1);
  for (let i = 0; i < nx; i++) {
    const x = x0 + i * step;
    for (let j = 0; j < ny; j++) {
      const y = -W / 2 + j * dy;
      const k = 3 * (i * ny + j);
      pos[k] = x; pos[k + 1] = road.height(x, y) + 0.012; pos[k + 2] = -y;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < nx - 1; i++) for (let j = 0; j < ny - 1; j++) {
    const a = i * ny + j, b = a + ny;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: pal.uneven, roughness: 0.95, side: THREE.DoubleSide, flatShading: false }));
  m.receiveShadow = true;
  return m;
}
