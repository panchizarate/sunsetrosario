import * as THREE from 'three';
import { TRASH_TYPES, TrashType, RIVER, bankDistance, riverCenter, riverHalfWidth, plantDock, TOTAL_KG } from './config';
import { trashGeometry } from './models';

export interface Piece {
  id: number;
  type: TrashType;
  x: number;
  z: number;
  rot: number;
  phase: number;
  scale: number;
  color: number;
  state: 'float' | 'collect' | 'sink' | 'spawn';
  t: number; // timer de animación
  tx: number; // destino de animación
  tz: number;
  claimed: boolean;
}

interface Patch {
  x: number;
  z: number;
  r: number;
}

const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpS = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpC = new THREE.Color();

export class TrashSystem {
  pieces: Piece[] = [];
  private meshes = new Map<string, THREE.InstancedMesh>();
  private palettes = new Map<string, THREE.Color[]>();
  private patches: Patch[] = [];
  private nextId = 1;
  private maxTotal: number;
  private typeMax = new Map<string, number>();
  private spawnAcc = 0;
  private filled = false;

  constructor(scene: THREE.Scene, high: boolean) {
    this.maxTotal = high ? 950 : 600;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.1 });
    for (const tt of TRASH_TYPES) {
      const { geo, colors } = trashGeometry(tt.id);
      const cap = Math.max(4, Math.round(tt.max * (high ? 1 : 0.6)));
      this.typeMax.set(tt.id, cap);
      const m = new THREE.InstancedMesh(geo, mat, cap + 8);
      m.count = 0;
      m.castShadow = high && tt.tier > 0;
      m.frustumCulled = false;
      m.renderOrder = 0;
      // forzar creación del atributo de color
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      scene.add(m);
      this.meshes.set(tt.id, m);
      this.palettes.set(tt.id, colors.map((c) => new THREE.Color(c)));
    }
    for (let i = 0; i < 26; i++) this.patches.push(this.newPatch(true));
    // mancha inicial cerca de la planta para que el primer viaje sea corto
    const d = plantDock();
    this.patches[0] = { x: d.x + 16, z: riverCenter(d.x + 16) - 8, r: 9 };
    this.patches[1] = { x: d.x - 26, z: riverCenter(d.x - 26) + 4, r: 9 };
  }

  private newPatch(anywhere: boolean): Patch {
    const x = anywhere ? RIVER.xMin + Math.random() * (RIVER.xMax - RIVER.xMin) : RIVER.xMin - 5;
    const hw = riverHalfWidth(x) - 6;
    const z = riverCenter(x) + (Math.random() * 2 - 1) * hw;
    return { x, z, r: 5 + Math.random() * 9 };
  }

  private pickType(): TrashType | null {
    let total = 0;
    const counts = new Map<string, number>();
    for (const p of this.pieces) counts.set(p.type.id, (counts.get(p.type.id) ?? 0) + 1);
    const avail = TRASH_TYPES.filter((t) => (counts.get(t.id) ?? 0) < (this.typeMax.get(t.id) ?? 0));
    for (const t of avail) total += t.weight;
    let r = Math.random() * total;
    for (const t of avail) {
      r -= t.weight;
      if (r <= 0) return t;
    }
    return avail[0] ?? null;
  }

  private spawnPiece(fromUpstream: boolean) {
    const type = this.pickType();
    if (!type) return;
    let x = 0, z = 0;
    for (let tries = 0; tries < 8; tries++) {
      // mitad en manchas, mitad dispersa por todo el río
      const scatter = Math.random() < 0.5;
      const patch = scatter
        ? { ...this.newPatch(true), r: 0 }
        : fromUpstream && Math.random() < 0.3 ? this.newPatch(false) : this.patches[Math.floor(Math.random() * this.patches.length)];
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * patch.r * (type.tier > 2 ? 0.5 : 1);
      x = patch.x + Math.cos(a) * rr;
      z = patch.z + Math.sin(a) * rr;
      if (bankDistance(x, z) < -2 - type.radius) break;
    }
    if (bankDistance(x, z) > -2) z = riverCenter(x);
    const dock = plantDock();
    if (Math.hypot(x - dock.x, z - dock.z) < 12) return;
    const pal = this.palettes.get(type.id)!;
    this.pieces.push({
      id: this.nextId++,
      type,
      x,
      z,
      rot: Math.random() * Math.PI * 2,
      phase: Math.random() * 100,
      scale: 0.85 + Math.random() * 0.35,
      color: Math.floor(Math.random() * pal.length),
      state: 'spawn',
      t: 0,
      tx: 0,
      tz: 0,
      claimed: false,
    });
  }

  /** Cantidad visible objetivo según lo que queda en el río. */
  targetCount(remaining: number) {
    if (remaining <= 0) return 0;
    const f = remaining / TOTAL_KG;
    return Math.max(18, Math.round(this.maxTotal * (0.1 + 0.9 * Math.pow(f, 0.65))));
  }

  update(dt: number, time: number, remaining: number) {
    // mover parches con la corriente
    for (const p of this.patches) {
      p.x += RIVER.flow * 0.35 * dt;
      if (p.x > RIVER.xMax + 10) Object.assign(p, this.newPatch(false));
      // los parches viajan despacio (más lento que la corriente visual)
    }
    // spawn gradual hasta el objetivo (la primera vez, llenado instantáneo)
    const target = this.targetCount(remaining);
    if (!this.filled) {
      this.filled = true;
      for (let i = 0; i < target; i++) this.spawnPiece(false);
      for (const p of this.pieces) { p.state = 'float'; p.t = 1; }
    }
    const floating = this.pieces.filter((p) => p.state !== 'collect' && p.state !== 'sink').length;
    if (floating < target) {
      this.spawnAcc += dt * (floating < target * 0.5 ? 200 : 6);
      while (this.spawnAcc >= 1 && this.pieces.length < this.maxTotal + 40) {
        this.spawnPiece(floating > 20);
        this.spawnAcc -= 1;
      }
    } else this.spawnAcc = 0;
    // río limpio: lo que queda se hunde/desaparece
    if (remaining <= 0) for (const p of this.pieces) if (p.state === 'float' || p.state === 'spawn') this.sink(p);

    // simular
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.t += dt;
      if (p.state === 'float' || p.state === 'spawn') {
        if (p.state === 'spawn' && p.t > 0.8) p.state = 'float';
        const slow = 0.35 / (1 + p.type.tier * 0.7);
        p.x += RIVER.flow * slow * dt;
        p.z += Math.sin(time * 0.3 + p.phase) * 0.15 * dt;
        p.rot += Math.sin(p.phase + time * 0.2) * 0.1 * dt;
        const bd = bankDistance(p.x, p.z);
        if (bd > -1.5 - p.type.radius) p.z += (riverCenter(p.x) - p.z) * 0.6 * dt;
        if (p.x > RIVER.xMax + 15) {
          // vuelve a entrar río arriba (el río sigue sucio)
          p.x = RIVER.xMin - 10;
          p.z = riverCenter(p.x) + (Math.random() * 2 - 1) * (riverHalfWidth(p.x) - 6);
          p.claimed = false;
        }
      } else if (p.state === 'collect') {
        const k = Math.min(1, p.t / 0.35);
        p.x += (p.tx - p.x) * Math.min(1, dt * 14);
        p.z += (p.tz - p.z) * Math.min(1, dt * 14);
        if (k >= 1) this.pieces.splice(i, 1);
      } else if (p.state === 'sink') {
        if (p.t > 1.6) this.pieces.splice(i, 1);
      }
    }
    this.writeInstances(time);
  }

  sink(p: Piece) {
    p.state = 'sink';
    p.t = 0;
  }

  collect(p: Piece, tx: number, tz: number) {
    p.state = 'collect';
    p.t = 0;
    p.tx = tx;
    p.tz = tz;
  }

  private writeInstances(time: number) {
    const counts = new Map<string, number>();
    for (const p of this.pieces) {
      const m = this.meshes.get(p.type.id)!;
      const idx = counts.get(p.type.id) ?? 0;
      if (idx >= m.instanceMatrix.count) continue;
      counts.set(p.type.id, idx + 1);
      const bob = Math.sin(time * 1.6 + p.phase) * 0.06 * (1 / (1 + p.type.tier));
      let y = bob + 0.16 + (p.type.tier === 0 ? 0.04 : 0), s = p.scale * (p.type.tier === 0 ? 1.7 : p.type.tier === 1 ? 1.25 : 1);
      if (p.state === 'spawn') {
        const k = Math.min(1, p.t / 0.8);
        y += -1.2 * (1 - k);
        s *= 0.4 + 0.6 * k;
      } else if (p.state === 'collect') {
        const k = Math.min(1, p.t / 0.35);
        y += Math.sin(k * Math.PI) * (1.6 + p.type.tier * 0.6);
        s *= 1 - k * 0.85;
      } else if (p.state === 'sink') {
        const k = Math.min(1, p.t / 1.6);
        y -= k * 2;
        s *= 1 - k;
      }
      tmpE.set(Math.sin(time + p.phase) * 0.12, p.rot, Math.cos(time * 0.8 + p.phase) * 0.1);
      tmpQ.setFromEuler(tmpE);
      tmpP.set(p.x, y, p.z);
      tmpS.setScalar(s);
      tmpM.compose(tmpP, tmpQ, tmpS);
      m.setMatrixAt(idx, tmpM);
      const pal = this.palettes.get(p.type.id)!;
      m.setColorAt(idx, tmpC.copy(pal[p.color]));
    }
    for (const [id, m] of this.meshes) {
      m.count = counts.get(id) ?? 0;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  /** Piezas flotantes dentro de un radio (para recolectar). */
  query(x: number, z: number, r: number, out: Piece[]) {
    out.length = 0;
    for (const p of this.pieces) {
      if (p.state !== 'float') continue;
      const dx = p.x - x, dz = p.z - z;
      const rr = r + p.type.radius;
      if (dx * dx + dz * dz < rr * rr) out.push(p);
    }
    return out;
  }

  nearestCollectable(x: number, z: number, tier: number, avoidClaimed = true): Piece | null {
    let best: Piece | null = null, bd = Infinity;
    for (const p of this.pieces) {
      if (p.state !== 'float' || p.type.tier > tier || (avoidClaimed && p.claimed)) continue;
      if (p.x < RIVER.xMin + 3 || p.x > RIVER.xMax - 3) continue;
      // preferir piezas pesadas (valen más)
      const d = Math.hypot(p.x - x, p.z - z) / (1 + p.type.tier * 0.6);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
}
