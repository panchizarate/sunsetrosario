import * as THREE from 'three';
import { CATEGORIES, Category, ItemKind, ZONES, ZoneId, MEZZ } from './config';
import { itemGeometry, PICK_RADIUS } from './itemgeo';
import type { House, Section } from './house';
import { NOISE } from './materials';
import { bookAtlas, labelAtlas, capAtlas, shirtAtlas, BOOK_CELLS, LABEL_CELLS, CAP_CELLS, SHIRT_CELLS } from './itemtex';

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

const CELLS: Partial<Record<ItemKind, number>> = { libro: BOOK_CELLS, botella: LABEL_CELLS, gorra: CAP_CELLS, prenda: SHIRT_CELLS, almohadon: 4, jarron: 4, vela: 3, escultura: 2, figura: 8, zapatilla: 1, copa: 1 };

/** Inyecta en un material: detalles por zona del objeto, atlas por instancia (aVar) y brillo del escáner. */
function itemMaterial(kind: ItemKind, variant: number, base: THREE.MeshStandardMaterialParameters, extra = '', physical = false, atlas: THREE.Texture | null = null): THREE.MeshStandardMaterial {
  const mat = physical ? new THREE.MeshPhysicalMaterial(base as THREE.MeshPhysicalMaterialParameters) : new THREE.MeshStandardMaterial(base);
  const color2 = new THREE.Color(CATEGORIES.find((c) => c.kind === kind)!.variants[variant].color2 ?? '#ffffff');
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = ITEM_TIME;
    sh.uniforms.uColor2 = { value: color2 };
    sh.uniforms.uAtlas = { value: atlas };
    sh.vertexShader = 'attribute float aHi;\nattribute float aVar;\nvarying float vHi;\nvarying float vVar;\nvarying vec3 vOP;\nvarying vec3 vON;\n' + sh.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\n vHi = aHi; vVar = aVar; vOP = position; vON = normal;',
    );
    sh.fragmentShader = 'uniform float uTime;\nuniform vec3 uColor2;\nuniform sampler2D uAtlas;\nvarying float vHi;\nvarying float vVar;\nvarying vec3 vOP;\nvarying vec3 vON;\n' + NOISE +
      '\nfloat iRough = -1.0; float iMetal = -1.0;\nfloat luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }\nvec4 atl(float cells, vec2 uv){ return texture2D(uAtlas, vec2((floor(vVar + 0.5) + clamp(uv.x, 0.001, 0.999)) / cells, clamp(uv.y, 0.001, 0.999))); }\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n${extra}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (iRough >= 0.0) roughnessFactor = iRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nif (iMetal >= 0.0) metalnessFactor = iMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(0.35, 0.9, 1.0) * vHi * (0.55 + 0.45 * sin(uTime * 6.0));');
  };
  mat.customProgramCacheKey = () => kind + variant + (physical ? 'p' : '');
  return mat;
}
export const ITEM_TIME = { value: 0 };

const BOTTLE_LABEL: [number, number][] = [[0.05, 0.17], [0.045, 0.15], [0.05, 0.17], [0.04, 0.15], [0.06, 0.19]];
const SHOE = [
  'float m = smoothstep(0.012, 0.0, abs(vOP.y - 0.06 - vOP.z * 0.25)) * step(0.035, abs(vOP.x));', // velox: raya diagonal
  'float m = 0.0; for (int i = 0; i < 3; i++) m += smoothstep(0.006, 0.0, abs(vOP.z + 0.02 - float(i) * 0.03 - (vOP.y - 0.07) * 0.8)) * step(0.045, vOP.y) * step(vOP.y, 0.1) * step(0.035, abs(vOP.x));', // nimbus: tres barras
  'float m = step(0.09, vOP.z) + step(vOP.z, -0.1) * step(vOP.y, 0.07);', // aurea: talón y puntera
  'float m = smoothstep(0.008, 0.0, abs(vOP.y - 0.065 - sin(vOP.z * 40.0) * 0.012)) * step(0.035, abs(vOP.x));', // kaze: onda
  'float m = step(0.085, vOP.z) * step(0.5, fract(floor(vOP.y * 60.0) * 0.5 + floor(vOP.x * 60.0) * 0.5 + floor(vOP.z * 60.0) * 0.5));', // brava: damero
  'float m = step(0.1, vOP.z) * step(0.09, vOP.y);', // mono: pestaña
];

function materialFor(kind: ItemKind, variant: number): THREE.MeshStandardMaterial {
  switch (kind) {
    case 'libro':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.55 }, `
        vec3 cover = diffuseColor.rgb;
        vec3 ink = luma(cover) > 0.35 ? vec3(0.05, 0.05, 0.06) : vec3(0.95, 0.78, 0.42);
        vec4 m = vec4(0.0);
        if (vON.z < -0.5) m = atl(${BOOK_CELLS}.0, vec2((0.025 - vOP.x) / 0.05 * 0.25, vOP.y / 0.27));
        else if (vON.x < -0.5) m = atl(${BOOK_CELLS}.0, vec2(0.25 + (vOP.z + 0.095) / 0.19 * 0.75, vOP.y / 0.27));
        if (vON.z < -0.5 || abs(vON.x) > 0.5) {
          vec3 c = cover * (0.92 + 0.12 * pn2(vOP.zy * 300.0));
          c = mix(c, cover * 0.45, m.g);
          c = mix(c, min(cover * 1.6 + 0.12, vec3(1.0)), m.b);
          c = mix(c, ink, m.r);
          if (m.r > 0.5 && luma(cover) <= 0.35) { iRough = 0.25; iMetal = 0.7; }
          diffuseColor.rgb = c;
        } else {
          diffuseColor.rgb = vec3(0.88, 0.84, 0.74) * (0.88 + 0.12 * sin(vOP.x * 1400.0 + vOP.y * 30.0));
          iRough = 0.85;
        }`, false, bookAtlas(variant));
    case 'almohadon':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.9, sheen: 1, sheenRoughness: 0.4, sheenColor: new THREE.Color(0.8, 0.8, 0.8) } as any, `
        vec2 p = vec2(vOP.x, vOP.y - 0.23);
        float weave = 0.9 + 0.1 * step(0.5, fract(vOP.x * 260.0)) * step(0.5, fract(vOP.y * 260.0)) + 0.06 * pn2(p * 90.0);
        vec3 c = diffuseColor.rgb * weave;
        int k = int(floor(vVar + 0.5));
        if (k == 1) c = mix(c, c * 0.45, smoothstep(0.205, 0.215, max(abs(p.x), abs(p.y))));
        if (k == 2) c = mix(c, min(c * 1.5 + 0.08, vec3(1.0)), step(0.5, fract(p.x * 14.0)) * 0.6);
        if (k == 3) { float d = length(p); c *= 1.0 - smoothstep(0.022, 0.012, d) * 0.6 - 0.08 * smoothstep(0.2, 0.0, d) * (0.5 + 0.5 * sin(atan(p.y, p.x) * 8.0)); }
        diffuseColor.rgb = c;`, true);
    case 'jarron':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.25, metalness: 0 }, `
        int k = int(floor(vVar + 0.5));
        float a = atan(vOP.z, vOP.x);
        vec3 c = diffuseColor.rgb;
        if (k == 0) { iRough = 0.12; c *= 0.95 + 0.05 * pn2(vec2(a * 3.0, vOP.y * 30.0)); }
        if (k == 1) { c *= 0.82 + 0.18 * smoothstep(-0.3, 0.3, sin(vOP.y * 220.0)); iRough = 0.35; }
        if (k == 2) { c *= 0.85 + 0.15 * pn2(vec2(a * 8.0, vOP.y * 60.0)); c = mix(c, vec3(0.1), step(0.93, ph21(floor(vec2(a * 40.0, vOP.y * 300.0)))) * 0.7); iRough = 0.8; }
        if (k == 3) { float band = step(0.27, vOP.y) + step(abs(vOP.y - 0.13), 0.008); c = mix(c, vec3(0.85, 0.66, 0.32), band); if (band > 0.5) { iMetal = 1.0; iRough = 0.2; } }
        diffuseColor.rgb = c;`);
    case 'escultura':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.25, metalness: 1 }, `
        if (vOP.y < 0.041) { diffuseColor.rgb = vec3(0.05); iMetal = 0.0; iRough = 0.15; }
        else if (floor(vVar + 0.5) > 0.5) iRough = 0.45 + 0.1 * sin(vOP.y * 800.0);`);
    case 'vela':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.55 }, `
        int k = int(floor(vVar + 0.5));
        if (vOP.y < 0.031) { diffuseColor.rgb = k == 0 ? vec3(0.75, 0.58, 0.32) : k == 1 ? vec3(0.04) : vec3(0.8); iRough = 0.2; iMetal = k == 2 ? 0.0 : 1.0; }
        else if (vOP.y > 0.162) diffuseColor.rgb = vec3(0.03);
        else { float drip = smoothstep(0.15, 0.16, vOP.y + 0.02 * pn2(vec2(atan(vOP.z, vOP.x) * 6.0, 1.0))); diffuseColor.rgb *= 0.92 + 0.08 * drip + 0.05 * pn2(vOP.xy * 80.0); }`);
    case 'botella': {
      const [y0, y1] = BOTTLE_LABEL[variant % 5];
      const foil = variant === 0 ? 'vec3(0.35, 0.04, 0.08)' : variant === 3 ? 'vec3(0.82, 0.66, 0.3)' : variant === 1 ? 'vec3(0.1, 0.07, 0.05)' : 'vec3(0.75)';
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.06, metalness: 0.0, transparent: true, opacity: 0.86 }, `
        vec3 glass = diffuseColor.rgb;
        float liquid = step(vOP.y, ${variant === 3 || variant === 0 ? '0.22' : '0.17'});
        glass *= mix(1.0, 0.55, liquid);
        float u = 0.5 - atan(vOP.x, -vOP.z) / 6.2832;
        vec4 lab = (vOP.y > ${y0} && vOP.y < ${y1}) ? atl(${LABEL_CELLS}.0, vec2(u, (vOP.y - ${y0}) / ${(y1 - y0).toFixed(3)})) : vec4(0.0);
        float neck = step(${variant === 0 || variant === 3 ? '0.255' : '0.235'}, vOP.y);
        vec3 c = mix(glass, lab.rgb, lab.a);
        c = mix(c, ${foil}, neck);
        diffuseColor.rgb = c;
        diffuseColor.a = max(diffuseColor.a + liquid * 0.08, max(lab.a, neck));
        if (lab.a > 0.5) iRough = 0.55;
        if (neck > 0.5) { iRough = 0.25; iMetal = 0.8; }`, false, labelAtlas(variant));
    }
    case 'copa':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.03, metalness: 0.1, transparent: true, opacity: 0.3, depthWrite: false });
    case 'prenda':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide }, `
        if (vOP.y > -0.035) { diffuseColor.rgb = vec3(0.75); iRough = 0.2; iMetal = 1.0; }
        else {
          vec3 cl = diffuseColor.rgb * (0.88 + 0.12 * pn2(vOP.xy * 160.0));
          float l = luma(cl);
          vec3 ink = l > 0.45 ? cl * 0.35 : min(cl * 2.2 + 0.25, vec3(1.0));
          vec4 m = atl(${SHIRT_CELLS}.0, vec2((0.17 - vOP.x) / 0.34, (vOP.y + 0.66) / 0.62));
          if (vON.z > 0.5) m.r = 0.0;
          cl = mix(cl, ink, m.g * 0.8);
          cl = mix(cl, ink, m.r);
          float collar = smoothstep(0.08, 0.06, length(vec2(vOP.x, (vOP.y + 0.03) * 1.6))) * step(0.5, abs(vON.z));
          cl *= 1.0 - collar * 0.25;
          float hem = step(vOP.y, -0.63 + 0.02 * vOP.x * vOP.x) + step(0.255, abs(vOP.x)) * step(-0.24, vOP.y);
          cl *= 1.0 - hem * 0.12;
          diffuseColor.rgb = cl;
        }`, false, shirtAtlas());
    case 'zapatilla':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.5 }, `
        if (vOP.y < 0.034) {
          diffuseColor.rgb = ${variant === 5 ? 'uColor2' : variant === 1 ? 'vec3(0.08)' : 'vec3(0.93, 0.92, 0.9)'};
          diffuseColor.rgb *= 1.0 - 0.25 * step(0.5, fract(vOP.z * 70.0)) * step(vOP.y, 0.012);
          iRough = 0.75;
        } else if (vOP.y > 0.1 && abs(vOP.x) < 0.036 && vOP.z < 0.05) { diffuseColor.rgb = vec3(0.95); iRough = 0.8; }
        else {
          ${SHOE[variant % 6]}
          diffuseColor.rgb = mix(diffuseColor.rgb * (0.93 + 0.07 * pn2(vOP.zy * 200.0)), uColor2, clamp(m, 0.0, 1.0));
          float perf = step(vOP.z, -0.06) * step(0.07, vOP.y) * step(0.7, ph21(floor(vOP.xz * 260.0)));
          diffuseColor.rgb *= 1.0 - perf * 0.3;
        }`);
    case 'gorra':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.85 }, `
        vec3 c = diffuseColor.rgb * (0.9 + 0.1 * pn2(vOP.xz * 160.0));
        float seam = smoothstep(0.03, 0.0, abs(fract(atan(vOP.z, vOP.x) / 1.0472 + 0.5) - 0.5)) * step(0.01, vOP.y);
        c *= 1.0 - seam * 0.25;
        if (vOP.y < 0.012) c *= 0.7;
        if (vOP.z < -0.02 && vOP.y > 0.015) {
          vec4 m = atl(${CAP_CELLS}.0, vec2((0.05 - vOP.x) / 0.1, (vOP.y - 0.012) / 0.08));
          vec3 ink = luma(c) > 0.4 ? vec3(0.06) : vec3(0.95);
          if (variant_rot > 0.0) ink = vec3(0.9, 0.75, 0.4);
          c = mix(c, ink, m.r);
          c = mix(c, uColor2 * 0.0 + vec3(0.9, 0.2, 0.2), m.g);
          if (m.r > 0.5) iRough = 0.6;
        }
        diffuseColor.rgb = c;`.replace('variant_rot', (variant % 2).toFixed(1)), false, capAtlas(variant));
    case 'figura':
      return itemMaterial(kind, variant, { color: 0xffffff, roughness: 0.3, metalness: 0.0 }, `
        if (vOP.y < 0.015) { diffuseColor.rgb = vec3(0.05); iRough = 0.3; }
        else {
          int k = int(floor(vVar + 0.5));
          vec3 c = diffuseColor.rgb;
          c *= 0.85 + 0.3 * smoothstep(0.02, 0.17, vOP.y);
          if (k == 7) { c = vec3(0.95, 0.76, 0.35); iMetal = 1.0; iRough = 0.18; }
          else if (k == 6) { c = vec3(0.85, 0.87, 0.9); iMetal = 1.0; iRough = 0.1; }
          else if (k == 5) { c = mix(c, vec3(0.05), step(0.5, fract(vOP.y * 40.0)) * 0.5); }
          diffuseColor.rgb = c;
        }`);
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
        const cells = CELLS[cat.kind] ?? 1;
        const vr = new Float32Array(cat.perVariant);
        for (let k = 0; k < vr.length; k++) vr[k] = Math.floor(r() * cells * 0.9999);
        if (cat.kind === 'figura') for (let k = 0; k < vr.length; k++) vr[k] = r() < 0.06 ? 6 + Math.floor(r() * 2) : Math.floor(r() * 6); // figuras raras doradas/cromadas
        geo.setAttribute('aVar', new THREE.InstancedBufferAttribute(vr, 1));
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
