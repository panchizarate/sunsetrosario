import * as THREE from 'three';
import { riverCenter, riverHalfWidth, RIVER, bankDistance } from './config';
import { makeFishGeo, makeBirdGeo } from './models';

// ---------------------------------------------------------------- partículas (salpicaduras + espuma)
export class Particles {
  private n: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private kind: Uint8Array; // 0 gota, 1 espuma
  private geo: THREE.BufferGeometry;
  private cursor = 0;

  constructor(scene: THREE.Scene, count: number) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.kind = new Uint8Array(count);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { uScale: { value: window.innerHeight / 2 } },
      vertexShader: /* glsl */ `
        attribute float aSize; attribute float aAlpha; varying float vA;
        uniform float uScale;
        void main(){
          vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = aSize * uScale / -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA;
        void main(){
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.15, d) * vA;
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(0.97,0.99,1.0), a);
        }`,
    });
    (this as any).mat = mat;
    const pts = new THREE.Points(this.geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 4;
    scene.add(pts);
  }

  resize() {
    (this as any).mat.uniforms.uScale.value = window.innerHeight / 2;
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, kind: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life;
    this.size[i] = size;
    this.kind[i] = kind;
  }

  splash(x: number, z: number, strength = 1) {
    const n = Math.round(10 + 14 * strength);
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (1 + Math.random() * 2.5) * Math.sqrt(strength);
      this.emit(x, 0.1, z, Math.cos(a) * sp, 3 + Math.random() * 4 * Math.sqrt(strength), Math.sin(a) * sp, 0.5 + Math.random() * 0.5, 0.25 + Math.random() * 0.3 * strength, 0);
    }
    for (let k = 0; k < 6; k++) {
      const a = Math.random() * Math.PI * 2;
      this.emit(x, 0.12, z, Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2, 1.2, 0.9 * strength + 0.4, 1);
    }
  }

  foam(x: number, z: number, vx: number, vz: number) {
    this.emit(x + (Math.random() - 0.5) * 0.8, 0.12, z + (Math.random() - 0.5) * 0.8, vx, 0, vz, 1.6 + Math.random(), 0.7 + Math.random() * 0.5, 1);
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const k = this.life[i] / this.maxLife[i];
      if (this.kind[i] === 0) {
        this.vel[i * 3 + 1] -= 14 * dt;
        this.alpha[i] = Math.min(1, k * 2) * 0.95;
        if (this.pos[i * 3 + 1] < 0) this.life[i] = 0;
      } else {
        this.vel[i * 3] *= 1 - dt * 1.5;
        this.vel[i * 3 + 2] *= 1 - dt * 1.5;
        this.size[i] += dt * 0.9;
        this.alpha[i] = k * 0.55;
      }
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    this.geo.attributes.position.needsUpdate = true;
    (this.geo.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ---------------------------------------------------------------- peces que saltan
interface Jump { x: number; z: number; dx: number; dz: number; t: number; dur: number; h: number; active: boolean }
export class Fish {
  private mesh: THREE.InstancedMesh;
  private jumps: Jump[] = [];
  private next = 2;
  onSplash: (x: number, z: number, s: number) => void = () => {};

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(makeFishGeo(), new THREE.MeshStandardMaterial({ color: '#c0d6df', metalness: 0.6, roughness: 0.3 }), 16);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  update(dt: number, clean: number, near: THREE.Vector3) {
    this.next -= dt;
    if (clean > 0.1 && this.next <= 0) {
      this.next = (0.6 + Math.random() * 2.5) / Math.min(3, 0.4 + clean * 3);
      const x = near.x + (Math.random() - 0.5) * 70;
      const z = riverCenter(x) + (Math.random() * 2 - 1) * (riverHalfWidth(x) - 5);
      const a = Math.random() * Math.PI * 2;
      const big = Math.random() < 0.2;
      this.jumps.push({ x, z, dx: Math.cos(a), dz: Math.sin(a), t: 0, dur: big ? 1.1 : 0.75, h: big ? 2.6 : 1.4, active: true });
      this.onSplash(x, z, 0.5);
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (let i = this.jumps.length - 1; i >= 0; i--) {
      const j = this.jumps[i];
      j.t += dt;
      const k = j.t / j.dur;
      if (k >= 1) {
        this.onSplash(j.x + j.dx * 3, j.z + j.dz * 3, 0.6);
        this.jumps.splice(i, 1);
        continue;
      }
      p.set(j.x + j.dx * 3 * k, Math.sin(k * Math.PI) * j.h - 0.2, j.z + j.dz * 3 * k);
      const pitch = Math.cos(k * Math.PI) * 0.9;
      q.setFromEuler(new THREE.Euler(-pitch, Math.atan2(j.dx, j.dz), Math.sin(k * 20) * 0.2, 'YXZ'));
      s.setScalar(j.h > 2 ? 1.5 : 1);
      m.compose(p, q, s);
      if (n < 16) this.mesh.setMatrixAt(n++, m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- pájaros
interface Bird { cx: number; cz: number; r: number; h: number; speed: number; phase: number; flap: number }
export class Birds {
  private mesh: THREE.InstancedMesh;
  private birds: Bird[] = [];

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(makeBirdGeo(), new THREE.MeshLambertMaterial({ color: '#f8f9fa', side: THREE.DoubleSide }), 40);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    for (let i = 0; i < 40; i++) {
      const cx = (Math.random() - 0.5) * 260;
      this.birds.push({
        cx,
        cz: riverCenter(cx) + (Math.random() - 0.5) * 50,
        r: 10 + Math.random() * 30,
        h: 9 + Math.random() * 14,
        speed: (0.25 + Math.random() * 0.3) * (Math.random() < 0.5 ? -1 : 1),
        phase: Math.random() * 10,
        flap: 6 + Math.random() * 4,
      });
    }
  }

  update(t: number, clean: number) {
    const n = Math.floor(Math.max(0, (clean - 0.4) / 0.6) * 40);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const b = this.birds[i];
      const a = t * b.speed + b.phase;
      p.set(b.cx + Math.cos(a) * b.r, b.h + Math.sin(t * 0.7 + b.phase) * 1.5, b.cz + Math.sin(a) * b.r);
      const heading = Math.atan2(-Math.sin(a) * Math.sign(b.speed), Math.cos(a) * Math.sign(b.speed));
      q.setFromEuler(new THREE.Euler(0, heading, Math.sign(b.speed) * 0.3));
      const f = Math.sin(t * b.flap + b.phase);
      s.set(0.9, f * 1.2, 0.9);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- barreras flotantes
export const BARRIER_XS = [-140, -95, -60, 35, 70, 140, -120, 100];
export class Barriers {
  private mesh: THREE.InstancedMesh;
  private perBarrier = 22;
  private shown = -1;

  constructor(scene: THREE.Scene) {
    const g = new THREE.CylinderGeometry(0.35, 0.35, 1.4, 8);
    g.rotateX(Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(g, new THREE.MeshStandardMaterial({ color: '#ffc300', roughness: 0.5 }), BARRIER_XS.length * this.perBarrier);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** Las barreras salen desde la orilla norte, cubriendo ~35% del ancho (no bloquean el paso). */
  positions(index: number): THREE.Vector3[] {
    const x0 = BARRIER_XS[index];
    const out: THREE.Vector3[] = [];
    const hw = riverHalfWidth(x0);
    const side = index % 2 === 0 ? 1 : -1;
    for (let k = 0; k < this.perBarrier; k++) {
      const f = k / (this.perBarrier - 1);
      const z = riverCenter(x0) + side * (hw - 1 - f * hw * 0.7);
      const x = x0 + f * 6;
      out.push(new THREE.Vector3(x, 0, z));
    }
    return out;
  }

  update(t: number, level: number) {
    const count = Math.min(BARRIER_XS.length, level === 0 ? 0 : Math.ceil(level / 2.25));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    let n = 0;
    for (let b = 0; b < count; b++) {
      const pts = this.positions(b);
      for (let k = 0; k < pts.length; k++) {
        const p = pts[k];
        const next = pts[Math.min(k + 1, pts.length - 1)];
        const prev = pts[Math.max(k - 1, 0)];
        const yaw = Math.atan2(next.x - prev.x, next.z - prev.z);
        q.setFromEuler(new THREE.Euler(0, yaw, Math.sin(t * 2 + k) * 0.1));
        m.compose(new THREE.Vector3(p.x, 0.05 + Math.sin(t * 1.6 + k * 0.6) * 0.06, p.z), q, new THREE.Vector3(1, 1, 1));
        this.mesh.setMatrixAt(n++, m);
      }
    }
    this.shown = count;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  get visibleCount() {
    return this.shown;
  }
}

export function clampToRiver(p: { x: number; z: number }, margin: number) {
  p.x = Math.max(RIVER.xMin, Math.min(RIVER.xMax, p.x));
  const d = bankDistance(p.x, p.z);
  if (d > -margin) {
    const c = riverCenter(p.x);
    const hw = riverHalfWidth(p.x) - margin;
    p.z = c + Math.sign(p.z - c) * hw;
  }
}
