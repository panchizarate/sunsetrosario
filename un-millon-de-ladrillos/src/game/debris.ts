import * as THREE from 'three';
import { BUILDINGS, BL, LOT } from './config';
import { merge } from './world';

// Escombros con física simple. Cada pieza "vale" una cantidad exacta de ladrillos:
// la suma de lo que hay en el piso + lo que cargás + lo depositado = ladrillos rotos. Nada se pierde.

export interface Debris {
  id: number;
  kind: 0 | 1; // 0 ladrillo suelto, 1 cascote (varios ladrillos)
  worth: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rot: THREE.Quaternion;
  av: THREE.Vector3;
  scale: number;
  sleeping: boolean;
  rest: number;
  slot: number;
  cell: number;
  claimed: boolean;
  color: number;
}

interface Fly { kind: 0 | 1; scale: number; color: number; from: THREE.Vector3; to: () => THREE.Vector3; t: number; dur: number; rot: THREE.Quaternion }

const CELL = 6;
const GX0 = LOT.x0 - 10, GZ0 = LOT.z0 - 10;
const GW = Math.ceil((LOT.x1 - LOT.x0 + 20) / CELL), GH = Math.ceil((LOT.z1 - LOT.z0 + 30) / CELL);

const BRICK_COLORS = ['#9a4a30', '#a9563a', '#8c3f28', '#b0603f', '#7d3824', '#a24f33'].map((c) => new THREE.Color(c));
const tmpM = new THREE.Matrix4();
const tmpS = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

function brickGrainMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = 'varying vec3 vObj;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vObj = position;');
    sh.fragmentShader = 'varying vec3 vObj;\nfloat dh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\nfloat dn(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(dh(i),dh(i+vec2(1,0)),f.x),mix(dh(i+vec2(0,1)),dh(i+vec2(1,1)),f.x),f.y); }\n' +
      sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float g = dn(vObj.xy * 60.0 + vObj.z * 31.0) * 0.22 + dn(vObj.zy * 140.0) * 0.1;
        diffuseColor.rgb *= 0.82 + g;`);
  };
  return mat;
}

export class DebrisSystem {
  items: Debris[] = [];
  private byId = new Map<number, Debris>();
  private nextId = 1;
  private slots: [Debris[], Debris[]] = [[], []];
  private meshes: THREE.InstancedMesh[] = [];
  private flyMeshes: THREE.InstancedMesh[] = [];
  private flying: Fly[] = [];
  private grid: Debris[][] = [];
  private awake = new Set<Debris>();
  max: [number, number];
  groundWorth = 0;
  onImpact: (d: Debris, speed: number) => void = () => {};

  constructor(scene: THREE.Scene, high: boolean, shadows: boolean) {
    this.max = high ? [2600, 1800] : [1300, 800];
    for (let i = 0; i < GW * GH; i++) this.grid.push([]);
    const brickGeo = new THREE.BoxGeometry(0.23, 0.07, 0.11);
    // montículo de escombros: ~40 ladrillos de tamaño real apilados en cono
    const parts: THREE.BufferGeometry[] = [];
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const nb = high ? 44 : 26;
    for (let i = 0; i < nb; i++) {
      const b = new THREE.BoxGeometry(0.23, 0.07, 0.11);
      b.rotateX((r() - 0.5) * 1.4);
      b.rotateY(r() * 6.28);
      b.rotateZ((r() - 0.5) * 1.4);
      const a = r() * 6.28, rr = Math.sqrt(r()) * 0.75;
      const h = (1 - rr / 0.75) * 0.42 + r() * 0.06;
      b.translate(Math.cos(a) * rr, h, Math.sin(a) * rr * 0.85);
      parts.push(b);
    }
    // pedazos de pared todavía pegados
    for (let i = 0; i < 3; i++) {
      const slab = new THREE.BoxGeometry(0.5 + r() * 0.3, 0.24, 0.12);
      slab.rotateX(-1.2 + r() * 0.3);
      slab.rotateY(r() * 6.28);
      slab.translate((r() - 0.5) * 0.7, 0.12 + r() * 0.1, (r() - 0.5) * 0.6);
      parts.push(slab);
    }
    const chunkGeo = merge(parts);
    const mat = brickGrainMaterial();
    [brickGeo, chunkGeo].forEach((g, k) => {
      const m = new THREE.InstancedMesh(g, mat, this.max[k]);
      m.count = 0;
      m.frustumCulled = false;
      m.castShadow = shadows;
      m.receiveShadow = shadows;
      m.setColorAt(0, BRICK_COLORS[0]);
      scene.add(m);
      this.meshes.push(m);
      const f = new THREE.InstancedMesh(g, mat, 80);
      f.count = 0;
      f.frustumCulled = false;
      f.setColorAt(0, BRICK_COLORS[0]);
      scene.add(f);
      this.flyMeshes.push(f);
    });
  }

  get count() {
    return this.slots[0].length + this.slots[1].length;
  }

  static groundY(x: number, z: number) {
    for (const b of BUILDINGS) {
      const hx = (b.sx * BL) / 2, hz = (b.sz * BL) / 2;
      if (Math.abs(x - b.x) < hx && Math.abs(z - b.z) < hz) return 0.09;
    }
    return 0;
  }

  // ------------------------------------------------------------------ grilla
  private cellOf(x: number, z: number) {
    const cx = Math.max(0, Math.min(GW - 1, Math.floor((x - GX0) / CELL)));
    const cz = Math.max(0, Math.min(GH - 1, Math.floor((z - GZ0) / CELL)));
    return cz * GW + cx;
  }
  private gridMove(d: Debris) {
    const c = this.cellOf(d.pos.x, d.pos.z);
    if (c === d.cell) return;
    if (d.cell >= 0) {
      const arr = this.grid[d.cell];
      const i = arr.indexOf(d);
      if (i >= 0) { arr[i] = arr[arr.length - 1]; arr.pop(); }
    }
    d.cell = c;
    this.grid[c].push(d);
  }

  forEachNear(x: number, z: number, r: number, fn: (d: Debris, dist: number) => void) {
    const x0 = Math.max(0, Math.floor((x - r - GX0) / CELL)), x1 = Math.min(GW - 1, Math.floor((x + r - GX0) / CELL));
    const z0 = Math.max(0, Math.floor((z - r - GZ0) / CELL)), z1 = Math.min(GH - 1, Math.floor((z + r - GZ0) / CELL));
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this.grid[cz * GW + cx];
        for (let i = cell.length - 1; i >= 0; i--) {
          const d = cell[i];
          const dist = Math.hypot(d.pos.x - x, d.pos.z - z);
          if (dist < r) fn(d, dist);
        }
      }
  }

  nearest(x: number, z: number, filter: (d: Debris) => boolean): Debris | null {
    for (let ring = 12; ring <= 240; ring *= 2) {
      let best: Debris | null = null, bd = Infinity;
      this.forEachNear(x, z, ring, (d, dist) => {
        if (d.claimed || !filter(d)) return;
        const s = dist / Math.sqrt(d.worth);
        if (s < bd) { bd = s; best = d; }
      });
      if (best) return best;
    }
    return null;
  }

  // ------------------------------------------------------------------ crear / sacar
  spawn(pos: THREE.Vector3, vel: THREE.Vector3, worth: number, sleeping = false, yaw = Math.random() * 6.28) {
    if (worth <= 0) return;
    this.groundWorth += worth;
    let kind: 0 | 1 = worth === 1 && this.slots[0].length < this.max[0] ? 0 : 1;
    if (kind === 1 && this.slots[1].length >= this.max[1]) {
      // sin lugar: se suma a un cascote cercano (crece) para no perder ladrillos
      let target: Debris | null = null;
      this.forEachNear(pos.x, pos.z, 10, (d) => { if (!target && d.kind === 1) target = d; });
      if (!target) target = this.slots[1][Math.floor(Math.random() * this.slots[1].length)];
      const t = target as Debris;
      t.worth += worth;
      t.scale = Math.min(1.7, 0.75 + Math.cbrt(t.worth) * 0.06);
      this.writeMatrix(t);
      return;
    }
    const d: Debris = {
      id: this.nextId++,
      kind,
      worth,
      pos: pos.clone(),
      vel: vel.clone(),
      rot: new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, yaw, Math.random() * 6)),
      av: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12),
      scale: kind === 0 ? 1 : Math.min(1.7, 0.75 + Math.cbrt(worth) * 0.06),
      sleeping: false,
      rest: 0,
      slot: -1,
      cell: -1,
      claimed: false,
      color: Math.floor(Math.random() * BRICK_COLORS.length),
    };
    if (sleeping) {
      d.rot.setFromAxisAngle(UP, yaw);
      d.pos.y = DebrisSystem.groundY(d.pos.x, d.pos.z) + this.halfH(d);
      d.sleeping = true;
    } else this.awake.add(d);
    const arr = this.slots[kind];
    d.slot = arr.length;
    arr.push(d);
    this.meshes[kind].count = arr.length;
    this.meshes[kind].setColorAt(d.slot, BRICK_COLORS[d.color]);
    if (this.meshes[kind].instanceColor) this.meshes[kind].instanceColor!.needsUpdate = true;
    this.writeMatrix(d);
    this.byId.set(d.id, d);
    this.gridMove(d);
  }

  private halfH(d: Debris) {
    return d.kind === 0 ? 0.035 : 0.0;
  }

  private writeMatrix(d: Debris) {
    tmpM.compose(d.pos, d.rot, tmpS.setScalar(d.scale));
    this.meshes[d.kind].setMatrixAt(d.slot, tmpM);
    this.meshes[d.kind].instanceMatrix.needsUpdate = true;
  }

  isAlive(d: Debris) {
    return this.byId.get(d.id) === d;
  }

  /** Saca una pieza del piso; vuela hacia `to` (jugador, obrero, volquete). */
  take(d: Debris, to: (() => THREE.Vector3) | null) {
    if (!this.isAlive(d)) return 0;
    const arr = this.slots[d.kind];
    const m = this.meshes[d.kind];
    const last = arr.pop()!;
    if (last !== d) {
      arr[d.slot] = last;
      last.slot = d.slot;
      this.writeMatrix(last);
      m.setColorAt(last.slot, BRICK_COLORS[last.color]);
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    m.count = arr.length;
    m.instanceMatrix.needsUpdate = true;
    const cell = this.grid[d.cell];
    const i = cell.indexOf(d);
    if (i >= 0) { cell[i] = cell[cell.length - 1]; cell.pop(); }
    this.byId.delete(d.id);
    this.awake.delete(d);
    this.groundWorth -= d.worth;
    if (to) this.flying.push({ kind: d.kind, scale: d.scale, color: d.color, from: d.pos.clone(), to, t: 0, dur: 0.28, rot: d.rot.clone() });
    return d.worth;
  }

  /** Saca hasta `amount` ladrillos de una pieza: si es un montículo más grande, queda en el piso más chico. */
  takeSome(d: Debris, amount: number, to: (() => THREE.Vector3) | null) {
    if (!this.isAlive(d) || amount <= 0) return 0;
    if (amount >= d.worth) return this.take(d, to);
    d.worth -= amount;
    this.groundWorth -= amount;
    if (d.kind === 1) {
      d.scale = Math.min(1.7, 0.75 + Math.cbrt(d.worth) * 0.06);
      this.writeMatrix(d);
    }
    if (to) this.flying.push({ kind: 0, scale: 1, color: d.color, from: d.pos.clone().add(new THREE.Vector3(0, 0.3, 0)), to, t: 0, dur: 0.28, rot: d.rot.clone() });
    return amount;
  }

  /** Arrastrar una pieza por el piso (aspiradora). */
  drag(d: Debris, x: number, z: number) {
    d.pos.x = x;
    d.pos.z = z;
    this.gridMove(d);
    this.writeMatrix(d);
  }

  // ------------------------------------------------------------------ física
  update(dt: number) {
    for (const d of this.awake) {
      d.vel.y -= 18 * dt;
      d.pos.addScaledVector(d.vel, dt);
      const ang = d.av.length();
      if (ang > 1e-3) {
        tmpQ.setFromAxisAngle(tmpS.copy(d.av).divideScalar(ang), ang * dt);
        d.rot.premultiply(tmpQ);
      }
      const gy = DebrisSystem.groundY(d.pos.x, d.pos.z) + this.halfH(d);
      if (d.pos.y < gy) {
        const impact = -d.vel.y;
        d.pos.y = gy;
        if (impact > 2) this.onImpact(d, impact);
        d.vel.y = impact > 1.5 ? impact * 0.28 : 0;
        d.vel.x *= 0.62;
        d.vel.z *= 0.62;
        d.av.multiplyScalar(0.55);
        // acostarse sobre la cara más grande
        const yaw = new THREE.Euler().setFromQuaternion(d.rot, 'YXZ').y;
        tmpQ.setFromAxisAngle(UP, yaw);
        d.rot.slerp(tmpQ, 0.35);
        if (d.vel.lengthSq() < 0.15 && ang < 1.5) {
          d.rest += dt;
          if (d.rest > 0.25) {
            d.sleeping = true;
            d.rot.copy(tmpQ);
            d.vel.set(0, 0, 0);
            this.awake.delete(d);
          }
        }
      }
      // límites del predio
      d.pos.x = Math.max(LOT.x0 + 0.6, Math.min(LOT.x1 - 0.6, d.pos.x));
      d.pos.z = Math.max(LOT.z0 + 0.6, Math.min(LOT.z1 + 8, d.pos.z));
      this.gridMove(d);
      this.writeMatrix(d);
    }
    // piezas volando hacia quien las juntó
    const counts = [0, 0];
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      if (k >= 1) { this.flying.splice(i, 1); continue; }
      const idx = counts[f.kind]++;
      if (idx >= 80) continue;
      const to = f.to();
      const e = k * k;
      tmpS.lerpVectors(f.from, to, e);
      tmpS.y += Math.sin(k * Math.PI) * 0.6;
      tmpM.compose(tmpS, f.rot, new THREE.Vector3().setScalar(f.scale * (1 - k * 0.6)));
      this.flyMeshes[f.kind].setMatrixAt(idx, tmpM);
      this.flyMeshes[f.kind].setColorAt(idx, BRICK_COLORS[f.color]);
    }
    this.flyMeshes.forEach((m, k) => {
      m.count = Math.min(80, counts[k]);
      if (m.count) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    });
  }

  // ------------------------------------------------------------------ guardado
  serialize(): number[] {
    const out: number[] = [];
    for (const d of this.byId.values()) {
      const yaw = new THREE.Euler().setFromQuaternion(d.rot, 'YXZ').y;
      out.push(Math.round(d.pos.x * 20), Math.round(d.pos.z * 20), d.worth, Math.round(yaw * 100));
    }
    return out;
  }

  restore(data: number[]) {
    for (let i = 0; i + 3 < data.length; i += 4) {
      this.spawn(new THREE.Vector3(data[i] / 20, 0, data[i + 1] / 20), new THREE.Vector3(), data[i + 2], true, data[i + 3] / 100);
    }
  }
}
