import * as THREE from 'three';
import { TRASH_TYPES, TrashType, RIVER, bankDistance, riverCenter, riverHalfWidth, plantDock, PLANT_X } from './config';
import { trashGeometry, trashMaterial } from './models';
import { mulberry32 } from './world';

// Inventario FIJO: cada objeto existe desde el inicio y solo desaparece cuando alguien lo junta.

export interface Piece {
  id: number; // id estable (para el guardado)
  type: TrashType;
  x: number;
  z: number;
  rot: number;
  scale: number;
  color: number;
  slot: number; // índice en el InstancedMesh de su tipo
  pulled: boolean; // lo está atrayendo un imán/aspiradora
  claimed: boolean; // reservado por un ayudante o dron
  cell: number;
}

interface Flying {
  type: TrashType;
  color: number;
  scale: number;
  rot: number;
  x: number; y: number; z: number;
  tx: number; ty: number; tz: number;
  t: number;
  dur: number;
}

const CELL = 10;
const GX0 = RIVER.xMin - 20, GZ0 = -80, GW = Math.ceil((RIVER.xMax - RIVER.xMin + 40) / CELL), GH = Math.ceil(160 / CELL);

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpE = new THREE.Euler();
const tmpC = new THREE.Color();

export class TrashSystem {
  all: Piece[] = []; // por id (null si ya se juntó)
  private byId: (Piece | null)[] = [];
  private slots = new Map<string, Piece[]>();
  private meshes = new Map<string, THREE.InstancedMesh>();
  private flyMeshes = new Map<string, THREE.InstancedMesh>();
  private palettes = new Map<string, THREE.Color[]>();
  private grid: Piece[][] = [];
  private flying: Flying[] = [];
  private bobUniform = { value: 0 };
  remainingKg = 0;
  remainingItems = 0;
  remainingByType = new Map<string, number>();

  constructor(scene: THREE.Scene, high: boolean, collected: Set<number>) {
    for (let i = 0; i < GW * GH; i++) this.grid.push([]);
    for (const tt of TRASH_TYPES) {
      const { geo, colors } = trashGeometry(tt.id, high);
      const mat = trashMaterial(tt.id);
      this.addBob(mat, tt.tier >= 4 ? 0.015 : tt.tier >= 2 ? 0.04 : 0.07);
      const m = new THREE.InstancedMesh(geo, mat, tt.count);
      m.count = 0;
      m.castShadow = high && tt.tier > 0;
      m.receiveShadow = high && tt.tier >= 4;
      m.frustumCulled = false;
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      scene.add(m);
      this.meshes.set(tt.id, m);
      const fm = new THREE.InstancedMesh(geo, mat.clone(), 48);
      fm.count = 0;
      fm.frustumCulled = false;
      fm.setColorAt(0, new THREE.Color(1, 1, 1));
      scene.add(fm);
      this.flyMeshes.set(tt.id, fm);
      this.palettes.set(tt.id, colors.map((c) => new THREE.Color(c)));
      this.slots.set(tt.id, []);
      this.remainingByType.set(tt.id, 0);
    }
    this.generate(collected);
  }

  /** Vaivén en el vertex shader: cero costo de CPU para miles de objetos. */
  private addBob(mat: THREE.Material, amp: number) {
    const u = this.bobUniform;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = u;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
           float ph = ip.x * 0.71 + ip.z * 1.37;
           float tilt = sin(uTime * 1.1 + ph) * ${(amp * 1.6).toFixed(3)};
           float c = cos(tilt), s = sin(tilt);
           transformed.yz = mat2(c, -s, s, c) * transformed.yz;
           transformed.y += sin(uTime * 1.6 + ph) * ${amp.toFixed(3)};
         #endif`,
      );
    };
  }

  // ---------------------------------------------------------------- generación
  private generate(collected: Set<number>) {
    const r = mulberry32(2024);
    const dock = plantDock();
    // manchas de basura (más densas cerca de las orillas y de la planta)
    const patches: { x: number; z: number; r: number }[] = [];
    for (let i = 0; i < 40; i++) {
      const x = RIVER.xMin + 8 + r() * (RIVER.xMax - RIVER.xMin - 16);
      const z = riverCenter(x) + (r() * 2 - 1) * (riverHalfWidth(x) - 6);
      patches.push({ x, z, r: 6 + r() * 12 });
    }
    patches[0] = { x: dock.x + 18, z: riverCenter(dock.x + 18) - 10, r: 10 };
    patches[1] = { x: dock.x - 20, z: riverCenter(dock.x - 20) - 6, r: 9 };

    let id = 0;
    for (const tt of TRASH_TYPES) {
      for (let k = 0; k < tt.count; k++) {
        let x = 0, z = 0;
        for (let tries = 0; tries < 60; tries++) {
          if (tt.id === 'barco') {
            // un barco hundido en cada extremo y dos cerca del puente
            const spots = [-150, 150, 108, -110];
            x = spots[k] + (r() - 0.5) * 6;
            z = riverCenter(x) + (k % 2 ? 1 : -1) * (riverHalfWidth(x) * 0.35);
          } else if (tt.tier === 0 && r() < 0.55) {
            const p = patches[Math.floor(r() * patches.length)];
            const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * p.r;
            x = p.x + Math.cos(a) * rr;
            z = p.z + Math.sin(a) * rr;
          } else {
            // lo pesado tiende a estar lejos de la planta
            let u = r();
            if (tt.far > 0) u = Math.pow(u, 1 - tt.far * 0.75);
            const side = r() < 0.5 ? -1 : 1;
            const span = side < 0 ? PLANT_X - RIVER.xMin : RIVER.xMax - PLANT_X;
            x = PLANT_X + side * (6 + u * (span - 10));
            z = riverCenter(x) + (r() * 2 - 1) * (riverHalfWidth(x) - 3 - tt.radius);
          }
          if (bankDistance(x, z) > -1.5 - tt.radius * 0.8) continue;
          if (Math.hypot(x - dock.x, z - dock.z) < 13 + tt.radius) continue;
          if (x < RIVER.xMin + 3 || x > RIVER.xMax - 3) continue;
          break;
        }
        const pal = this.palettes.get(tt.id)!;
        const piece: Piece = {
          id,
          type: tt,
          x,
          z,
          rot: r() * Math.PI * 2,
          scale: tt.tier === 0 ? 1.1 + r() * 0.3 : tt.tier === 6 ? 1 : 0.9 + r() * 0.25,
          color: Math.floor(r() * pal.length),
          slot: -1,
          pulled: false,
          claimed: false,
          cell: -1,
        };
        this.byId[id] = null;
        if (!collected.has(id)) this.add(piece);
        id++;
      }
    }
    this.all = this.byId.filter(Boolean) as Piece[];
    for (const m of this.meshes.values()) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  get totalIds() {
    return this.byId.length;
  }

  private add(p: Piece) {
    const arr = this.slots.get(p.type.id)!;
    p.slot = arr.length;
    arr.push(p);
    const m = this.meshes.get(p.type.id)!;
    m.count = arr.length;
    this.writeMatrix(p);
    m.setColorAt(p.slot, this.palettes.get(p.type.id)![p.color]);
    this.byId[p.id] = p;
    this.gridInsert(p);
    this.remainingKg += p.type.kg;
    this.remainingItems++;
    this.remainingByType.set(p.type.id, (this.remainingByType.get(p.type.id) ?? 0) + 1);
  }

  private writeMatrix(p: Piece) {
    const m = this.meshes.get(p.type.id)!;
    tmpE.set(0, p.rot, 0);
    tmpQ.setFromEuler(tmpE);
    tmpP.set(p.x, 0.12, p.z);
    tmpS.setScalar(p.scale);
    tmpM.compose(tmpP, tmpQ, tmpS);
    m.setMatrixAt(p.slot, tmpM);
    m.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- grilla espacial
  private cellOf(x: number, z: number) {
    const cx = Math.max(0, Math.min(GW - 1, Math.floor((x - GX0) / CELL)));
    const cz = Math.max(0, Math.min(GH - 1, Math.floor((z - GZ0) / CELL)));
    return cz * GW + cx;
  }
  private gridInsert(p: Piece) {
    p.cell = this.cellOf(p.x, p.z);
    this.grid[p.cell].push(p);
  }
  private gridRemove(p: Piece) {
    const c = this.grid[p.cell];
    const i = c.indexOf(p);
    if (i >= 0) { c[i] = c[c.length - 1]; c.pop(); }
  }

  /** Recorre las piezas cuyo centro está a menos de r (+ su radio) de (x,z). */
  forEachNear(x: number, z: number, r: number, fn: (p: Piece, d: number) => void) {
    const R = r + 8;
    const x0 = Math.max(0, Math.floor((x - R - GX0) / CELL)), x1 = Math.min(GW - 1, Math.floor((x + R - GX0) / CELL));
    const z0 = Math.max(0, Math.floor((z - R - GZ0) / CELL)), z1 = Math.min(GH - 1, Math.floor((z + R - GZ0) / CELL));
    for (let cz = z0; cz <= z1; cz++)
      for (let cx = x0; cx <= x1; cx++) {
        const cell = this.grid[cz * GW + cx];
        for (let i = cell.length - 1; i >= 0; i--) {
          const p = cell[i];
          const d = Math.hypot(p.x - x, p.z - z);
          if (d < r + p.type.radius) fn(p, d);
        }
      }
  }

  /** Mueve una pieza (imán / aspiradora). */
  move(p: Piece, x: number, z: number) {
    p.x = x;
    p.z = z;
    const c = this.cellOf(x, z);
    if (c !== p.cell) {
      this.gridRemove(p);
      p.cell = c;
      this.grid[c].push(p);
    }
    this.writeMatrix(p);
  }

  /** Saca la pieza del río (con animación hacia el destino). */
  collect(p: Piece, tx: number, ty: number, tz: number, dur?: number) {
    if (this.byId[p.id] !== p) return;
    const arr = this.slots.get(p.type.id)!;
    const m = this.meshes.get(p.type.id)!;
    const last = arr.pop()!;
    if (last !== p) {
      arr[p.slot] = last;
      last.slot = p.slot;
      this.writeMatrix(last);
      m.setColorAt(last.slot, this.palettes.get(last.type.id)![last.color]);
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    m.count = arr.length;
    this.gridRemove(p);
    this.byId[p.id] = null;
    this.remainingKg -= p.type.kg;
    this.remainingItems--;
    this.remainingByType.set(p.type.id, (this.remainingByType.get(p.type.id) ?? 1) - 1);
    if (this.remainingItems === 0) this.remainingKg = 0;
    this.flying.push({
      type: p.type, color: p.color, scale: p.scale, rot: p.rot,
      x: p.x, y: 0.12, z: p.z, tx, ty, tz, t: 0, dur: dur ?? 0.35 + p.type.tier * 0.12,
    });
  }

  isAlive(p: Piece) {
    return this.byId[p.id] === p;
  }

  collectedIds(): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.byId.length; i++) if (!this.byId[i]) out.push(i);
    return out;
  }

  nearestCollectable(x: number, z: number, filter: (p: Piece) => boolean): Piece | null {
    // búsqueda en anillos de la grilla
    for (let ring = 15; ring <= 400; ring *= 2) {
      let best: Piece | null = null, bd = Infinity;
      this.forEachNear(x, z, ring, (p, d) => {
        if (p.claimed || p.pulled || !filter(p)) return;
        const score = d / (1 + p.type.tier * 0.5);
        if (score < bd) { bd = score; best = p; }
      });
      if (best) return best;
    }
    return null;
  }

  update(dt: number, time: number) {
    this.bobUniform.value = time;
    // objetos en vuelo hacia el barco / dron
    const counts = new Map<string, number>();
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.t += dt;
      const k = Math.min(1, f.t / f.dur);
      if (k >= 1) { this.flying.splice(i, 1); continue; }
      const m = this.flyMeshes.get(f.type.id)!;
      const idx = counts.get(f.type.id) ?? 0;
      if (idx >= 48) continue;
      counts.set(f.type.id, idx + 1);
      let px: number, py: number, pz: number, spin: number;
      if (f.dur > 1.5) {
        // izado con grúa: sube colgando (70% del tiempo) y después se mueve sobre la bodega
        const up = Math.min(1, k / 0.7), over = Math.max(0, (k - 0.7) / 0.3);
        const e = over * over * (3 - 2 * over);
        const hy = 2 + f.type.radius * 1.2;
        px = f.x + (f.tx - f.x) * e;
        pz = f.z + (f.tz - f.z) * e;
        py = f.y + hy * (up * up * (3 - 2 * up)) - (hy - f.ty + f.y) * e * 0.6;
        spin = Math.sin(f.t * 1.3) * 0.15;
      } else {
        const e = k * k * (3 - 2 * k);
        px = f.x + (f.tx - f.x) * e;
        py = f.y + (f.ty - f.y) * e + Math.sin(k * Math.PI) * (1.5 + f.type.tier * 0.8);
        pz = f.z + (f.tz - f.z) * e;
        spin = k * 3;
      }
      tmpP.set(px, py, pz);
      tmpE.set(f.dur > 1.5 ? Math.sin(f.t * 0.9) * 0.08 : k * 2, f.rot + spin, 0);
      tmpQ.setFromEuler(tmpE);
      tmpS.setScalar(f.scale * (f.dur > 1.5 ? 1 - Math.max(0, k - 0.85) * 4 : 1 - k * 0.7));
      tmpM.compose(tmpP, tmpQ, tmpS);
      m.setMatrixAt(idx, tmpM);
      m.setColorAt(idx, tmpC.copy(this.palettes.get(f.type.id)![f.color]));
    }
    for (const [id, m] of this.flyMeshes) {
      m.count = counts.get(id) ?? 0;
      if (m.count) {
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }
}
