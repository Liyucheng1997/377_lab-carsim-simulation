// 程序化生成的车辆三维模型（车身 + 四轮），坐标映射：物理 (x, y, z) → three (x, z, -y)
import * as THREE from 'three';
import type { VehicleParams, BodyStyle } from '../core/params';
import { computeDerived } from '../core/params';

export interface CarFrame {
  X: number; Y: number; yaw: number;
  zs: number; roll: number; pitch: number;
  zu: number[]; steer: number[]; spin: number[];
  fx: number[]; fy: number[]; fz: number[];
  zRoad?: number; // 车辆所在位置路面高度
}

type P2 = [number, number];

// 车身侧视轮廓（归一化：u 车长方向 0=后保险杠，v 高度方向 0..1）
const PROFILES: Record<BodyStyle, { upper: P2[]; cabin: P2[] }> = {
  sedan: {
    upper: [[0, 0.2], [0, 0.52], [0.04, 0.6], [0.3, 0.64], [0.74, 0.66], [0.93, 0.57], [1, 0.5], [1, 0.22], [0.975, 0.14]],
    cabin: [[0.26, 0.64], [0.37, 0.94], [0.62, 0.99], [0.775, 0.66]],
  },
  hatch: {
    upper: [[0, 0.18], [0, 0.62], [0.03, 0.66], [0.7, 0.67], [0.92, 0.56], [1, 0.48], [1, 0.2], [0.975, 0.14]],
    cabin: [[0.02, 0.66], [0.07, 0.96], [0.55, 0.995], [0.72, 0.67]],
  },
  suv: {
    upper: [[0, 0.18], [0, 0.62], [0.02, 0.64], [0.74, 0.66], [0.94, 0.62], [1, 0.56], [1, 0.22], [0.975, 0.14]],
    cabin: [[0.02, 0.64], [0.06, 0.97], [0.62, 0.995], [0.775, 0.66]],
  },
  coupe: {
    upper: [[0, 0.22], [0, 0.56], [0.05, 0.62], [0.7, 0.63], [0.93, 0.48], [1, 0.42], [1, 0.22], [0.975, 0.15]],
    cabin: [[0.2, 0.62], [0.42, 0.97], [0.57, 0.995], [0.745, 0.63]],
  },
};

export class CarRig {
  readonly root = new THREE.Group();
  private pitchG = new THREE.Group();
  private rollG = new THREE.Group();
  private wheels: { g: THREE.Group; steer: THREE.Group; spin: THREE.Group }[] = [];
  private arrowsH: THREE.ArrowHelper[] = [];
  private arrowsV: THREE.ArrowHelper[] = [];
  private xw: number[] = [];
  private yw: number[] = [];
  private r0: number[] = [];
  private kt: number[] = [];
  private fz0: number[] = [];
  private hs: number;
  private materials: THREE.Material[] = [];
  showForces = false;

  constructor(vp: VehicleParams, opts: { ghost?: boolean; color?: string } = {}) {
    const d = computeDerived(vp);
    const B = vp.body;
    this.hs = B.cgHeight;
    const ghost = !!opts.ghost;
    const color = new THREE.Color(opts.color ?? vp.color);
    const mat = <T extends THREE.Material>(m: T): T => {
      if (ghost) { m.transparent = true; m.opacity = 0.35; m.depthWrite = false; }
      this.materials.push(m);
      return m;
    };
    const paint = mat(new THREE.MeshPhysicalMaterial({ color, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.12 }));
    const glass = mat(new THREE.MeshPhysicalMaterial({ color: 0x0d1620, metalness: 0.2, roughness: 0.05, transparent: true, opacity: ghost ? 0.25 : 0.82 }));
    const black = mat(new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.7 }));
    const tireM = mat(new THREE.MeshStandardMaterial({ color: 0x1b1b1d, roughness: 0.9 }));
    const rimM = mat(new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.9, roughness: 0.25 }));
    const discM = mat(new THREE.MeshStandardMaterial({ color: 0x6b6f75, metalness: 0.6, roughness: 0.5 }));
    const headM = mat(new THREE.MeshStandardMaterial({ color: 0xeef4ff, emissive: 0xbfd6ff, emissiveIntensity: 0.6 }));
    const tailM = mat(new THREE.MeshStandardMaterial({ color: 0x8a0d10, emissive: 0xff1a1a, emissiveIntensity: 0.4 }));

    this.root.add(this.pitchG);
    this.pitchG.add(this.rollG);
    this.pitchG.position.set(-d.cgX, B.cgHeight, 0);

    // ---- 车身 ----
    const len = B.length, H = B.height, W = B.width;
    const xFrontAxle = len - B.frontOverhang;
    const xRearAxle = xFrontAxle - B.wheelbase;
    const rF = vp.tireFront.unloadedRadius, rR = vp.tireRear.unloadedRadius;
    const prof = PROFILES[vp.bodyStyle] ?? PROFILES.sedan;
    const shape = new THREE.Shape();
    const up = prof.upper.map(([u, v]) => [u * len, v * H] as P2);
    shape.moveTo(up[0][0], up[0][1]);
    for (let i = 1; i < up.length; i++) shape.lineTo(up[i][0], up[i][1]);
    const yb = up[up.length - 1][1];
    const arch = (xc: number, r: number) => {
      const ra = r + 0.045;
      shape.lineTo(xc + ra, yb);
      shape.lineTo(xc + ra, r);
      shape.absarc(xc, r, ra, 0, Math.PI, false);
      shape.lineTo(xc - ra, yb);
    };
    arch(xFrontAxle, rF);
    arch(xRearAxle, rR);
    shape.lineTo(0.025 * len, yb);
    shape.closePath();
    const bevel = 0.05;
    const bodyGeo = new THREE.ExtrudeGeometry(shape, { depth: W - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 16 });
    bodyGeo.translate(0, 0, -(W - 2 * bevel) / 2);
    const bodyMesh = new THREE.Mesh(bodyGeo, paint);
    bodyMesh.castShadow = !ghost;

    // 车窗（略收窄形成侧围内倾）
    const cab = prof.cabin.map(([u, v]) => [u * len, v * H] as P2);
    const cabShape = new THREE.Shape();
    cabShape.moveTo(cab[0][0], cab[0][1] - 0.02);
    for (let i = 1; i < cab.length; i++) cabShape.lineTo(cab[i][0], cab[i][1] - (i === cab.length - 1 ? 0.02 : 0));
    cabShape.closePath();
    const cw = W * 0.82;
    const cabGeo = new THREE.ExtrudeGeometry(cabShape, { depth: cw - 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
    cabGeo.translate(0, 0, -(cw - 0.06) / 2);
    const cabin = new THREE.Mesh(cabGeo, glass);
    // 车顶
    const [ra, rb] = [cab[1], cab[2]];
    const roofLen = Math.hypot(rb[0] - ra[0], rb[1] - ra[1]) * 0.94;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(roofLen, 0.035, cw * 0.98), paint);
    roof.position.set((ra[0] + rb[0]) / 2, (ra[1] + rb[1]) / 2 + 0.03, 0);
    roof.rotation.z = Math.atan2(rb[1] - ra[1], rb[0] - ra[0]);
    roof.castShadow = !ghost;

    // 灯具与格栅
    const lights = new THREE.Group();
    const fy = up.find((p) => p[0] >= len - 1e-6)?.[1] ?? H * 0.5;
    for (const s of [1, -1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.32), headM);
      hl.position.set(len + 0.03, fy - 0.1, s * (W / 2 - 0.28));
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.36), tailM);
      tl.position.set(-0.03, up[1][1] - 0.08, s * (W / 2 - 0.26));
      lights.add(hl, tl);
    }
    const grille = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.14, W * 0.42), black);
    grille.position.set(len + 0.035, fy - 0.2, 0);
    lights.add(grille);

    const bodyGroup = new THREE.Group();
    bodyGroup.add(bodyMesh, cabin, roof, lights);
    // 车身几何以后保险杠为原点 → 平移到整车质心坐标，再减去簧上质心（侧倾/俯仰支点）
    const xOffset = d.a - xFrontAxle;
    bodyGroup.position.set(xOffset + d.cgX, -B.cgHeight, 0);
    this.rollG.add(bodyGroup);

    // ---- 车轮 ----
    const tf = B.trackFront / 2, tr = B.trackRear / 2;
    this.xw = [d.a, d.a, -d.b, -d.b];
    this.yw = [tf, -tf, tr, -tr];
    const tires = [vp.tireFront, vp.tireFront, vp.tireRear, vp.tireRear];
    const g = 9.80665;
    const m = d.totalMass;
    for (let i = 0; i < 4; i++) {
      const tp = tires[i];
      this.r0.push(tp.unloadedRadius);
      this.kt.push(tp.verticalStiffness);
      this.fz0.push(((i < 2 ? d.b : d.a) / B.wheelbase) * m * g / 2);
      const wg = new THREE.Group();
      const steer = new THREE.Group();
      const spin = new THREE.Group();
      wg.add(steer);
      steer.add(spin);
      const wheel = buildWheel(tp.unloadedRadius, tp.width, tireM, rimM, discM, ghost);
      if (i % 2 === 1) wheel.rotation.y = Math.PI; // 右侧轮辋朝外
      spin.add(wheel);
      wg.position.set(this.xw[i], tp.unloadedRadius, -this.yw[i]);
      this.root.add(wg);
      this.wheels.push({ g: wg, steer, spin });

      const ah = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0x0071e3, 0.18, 0.12);
      const av = new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, 0x248a3d, 0.18, 0.12);
      ah.visible = av.visible = false;
      this.root.add(ah, av);
      this.arrowsH.push(ah);
      this.arrowsV.push(av);
    }
  }

  setFrame(f: CarFrame) {
    const zr = f.zRoad ?? 0;
    this.root.position.set(f.X, zr, -f.Y);
    this.root.rotation.y = f.yaw;
    this.pitchG.position.y = this.hs + f.zs - zr;
    this.pitchG.rotation.z = -f.pitch;
    this.rollG.rotation.x = f.roll;
    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      w.g.position.y = this.r0[i] - this.fz0[i] / this.kt[i] + f.zu[i] - zr;
      w.steer.rotation.y = f.steer[i];
      w.spin.rotation.z = -f.spin[i];
      const ah = this.arrowsH[i], av = this.arrowsV[i];
      if (this.showForces) {
        const c = Math.cos(f.steer[i]), s = Math.sin(f.steer[i]);
        const fxV = f.fx[i] * c - f.fy[i] * s;
        const fyV = f.fx[i] * s + f.fy[i] * c;
        const mag = Math.hypot(fxV, fyV);
        const base = new THREE.Vector3(this.xw[i], f.zu[i] - zr + 0.03, -this.yw[i]);
        ah.position.copy(base);
        if (mag > 30) {
          ah.setDirection(new THREE.Vector3(fxV / mag, 0, -fyV / mag));
          ah.setLength(Math.min(4, mag / 2500), 0.2, 0.13);
          ah.visible = true;
        } else ah.visible = false;
        av.position.copy(base);
        av.setLength(Math.max(0.05, f.fz[i] / 4000), 0.18, 0.12);
        av.visible = f.fz[i] > 30;
      } else {
        ah.visible = av.visible = false;
      }
    }
  }

  dispose() {
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}

function buildWheel(R: number, w: number, tireM: THREE.Material, rimM: THREE.Material, discM: THREE.Material, ghost: boolean): THREE.Group {
  const g = new THREE.Group();
  // 轮胎截面（圆角矩形）绕轴旋转
  const pts: THREE.Vector2[] = [];
  const ri = R * 0.64, hw = w / 2, cr = Math.min(0.045, hw * 0.4);
  pts.push(new THREE.Vector2(ri, -hw));
  pts.push(new THREE.Vector2(R - cr, -hw));
  for (let a = 0; a <= 6; a++) {
    const t = -Math.PI / 2 + (a / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - cr + Math.cos(t) * cr, -hw + cr + Math.sin(t) * cr));
  }
  for (let a = 0; a <= 6; a++) {
    const t = (a / 6) * (Math.PI / 2);
    pts.push(new THREE.Vector2(R - cr + Math.cos(t) * cr, hw - cr + Math.sin(t) * cr));
  }
  pts.push(new THREE.Vector2(ri, hw));
  const tireGeo = new THREE.LatheGeometry(pts, 40);
  tireGeo.rotateX(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, tireM);
  tire.castShadow = !ghost;
  g.add(tire);
  // 轮辋 + 辐条（便于观察车轮转动）
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(ri, ri, w * 0.82, 28, 1, true), rimM);
  rim.rotation.x = Math.PI / 2;
  g.add(rim);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(ri * 0.28, ri * 0.28, 0.03, 16), rimM);
  face.rotation.x = Math.PI / 2;
  face.position.z = -w * 0.32;
  g.add(face);
  for (let k = 0; k < 5; k++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(ri * 0.95, 0.045, 0.025), rimM);
    sp.position.z = -w * 0.32;
    sp.rotation.z = (k / 5) * Math.PI * 2;
    sp.position.x = Math.cos(sp.rotation.z) * ri * 0.48;
    sp.position.y = Math.sin(sp.rotation.z) * ri * 0.48;
    g.add(sp);
  }
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(ri * 0.85, ri * 0.85, 0.028, 24), discM);
  disc.rotation.x = Math.PI / 2;
  disc.position.z = 0.02;
  g.add(disc);
  return g;
}
