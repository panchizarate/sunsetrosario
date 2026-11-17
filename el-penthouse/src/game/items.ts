import * as THREE from 'three';
import { CATEGORIES, Category, ItemKind, ZONES, ZoneId, MEZZ } from './config';
import { itemGeometry, PICK_RADIUS } from './itemgeo';
import type { House, Section } from './house';
import { NOISE } from './materials';

export type ItemState = 'floor' | 'held' | 'placed' | 'flying';

export interface Item {
  id: number;
  kind: ItemKind;
  variant: number;
  cat: Category;
  zone: ZoneId;
  state: ItemState;
  pos: THREE.Vector3; // centro aproximado (para apuntar)
  floor: THREE.Matrix4;
  mesh: THREE.InstancedMesh;
  index: number;
  slot: number;
  section: Section | null;
  cell: number;
}

interface Flight { item: Item; from: THREE.Matrix4; to: THREE.Matrix4 | null; toFn: (() => THREE.Vector3) | null; t: number; dur: number; done: () => void }

const tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP2 = new THREE.Vector3(), tmpQ2 = new THREE.Quaternion(), tmpS2 = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

/** Inyecta en un material: color por instancia con detalles por zona del objeto + brillo del escáner. */
function itemMaterial(kind: ItemKind, variant: number, base: THREE.MeshStandardMaterialParameters, extra = '', physical = false): THREE.MeshStandardMaterial {
  const mat = physical ? new THREE.MeshPhysicalMaterial(base as THREE.MeshPhysicalMaterialParameters) : new THREE.MeshStandardMaterial(base);
  const color2 = new THREE.Color(CATEGORIES.find((c) => c.kind === kind)!.variants[variant].color2 ?? '#ffffff');
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = ITEM_TIME;
    sh.uniforms.uColor2 = { value: color2 };
    sh.vertexShader = 'attribute float aHi;\nvarying float vHi;\nvarying vec3 vOP;\nvarying vec3 vON;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n vHi = aHi; vOP = position; vON = normal;',
    );
    sh.fragmentShader = 'uniform float uTime;\nuniform vec3 uColor2;\nvarying float vHi;\nvarying vec3 vOP;\nvarying vec3 vON;\n' + NOISE + '\nfloat iRough = -1.0;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n${extra}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (iRough >= 0.0) roughnessFactor = iRough;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(0.35, 0.9, 1.0) * vHi * (0.55 + 0.45 * sin(uTime * 6.0));');
  };
  mat.customProgramCacheKey = () => kind + variant + (physical ? 'p' : '');
  return mat;
}
export const ITEM_TIME = { value: 0 };

function materialFor(kind: ItemKind, variant: number): THREE.MeshStandardMaterial {
  switch (kind) {
    case 'libro':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.6 }, `
        vec3 cover = diffuseColor.rgb;
        if (vON.z < -0.5) { // lomo
          float band = smoothstep(0.004, 0.0, abs(abs(vOP.y - 0.135) - 0.09)) + smoothstep(0.003, 0.0, abs(vOP.y - 0.2));
          diffuseColor.rgb = mix(cover * 0.85, vec3(0.85, 0.66, 0.3), band);
        } else if (vON.y > 0.5 || vON.y < -0.5 || vON.z > 0.5) {
          diffuseColor.rgb = vec3(0.86, 0.82, 0.72) * (0.9 + 0.1 * sin(vOP.x * 900.0));
        }`);
    case 'almohadon':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.9, sheen: 1, sheenRoughness: 0.4, sheenColor: new THREE.Color(0.8, 0.8, 0.8) } as any, `
        diffuseColor.rgb *= 0.88 + 0.12 * pn2(vOP.xy * 120.0);`, true);
    case 'jarron':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.25, metalness: 0 }, `
        diffuseColor.rgb *= 0.9 + 0.1 * smoothstep(0.4, 0.6, pn2(vec2(atan(vOP.z, vOP.x) * 2.0, vOP.y * 20.0)));`);
    case 'escultura':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.25, metalness: 1 });
    case 'vela':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.55 }, `
        if (vOP.y < 0.031) { diffuseColor.rgb = vec3(0.75, 0.58, 0.32); iRough = 0.25; }
        if (vOP.y > 0.16) diffuseColor.rgb = vec3(0.05);`);
    case 'botella':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88 }, `
        float lab = step(0.06, vOP.y) * step(vOP.y, ${variant === 1 ? '0.14' : '0.15'});
        float cap = step(${variant === 0 || variant === 3 ? '0.27' : '0.25'}, vOP.y);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.89, 0.8), lab);
        diffuseColor.rgb = mix(diffuseColor.rgb, ${variant === 3 ? 'vec3(0.8, 0.65, 0.3)' : variant === 0 ? 'vec3(0.35, 0.05, 0.08)' : 'vec3(0.12)'}, cap);
        diffuseColor.a = max(diffuseColor.a, max(lab, cap));
        if (lab > 0.5) iRough = 0.6;`);
    case 'copa':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false });
    case 'prenda':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide }, `
        if (vOP.y > -0.035) { diffuseColor.rgb = vec3(0.75); iRough = 0.2; }
        else diffuseColor.rgb *= 0.85 + 0.15 * pn2(vOP.xy * 140.0);`);
    case 'zapatilla':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.5 }, `
        if (vOP.y < 0.034) { diffuseColor.rgb = vec3(0.93, 0.92, 0.9); iRough = 0.7; }
        else if (vOP.y > 0.112) diffuseColor.rgb = vec3(0.95);
        else {
          float stripe = smoothstep(0.012, 0.0, abs(vOP.y - 0.06 - vOP.z * 0.25)) * step(0.035, abs(vOP.x));
          float heel = step(0.1, vOP.z);
          diffuseColor.rgb = mix(diffuseColor.rgb, uColor2, max(stripe, heel * 0.9));
        }`);
    case 'gorra':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.85 }, `
        if (vOP.y < 0.012) diffuseColor.rgb *= 0.7;
        diffuseColor.rgb *= 0.9 + 0.1 * pn2(vOP.xz * 160.0);`);
    case 'figura':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.35, metalness: 0.05 }, `
        if (vOP.y < 0.015) { diffuseColor.rgb = vec3(0.06); iRough = 0.3; }`);
  }
}

/** Colores reales de cada objeto (con variación dentro de su grupo). */
function instanceColor(cat: Category, variant: number, r: () => number): THREE.Color {
  const base = new THREE.Color(cat.variants[variant].color);
  if (cat.kind === 'jarron') return new THREE.Color(['#e9e4da', '#c8734f', '#8fa58a', '#2d3a4a', '#d9c39a'][Math.floor(r() * 5)]);
  if (cat.kind === 'escultura') return new THREE.Color(['#c9a45c', '#b87333', '#d9d9d9', '#2a2a2a'][Math.floor(r() * 4)]);
  if (cat.kind === 'vela') return new THREE.Color(['#f3eadb', '#e8d5c0', '#2b2b2b', '#c9a2a2'][Math.floor(r() * 4)]);
  if (cat.kind === 'figura') return base.clone().offsetHSL((r() - 0.5) * 0.08, 0, (r() - 0.5) * 0.15);
  return base.clone().offsetHSL(0, 0, (r() - 0.5) * 0.08);
}

export class ItemSystem {
  items: Item[] = [];
  meshes: THREE.InstancedMesh[] = [];
  private grid = new Map<string, Item[]>();
  private flights: Flight[] = [];
  private hiAttr = new Map<THREE.InstancedMesh, THREE.InstancedBufferAttribute>();
  displayMats = new Map<string, THREE.Material>();
  geos = new Map<string, THREE.BufferGeometry>();

  constructor(scene: THREE.Scene, private house: House, shadows: boolean) {
    let seed = 777;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    let id = 0;
    for (const cat of CATEGORIES) {
      for (let v = 0; v < cat.variants.length; v++) {
        const key = cat.kind + v;
        const geo = itemGeometry(cat.kind, cat.kind === 'botella' || cat.kind === 'copa' || cat.kind === 'figura' ? v : 0);
        this.geos.set(key, geo);
        const mat = materialFor(cat.kind, v);
        this.displayMats.set(key, mat);
        const mesh = new THREE.InstancedMesh(geo, mat, cat.perVariant);
        mesh.frustumCulled = false;
        mesh.castShadow = shadows && cat.kind !== 'copa';
        mesh.receiveShadow = shadows;
        const hi = new THREE.InstancedBufferAttribute(new Float32Array(cat.perVariant), 1);
        geo.setAttribute('aHi', hi);
        this.hiAttr.set(mesh, hi);
        for (let k = 0; k < cat.perVariant; k++) {
          mesh.setColorAt(k, instanceColor(cat, v, r));
          const it: Item = { id: id++, kind: cat.kind, variant: v, cat, zone: cat.zone, state: 'floor', pos: new THREE.Vector3(), floor: new THREE.Matrix4(), mesh, index: k, slot: -1, section: null, cell: 0 };
          this.scatter(it, r);
          this.items.push(it);
        }
        scene.add(mesh);
        this.meshes.push(mesh);
      }
    }
    for (const it of this.items) this.gridAdd(it);
  }

  // ------------------------------------------------------------------ dispersar por el piso
  private free(x: number, y: number, z: number, rad: number) {
    for (const c of this.house.colliders) {
      const b = c.box;
      if (y + 0.3 < b.min.y || y > b.max.y) continue;
      if (x > b.min.x - rad && x < b.max.x + rad && z > b.min.z - rad && z < b.max.z + rad) return false;
    }
    for (const s of this.house.sections) {
      const b = s.box;
      if (y + 0.3 < b.min.y || y > b.max.y) continue;
      if (x > b.min.x - rad && x < b.max.x + rad && z > b.min.z - rad && z < b.max.z + rad) return false;
    }
    return true;
  }

  private scatter(it: Item, r: () => number) {
    const zone = ZONES.find((z) => z.id === it.zone)!;
    const y = zone.level === 1 ? MEZZ : 0;
    const [x0, x1, z0, z1] = zone.rect;
    let x = 0, z = 0;
    for (let tries = 0; tries < 80; tries++) {
      // amontonado: la mitad cerca de "pilas" del desorden de la fiesta
      x = x0 + 0.6 + r() * (x1 - x0 - 1.2);
      z = z0 + 0.6 + r() * (z1 - z0 - 1.2);
      if (this.free(x, y, z, 0.35)) break;
    }
    const yaw = r() * Math.PI * 2;
    let rx = 0, rz = 0, lift = 0;
    switch (it.kind) {
      case 'libro': rz = Math.PI / 2; lift = 0.025; break; // acostado
      case 'botella': rx = Math.PI / 2; lift = 0.04; break;
      case 'copa': if (r() < 0.6) { rz = Math.PI / 2; lift = 0.04; } break;
      case 'prenda': rx = -Math.PI / 2; lift = 0.02; break;
      case 'zapatilla': rz = r() < 0.3 ? Math.PI / 2 : 0; lift = rz ? 0.055 : 0; break;
      case 'gorra': if (r() < 0.4) { rx = Math.PI; lift = 0.1; } break;
      case 'figura': if (r() < 0.6) { rz = Math.PI / 2; lift = 0.03; } break;
      case 'jarron': case 'vela': case 'escultura': if (r() < 0.5) { rz = Math.PI / 2; lift = 0.05; } break;
      case 'almohadon': rx = -Math.PI / 2; break;
    }
    // pilas de libros/ropa: a veces apilados
    it.floor.compose(new THREE.Vector3(x, y + lift, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, yaw, rz, 'YXZ')), new THREE.Vector3(1, 1, 1));
    it.pos.set(x, y + 0.08, z);
    it.mesh.setMatrixAt(it.index, it.floor);
  }

  // ------------------------------------------------------------------ grilla para apuntar
  private key(x: number, z: number, lvl: number) {
    return `${Math.floor(x / 2)}|${Math.floor(z / 2)}|${lvl}`;
  }
  private gridAdd(it: Item) {
    const k = this.key(it.pos.x, it.pos.z, it.pos.y > 2 ? 1 : 0);
    const a = this.grid.get(k) ?? [];
    a.push(it);
    this.grid.set(k, a);
  }
  private gridRemove(it: Item) {
    const k = this.key(it.pos.x, it.pos.z, it.pos.y > 2 ? 1 : 0);
    const a = this.grid.get(k);
    if (!a) return;
    const i = a.indexOf(it);
    if (i >= 0) a.splice(i, 1);
  }
  near(x: number, z: number, lvl: number, r: number, fn: (it: Item) => void) {
    for (let gx = Math.floor((x - r) / 2); gx <= Math.floor((x + r) / 2); gx++)
      for (let gz = Math.floor((z - r) / 2); gz <= Math.floor((z + r) / 2); gz++) {
        const a = this.grid.get(`${gx}|${gz}|${lvl}`);
        if (a) for (const it of a) if (it.state === 'floor' && Math.hypot(it.pos.x - x, it.pos.z - z) < r) fn(it);
      }
  }

  /** Objeto del piso bajo la mira. */
  pick(ray: THREE.Ray, maxDist: number, allowed: (z: ZoneId) => boolean): Item | null {
    const lvl = ray.origin.y > MEZZ ? 1 : 0;
    let best: Item | null = null, bd = Infinity;
    const end = ray.at(maxDist, new THREE.Vector3());
    const cx = (ray.origin.x + end.x) / 2, cz = (ray.origin.z + end.z) / 2;
    this.near(cx, cz, lvl, maxDist / 2 + 1, (it) => {
      if (!allowed(it.zone)) return;
      const d = ray.distanceSqToPoint(it.pos);
      const rr = PICK_RADIUS[it.kind];
      if (d > rr * rr) return;
      const t = tmpP.copy(it.pos).sub(ray.origin).dot(ray.direction);
      if (t < 0 || t > maxDist) return;
      if (t < bd) { bd = t; best = it; }
    });
    return best;
  }

  /** Saca un objeto del piso (pasa a la mano). */
  take(it: Item, to: () => THREE.Vector3) {
    if (it.state !== 'floor') return;
    this.gridRemove(it);
    it.state = 'flying';
    this.flights.push({ item: it, from: it.floor.clone(), to: null, toFn: to, t: 0, dur: 0.22, done: () => { it.state = 'held'; it.mesh.setMatrixAt(it.index, ZERO); it.mesh.instanceMatrix.needsUpdate = true; } });
  }

  /** Lleva un objeto a su lugar exacto en la sección. */
  place(it: Item, sec: Section, from: THREE.Vector3, delay = 0, onDone: () => void = () => {}) {
    const slot = sec.filled++;
    it.section = sec;
    it.slot = slot;
    it.state = 'flying';
    const fromM = new THREE.Matrix4().compose(from, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
    this.flights.push({ item: it, from: fromM, to: sec.slots[slot], toFn: null, t: -delay, dur: 0.38, done: () => { it.state = 'placed'; it.mesh.setMatrixAt(it.index, sec.slots[slot]); it.mesh.instanceMatrix.needsUpdate = true; onDone(); } });
  }

  /** Un robot ayudante lo lleva directo desde el piso. */
  placeFromFloor(it: Item, sec: Section, onDone: () => void) {
    this.gridRemove(it);
    const slot = sec.filled++;
    it.section = sec;
    it.slot = slot;
    it.state = 'flying';
    this.flights.push({ item: it, from: it.floor.clone(), to: sec.slots[slot], toFn: null, t: 0, dur: 1.1, done: () => { it.state = 'placed'; it.mesh.setMatrixAt(it.index, sec.slots[slot]); it.mesh.instanceMatrix.needsUpdate = true; onDone(); } });
  }

  setHighlight(pred: ((it: Item) => boolean) | null) {
    for (const [mesh, attr] of this.hiAttr) {
      let changed = false;
      for (let k = 0; k < attr.count; k++) attr.setX(k, 0);
      if (pred) for (const it of this.items) if (it.mesh === mesh && it.state === 'floor' && pred(it)) { attr.setX(it.index, 1); changed = true; }
      attr.needsUpdate = true;
      void changed;
    }
  }

  update(dt: number, t: number) {
    ITEM_TIME.value = t;
    const touched = new Set<THREE.InstancedMesh>();
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt;
      if (f.t < 0) continue;
      const k = Math.min(1, f.t / f.dur);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      f.from.decompose(tmpP, tmpQ, tmpS);
      if (f.to) f.to.decompose(tmpP2, tmpQ2, tmpS2);
      else { tmpP2.copy(f.toFn!()); tmpQ2.copy(tmpQ); tmpS2.set(0.4, 0.4, 0.4); }
      const p = tmpP.clone().lerp(tmpP2, e);
      p.y += Math.sin(k * Math.PI) * (f.to ? 0.5 : 0.15);
      const q = tmpQ.clone().slerp(tmpQ2, e);
      const s = tmpS.clone().lerp(tmpS2, e);
      f.item.mesh.setMatrixAt(f.item.index, new THREE.Matrix4().compose(p, q, s));
      touched.add(f.item.mesh);
      if (k >= 1) {
        this.flights.splice(i, 1);
        f.done();
      }
    }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------------ guardado
  serialize(): number[] {
    // por objeto: 0 piso, 1 en mano, 2 ubicado (con su lugar)
    const out: number[] = [];
    for (const it of this.items) out.push(it.state === 'placed' ? 2 : it.state === 'held' || it.state === 'flying' ? 1 : 0);
    return out;
  }

  restore(states: number[], held: number[]) {
    if (!states || states.length !== this.items.length) return;
    // ubicados: se vuelven a llenar las secciones en orden
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (states[i] === 2) {
        const sec = this.house.sections.find((s) => s.kind === it.kind && s.variant === it.variant)!;
        const slot = sec.filled++;
        it.section = sec;
        it.slot = slot;
        it.state = 'placed';
        this.gridRemove(it);
        it.mesh.setMatrixAt(it.index, sec.slots[slot]);
      } else if (states[i] === 1 && held.includes(i)) {
        it.state = 'held';
        this.gridRemove(it);
        it.mesh.setMatrixAt(it.index, ZERO);
      }
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
}
