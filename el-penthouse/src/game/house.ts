import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { B, MEZZ, CEIL, STAIRS, LANDING, TERRACE, SECRET, ZoneId, ZONES, CATEGORIES, ItemKind } from './config';
import * as M from './materials';

// ======================================================================================
// Arquitectura del penthouse, muebles, estanterías (con lugares exactos), puertas, luces.
// ======================================================================================

export interface Section {
  kind: ItemKind;
  variant: number;
  zone: ZoneId;
  box: THREE.Box3; // zona donde apuntar para dejar el objeto
  slots: THREE.Matrix4[]; // transformaciones finales (mundo) de cada lugar
  filled: number;
  label: string;
}

export interface Door {
  id: string;
  mesh: THREE.Object3D;
  collider: THREE.Box3;
  open: boolean;
  t: number; // 0 cerrada .. 1 abierta
  slide: THREE.Vector3;
  base: THREE.Vector3;
}

interface Rig { lights: { l: THREE.Light; base: number }[]; mats: { m: THREE.MeshStandardMaterial; base: number }[]; uniforms: { u: { value: number }; base: number }[]; level: number; target: number }

export interface Collider { box: THREE.Box3; id?: string }

const tmpM = new THREE.Matrix4();

/** Junta geometrías por material para tener pocas llamadas de dibujo. */
class Builder {
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  constructor(private parent: THREE.Object3D, private shadows: boolean) {}
  add(geo: THREE.BufferGeometry, mat: THREE.Material, m?: THREE.Matrix4) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (m) g.applyMatrix4(m);
    const arr = this.buckets.get(mat) ?? [];
    arr.push(g);
    this.buckets.set(mat, arr);
  }
  box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number, ry = 0, r = 0) {
    const g = r > 0 ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d);
    this.add(g, mat, tmpM.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(1, 1, 1)));
  }
  flush() {
    for (const [mat, geos] of this.buckets) {
      const g = mergeGeometries(geos, false)!;
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = this.shadows && !(mat as any).transparent;
      mesh.receiveShadow = this.shadows;
      this.parent.add(mesh);
    }
    this.buckets.clear();
  }
}

export class House {
  group = new THREE.Group();
  sections: Section[] = [];
  doors: Door[] = [];
  colliders: Collider[] = [];
  rigs = new Map<ZoneId, Rig>();
  stations: { id: string; pos: THREE.Vector3; zone: ZoneId; label: string }[] = [];
  timeU = { value: 0 };
  power = 1;
  private b: Builder;
  private mats: Record<string, THREE.Material>;
  hoop = new THREE.Vector3();
  mirror!: THREE.Mesh;

  constructor(scene: THREE.Scene, private high: boolean, private shadows: boolean) {
    if (high) RectAreaLightUniformsLib.init();
    this.b = new Builder(this.group, shadows);
    this.mats = {
      marble: M.marbleDark(),
      marbleW: M.marbleWhite(),
      oak: M.oakFloor(),
      walnut: M.walnut(1),
      wall: M.microcement(new THREE.Color(0.3, 0.27, 0.25)),
      wallDark: M.microcement(new THREE.Color(0.16, 0.15, 0.16)),
      ceil: M.microcement(new THREE.Color(0.06, 0.055, 0.06)),
      steel: M.blackSteel(),
      chrome: M.chrome(),
      brass: M.brass(),
      glass: M.rainGlass(this.timeU),
      clearGlass: new THREE.MeshPhysicalMaterial({ color: 0xd8f0ff, roughness: 0.05, transmission: 0, transparent: true, opacity: 0.18, metalness: 0.2 }),
      felt: new THREE.MeshStandardMaterial({ color: 0x0f5132, roughness: 0.95 }),
      rug: M.proc({ color: 0xffffff, roughness: 1 }, { color: `float r = length(vWP.xz - vec2(-10.0, -6.5)); diffuseColor.rgb = mix(vec3(0.16, 0.14, 0.13), vec3(0.26, 0.22, 0.19), smoothstep(0.4, 0.6, pn2(vWP.xz * 3.0))) * (0.9 + 0.1 * sin(r * 6.0));` }),
      shelfLed: M.neon('#ffd9a0', 2.5),
      black: new THREE.MeshStandardMaterial({ color: 0x0b0b0e, roughness: 0.6 }),
      white: new THREE.MeshStandardMaterial({ color: 0xf2f0ec, roughness: 0.5 }),
      deck: M.proc({ color: 0xffffff, roughness: 0.7 }, { color: `float row = floor(vWP.z / 0.16); float g = pn2(vec2(vWP.x * 1.5, row)); diffuseColor.rgb = mix(vec3(0.22, 0.15, 0.1), vec3(0.32, 0.22, 0.15), g) * (1.0 - smoothstep(0.01, 0.0, fract(vWP.z / 0.16) * 0.16) * 0.6);` }),
      screen: new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x3a6bff, emissiveIntensity: 1.6 }),
    };
    this.buildShell();
    this.buildStairs();
    this.buildLiving();
    this.buildBar();
    this.buildVestidor();
    this.buildJuegos();
    this.buildTerrace();
    this.buildSecret();
    this.b.flush();
    scene.add(this.group);
  }

  // ------------------------------------------------------------------ utilidades
  private col(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, id?: string) {
    this.colliders.push({ box: new THREE.Box3(new THREE.Vector3(Math.min(x0, x1), y0, Math.min(z0, z1)), new THREE.Vector3(Math.max(x0, x1), y1, Math.max(z0, z1))), id });
  }
  private rig(zone: ZoneId) {
    let r = this.rigs.get(zone);
    if (!r) { r = { lights: [], mats: [], uniforms: [], level: 0.12, target: 0.12 }; this.rigs.set(zone, r); }
    return r;
  }
  private light(zone: ZoneId, l: THREE.Light) {
    this.rig(zone).lights.push({ l, base: l.intensity });
    this.group.add(l);
    return l;
  }
  private glow(zone: ZoneId, color: string, intensity = 3) {
    const m = M.neon(color, intensity);
    this.rig(zone).mats.push({ m, base: intensity });
    return m;
  }
  private label(text: string, w: number, h: number, pos: THREE.Vector3, rotY: number, color = '#ffffff', glow?: string, zone?: ZoneId) {
    const mat = new THREE.MeshBasicMaterial({ map: M.textTexture(text, { color, glow, w: 1024, h: 256 }), transparent: true, depthWrite: false, toneMapped: false });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    p.position.copy(pos);
    p.rotation.y = rotY;
    this.group.add(p);
    if (zone) this.rig(zone).mats.push({ m: mat as any, base: 1 });
    return p;
  }
  private section(kind: ItemKind, variant: number, zone: ZoneId, box: THREE.Box3, slots: THREE.Matrix4[]) {
    const cat = CATEGORIES.find((c) => c.kind === kind)!;
    this.sections.push({ kind, variant, zone, box, slots, filled: 0, label: `${cat.name} · ${cat.variants[variant].name}` });
  }
  private slot(x: number, y: number, z: number, ry: number, rx = 0, rz = 0, s = 1) {
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(s, s, s));
  }
  private door(id: string, mesh: THREE.Object3D, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, slide: THREE.Vector3) {
    this.group.add(mesh);
    const box = new THREE.Box3(new THREE.Vector3(x0, y0, z0), new THREE.Vector3(x1, y1, z1));
    this.colliders.push({ box, id });
    this.doors.push({ id, mesh, collider: box, open: false, t: 0, slide, base: mesh.position.clone() });
  }

  // ------------------------------------------------------------------ cáscara: pisos, paredes, vidrios, entrepiso
  private buildShell() {
    const b = this.b, m = this.mats;
    const W = B.x1 - B.x0, D = B.z1 - B.z0;
    // piso de mármol (planta baja) y techo
    b.box(-B.x0, 0.2, D, m.oak, B.x0 / 2, -0.1, 0); // living: roble
    b.box(B.x1, 0.2, D, m.marble, B.x1 / 2, -0.1, 0); // bar: mármol negro
    b.box(W, 0.3, D, m.ceil, 0, CEIL + 0.15, 0);
    // entrepiso (z>0): losa + piso de roble
    b.box(W, 0.35, B.z1, m.ceil, 0, MEZZ - 0.175, B.z1 / 2);
    b.box(W, 0.04, B.z1, m.oak, 0, MEZZ + 0.02, B.z1 / 2);
    // canaletas de luz en el techo (doble altura) y en el cielo raso del entrepiso
    for (let i = 0; i < 5; i++) b.box(W - 2, 0.05, 0.08, this.glow('living', '#ffe2c0', 1.2), 0, CEIL - 0.02, -10.5 + i * 2.4);
    // paredes sólidas
    b.box(13.4, CEIL, 0.3, m.wall, -13.3, CEIL / 2, B.z1 + 0.15); // sur (con hueco de la puerta secreta)
    b.box(24.6, CEIL, 0.3, m.wall, 7.7, CEIL / 2, B.z1 + 0.15);
    b.box(2, CEIL - 3.2, 0.3, m.wall, -5.6, 3.2 + (CEIL - 3.2) / 2, B.z1 + 0.15);
    this.col(B.x0, -6.6, 0, CEIL, B.z1, B.z1 + 0.3);
    this.col(-4.6, B.x1, 0, CEIL, B.z1, B.z1 + 0.3);
    this.col(-6.6, -4.6, 3.2, CEIL, B.z1, B.z1 + 0.3);
    b.box(0.3, CEIL, B.z1, m.wall, B.x0 - 0.15, CEIL / 2, B.z1 / 2); // oeste (z>0)
    b.box(0.3, CEIL, B.z1, m.wall, B.x1 + 0.15, CEIL / 2, B.z1 / 2); // este (z>0)
    this.col(B.x0 - 0.3, B.x0, 0, CEIL, 0, B.z1);
    this.col(B.x1, B.x1 + 0.3, 0, CEIL, 0, B.z1);
    // ventanales de piso a techo: norte, oeste (z<0), este (z<0, con puerta a la terraza)
    const glassWall = (w: number, x: number, z: number, ry: number) => {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(w, CEIL), m.glass);
      g.position.set(x, CEIL / 2, z);
      g.rotation.y = ry;
      g.renderOrder = 5;
      this.group.add(g);
    };
    glassWall(W, 0, B.z0, 0);
    glassWall(-B.z0, B.x0, B.z0 / 2, Math.PI / 2);
    glassWall(-B.z0, B.x1, B.z0 / 2, -Math.PI / 2);
    this.col(B.x0, B.x1, 0, CEIL, B.z0 - 0.2, B.z0);
    this.col(B.x0 - 0.2, B.x0, 0, CEIL, B.z0, 0);
    this.col(B.x1, B.x1 + 0.2, 0, CEIL, B.z0, -8.2);
    this.col(B.x1, B.x1 + 0.2, 0, CEIL, -4.8, 0);
    // carpintería de acero de los ventanales
    for (let x = B.x0; x <= B.x1 + 0.01; x += 2.5) b.box(0.08, CEIL, 0.12, m.steel, x, CEIL / 2, B.z0);
    for (const y of [0.05, 3.0, 6.0, CEIL - 0.05]) b.box(W, 0.08, 0.12, m.steel, 0, y, B.z0);
    for (let z = B.z0; z <= 0.01; z += 2.4) { b.box(0.12, CEIL, 0.08, m.steel, B.x0, CEIL / 2, z); b.box(0.12, CEIL, 0.08, m.steel, B.x1, CEIL / 2, z); }
    // tabique entre living y bar (x=0) con paneles de listones
    const slat = this.mats.walnut;
    for (let z = B.z0 + 0.06; z < B.z1; z += 0.12) {
      if (z > -3.0 && z < -0.5) { b.box(0.1, CEIL - 3.2, 0.06, slat, 0, 3.2 + (CEIL - 3.2) / 2, z); continue; } // sobre la puerta
      if (z > 0 && z < B.z1) {
        b.box(0.1, MEZZ - 0.35, 0.06, slat, 0, (MEZZ - 0.35) / 2, z);
        if (z < 8 || z > 10) b.box(0.1, CEIL - MEZZ, 0.06, slat, 0, MEZZ + (CEIL - MEZZ) / 2, z);
        else b.box(0.1, CEIL - MEZZ - 3, 0.06, slat, 0, MEZZ + 3 + (CEIL - MEZZ - 3) / 2, z);
        continue;
      }
      b.box(0.1, CEIL, 0.06, slat, 0, CEIL / 2, z);
    }
    // panel oscuro detrás de los listones (con huecos en las puertas)
    b.box(0.06, CEIL, -3.0 - B.z0, this.mats.black, 0, CEIL / 2, (B.z0 - 3.0) / 2);
    b.box(0.06, CEIL - 3.2, 2.5, this.mats.black, 0, 3.2 + (CEIL - 3.2) / 2, -1.75);
    b.box(0.06, MEZZ, B.z1 + 0.5, this.mats.black, 0, MEZZ / 2, (B.z1 - 0.5) / 2);
    b.box(0.06, CEIL - MEZZ, 8, this.mats.black, 0, MEZZ + (CEIL - MEZZ) / 2, 4);
    b.box(0.06, CEIL - MEZZ, B.z1 - 10, this.mats.black, 0, MEZZ + (CEIL - MEZZ) / 2, (10 + B.z1) / 2);
    b.box(0.06, CEIL - MEZZ - 3, 2, this.mats.black, 0, MEZZ + 3 + (CEIL - MEZZ - 3) / 2, 9);
    this.col(-0.12, 0.12, 0, CEIL, B.z0, -3.0);
    this.col(-0.12, 0.12, 0, MEZZ, -0.5, B.z1);
    this.col(-0.12, 0.12, MEZZ, CEIL, 0, 8);
    this.col(-0.12, 0.12, MEZZ, CEIL, 10, B.z1);
    // puerta corrediza de vidrio living -> bar
    const d1 = new THREE.Mesh(new RoundedBoxGeometry(0.08, 3.0, 2.5, 2, 0.02), this.mats.clearGlass);
    d1.position.set(0, 1.5, -1.75);
    const d1f = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 2.5), this.mats.brass);
    d1f.position.y = 1.5;
    d1.add(d1f);
    this.door('door-bar', d1, -0.1, 0.1, 0, 3, -3, -0.5, new THREE.Vector3(0, 0, -2.6));
    // puerta vestidor -> sala de juegos
    const d2 = new THREE.Mesh(new RoundedBoxGeometry(0.08, 3.0, 2.0, 2, 0.02), this.mats.clearGlass);
    d2.position.set(0, MEZZ + 1.5, 9);
    this.door('door-juegos', d2, -0.1, 0.1, MEZZ, MEZZ + 3, 8, 10, new THREE.Vector3(0, 0, 2.1));
    // puerta a la terraza
    const d3 = new THREE.Mesh(new RoundedBoxGeometry(0.08, 3.2, 3.4, 2, 0.02), this.mats.clearGlass);
    d3.position.set(B.x1, 1.6, -6.5);
    this.door('door-terraza', d3, B.x1 - 0.1, B.x1 + 0.1, 0, 3.2, -8.2, -4.8, new THREE.Vector3(0, 0, 3.5));

    // baranda de vidrio del entrepiso (z=0) y del descanso
    const rail = (x0: number, x1: number, z: number) => {
      const len = x1 - x0;
      b.box(len, 1.05, 0.03, this.mats.clearGlass, (x0 + x1) / 2, MEZZ + 0.55, z);
      b.box(len, 0.05, 0.07, this.mats.brass, (x0 + x1) / 2, MEZZ + 1.1, z);
      this.col(x0, x1, MEZZ, MEZZ + 1.3, z - 0.06, z + 0.06);
    };
    rail(-15, B.x1, 0);
    // borde del entrepiso con línea de luz
    b.box(B.x1 - B.x0, 0.06, 0.06, this.glow('vestidor', '#ffdcb0', 1.6), 0, MEZZ - 0.38, 0.05);
    // ascensor (pared oeste, z 3..6)
    b.box(0.1, 3.0, 2.4, this.mats.brass, B.x0 + 0.06, 1.5, 4.5);
    b.box(0.12, 0.04, 2.4, this.mats.black, B.x0 + 0.08, 1.5, 4.5);
    this.label('PH', 0.6, 0.15, new THREE.Vector3(B.x0 + 0.13, 3.25, 4.5), Math.PI / 2, '#ffd9a0', '#ffb347');
  }

  // ------------------------------------------------------------------ escalera de vidrio flotante + descanso
  private buildStairs() {
    const b = this.b;
    const n = 26;
    const len = STAIRS.xStart - STAIRS.xEnd;
    for (let i = 0; i < n; i++) {
      const x = STAIRS.xStart - (i + 0.5) * (len / n);
      const y = ((i + 1) / n) * MEZZ;
      b.box(len / n + 0.02, 0.06, STAIRS.z1 - STAIRS.z0, this.mats.oak, x, y - 0.03, (STAIRS.z0 + STAIRS.z1) / 2, 0, 0.01);
    }
    // zanca de acero y baranda de vidrio inclinada
    const ang = Math.atan2(MEZZ, len);
    const stringer = new THREE.BoxGeometry(Math.hypot(len, MEZZ), 0.25, 0.06);
    for (const z of [STAIRS.z0 - 0.04, STAIRS.z1 + 0.04]) {
      b.add(stringer, this.mats.steel, new THREE.Matrix4().compose(new THREE.Vector3((STAIRS.xStart + STAIRS.xEnd) / 2, MEZZ / 2 - 0.1, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ang), new THREE.Vector3(1, 1, 1)));
      const g = new THREE.BoxGeometry(Math.hypot(len, MEZZ), 1.0, 0.02);
      b.add(g, this.mats.clearGlass, new THREE.Matrix4().compose(new THREE.Vector3((STAIRS.xStart + STAIRS.xEnd) / 2, MEZZ / 2 + 0.55, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -ang), new THREE.Vector3(1, 1, 1)));
    }
    // descanso
    b.box(LANDING.x1 - LANDING.x0, 0.3, LANDING.z1 - LANDING.z0, this.mats.ceil, (LANDING.x0 + LANDING.x1) / 2, MEZZ - 0.15, (LANDING.z0 + LANDING.z1) / 2);
    b.box(LANDING.x1 - LANDING.x0, 0.04, LANDING.z1 - LANDING.z0, this.mats.oak, (LANDING.x0 + LANDING.x1) / 2, MEZZ + 0.02, (LANDING.z0 + LANDING.z1) / 2);
    b.box(LANDING.x1 - LANDING.x0, 1.05, 0.03, this.mats.clearGlass, (LANDING.x0 + LANDING.x1) / 2, MEZZ + 0.55, LANDING.z0);
    this.col(LANDING.x0, LANDING.x1, MEZZ, MEZZ + 1.3, LANDING.z0 - 0.06, LANDING.z0 + 0.06);
    // reja de vidrio al pie de la escalera (se abre al terminar el bar)
    const gate = new THREE.Mesh(new RoundedBoxGeometry(0.06, 1.2, STAIRS.z1 - STAIRS.z0, 2, 0.02), this.mats.clearGlass);
    gate.position.set(STAIRS.xStart + 0.3, 0.6, (STAIRS.z0 + STAIRS.z1) / 2);
    const lock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.3), this.glow('bar', '#ff3b3b', 2));
    lock.position.y = 0.2;
    gate.add(lock);
    this.door('gate-stairs', gate, STAIRS.xStart + 0.2, STAIRS.xStart + 0.4, 0, 1.2, STAIRS.z0, STAIRS.z1, new THREE.Vector3(0, -1.3, 0));
  }

  // ------------------------------------------------------------------ LIVING
  private buildLiving() {
    const b = this.b, m = this.mats;
    // alfombra y mesa ratona de mármol
    b.box(7.5, 0.02, 5.2, m.rug, -10, 0.01, -6.5, 0, 0);
    b.box(2.6, 0.38, 1.2, m.marbleW, -10, 0.19, -6.5, 0, 0.04);
    this.col(-11.3, -8.7, 0, 0.5, -7.1, -5.9);
    // tres sofás de terciopelo (cada uno es la sección de almohadones de su color)
    const sofa = (cx: number, cz: number, ry: number, variant: number) => {
      const color = CATEGORIES[1].variants[variant].color;
      const mat = M.velvet(new THREE.Color(color).multiplyScalar(0.55).getStyle());
      const grp = new THREE.Group();
      const add = (w: number, h: number, d: number, x: number, y: number, z: number) => {
        const me = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 4, 0.08), mat);
        me.position.set(x, y, z);
        me.castShadow = me.receiveShadow = this.shadows;
        grp.add(me);
      };
      add(3.6, 0.42, 1.05, 0, 0.21, 0);
      add(3.6, 0.6, 0.28, 0, 0.62, -0.42);
      add(0.25, 0.62, 1.05, -1.8, 0.4, 0);
      add(0.25, 0.62, 1.05, 1.8, 0.4, 0);
      grp.position.set(cx, 0, cz);
      grp.rotation.y = ry;
      this.group.add(grp);
      const w = Math.abs(Math.cos(ry)) > 0.5 ? 3.9 : 1.2, d = Math.abs(Math.cos(ry)) > 0.5 ? 1.2 : 3.9;
      this.col(cx - w / 2, cx + w / 2, 0, 0.95, cz - d / 2, cz + d / 2);
      // lugares: 6 apoyados en el respaldo + 6 sobre el asiento
      const slots: THREE.Matrix4[] = [];
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      for (let i = 0; i < 12; i++) {
        const row = i < 6 ? 0 : 1, k = i % 6;
        const lx = -1.45 + k * 0.58, ly = row === 0 ? 0.78 : 0.62, lz = row === 0 ? -0.2 : 0.1;
        const p = new THREE.Vector3(lx, ly, lz).applyQuaternion(q).add(new THREE.Vector3(cx, 0, cz));
        slots.push(this.slot(p.x, p.y, p.z, ry, row === 0 ? -0.35 : -0.15, (k % 2 ? 0.08 : -0.08)));
      }
      this.section('almohadon', variant, 'living', new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(cx, 0.6, cz), new THREE.Vector3(w, 1.3, d)), slots);
    };
    sofa(-10, -3.4, Math.PI, 0);
    sofa(-14.3, -6.5, -Math.PI / 2, 1);
    sofa(-5.7, -6.5, Math.PI / 2, 2);

    // biblioteca de nogal en la pared sur (6 secciones por color, 4 estantes x 16 libros)
    const z = B.z1 - 0.35, x0 = -19.5, secW = 1.9;
    b.box(6 * secW + 0.1, 3.9, 0.04, m.walnut, x0 + 3 * secW, 1.95, B.z1 - 0.02);
    for (let s = 0; s <= 6; s++) b.box(0.05, 3.9, 0.42, m.walnut, x0 + s * secW, 1.95, z);
    for (let r = 0; r < 5; r++) {
      const y = 0.25 + r * 0.9;
      b.box(6 * secW, 0.04, 0.42, m.walnut, x0 + 3 * secW, y, z);
      if (r < 4) b.box(6 * secW - 0.1, 0.015, 0.02, this.glow('living', '#ffd29a', 2.2), x0 + 3 * secW, y + 0.86, z - 0.18);
    }
    this.col(x0, x0 + 6 * secW, 0, 4, z - 0.25, B.z1);
    for (let s = 0; s < 6; s++) {
      const slots: THREE.Matrix4[] = [];
      for (let r = 0; r < 4; r++)
        for (let k = 0; k < 16; k++) {
          const x = x0 + s * secW + 0.12 + k * 0.104;
          slots.push(this.slot(x, 0.27 + r * 0.9 + 0.14, z + 0.02, 0));
        }
      this.section('libro', s, 'living', new THREE.Box3(new THREE.Vector3(x0 + s * secW, 0, z - 0.5), new THREE.Vector3(x0 + (s + 1) * secW, 3.9, B.z1)), slots);
      this.label(CATEGORIES[0].variants[s].name.toUpperCase(), 0.9, 0.22, new THREE.Vector3(x0 + s * secW + secW / 2, 3.98, z - 0.22), Math.PI, '#ffe6c2', undefined, 'living');
    }

    // aparador bajo el ventanal oeste: jarrones (2 filas x 30)
    const cx = B.x0 + 0.55;
    b.box(0.5, 0.75, 10.2, m.walnut, cx, 0.375, -6.1, 0, 0.02);
    b.box(0.55, 0.04, 10.3, m.marbleW, cx, 0.77, -6.1);
    this.col(B.x0, cx + 0.3, 0, 0.9, -11.3, -0.9);
    {
      const slots: THREE.Matrix4[] = [];
      for (let r = 0; r < 2; r++) for (let k = 0; k < 30; k++) slots.push(this.slot(cx + (r ? 0.12 : -0.1), 0.79, -10.9 + k * 0.33 + r * 0.16, Math.random() * 6));
      this.section('jarron', 0, 'living', new THREE.Box3(new THREE.Vector3(B.x0, 0, -11.4), new THREE.Vector3(cx + 0.6, 1.6, -0.8)), slots);
    }
    // repisas flotantes en el tabique: esculturas (5 x 12)
    {
      const slots: THREE.Matrix4[] = [];
      for (let r = 0; r < 5; r++) {
        const y = 0.9 + r * 0.6;
        b.box(0.32, 0.05, 7.6, m.walnut, -0.3, y, -7.4);
        b.box(0.02, 0.012, 7.5, this.glow('living', '#ffd29a', 2), -0.42, y - 0.03, -7.4);
        for (let k = 0; k < 12; k++) slots.push(this.slot(-0.3, y + 0.03, -10.9 + k * 0.63, -Math.PI / 2));
      }
      this.col(-0.5, 0.2, 0.6, 3.6, -11.3, -3.5);
      this.section('escultura', 0, 'living', new THREE.Box3(new THREE.Vector3(-1.2, 0.5, -11.4), new THREE.Vector3(0.1, 3.7, -3.4)), slots);
    }
    // mesa de comedor (velas 3 x 20) bajo el entrepiso
    b.box(5.4, 0.08, 1.4, m.marbleW, -12, 0.76, 6.5, 0, 0.02);
    b.box(0.3, 0.72, 0.9, m.steel, -14, 0.36, 6.5);
    b.box(0.3, 0.72, 0.9, m.steel, -10, 0.36, 6.5);
    this.col(-14.7, -9.3, 0, 0.9, 5.8, 7.2);
    for (const sx of [-14, -12.7, -11.3, -10]) for (const sz of [5.45, 7.55]) b.box(0.5, 0.48, 0.5, M.leather('#2a211c'), sx, 0.24, sz, 0, 0.06);
    {
      const slots: THREE.Matrix4[] = [];
      for (let r = 0; r < 3; r++) for (let k = 0; k < 20; k++) slots.push(this.slot(-14.5 + k * 0.26, 0.8, 6.1 + r * 0.4, 0));
      this.section('vela', 0, 'living', new THREE.Box3(new THREE.Vector3(-14.9, 0.5, 5.6), new THREE.Vector3(-9.1, 1.5, 7.4)), slots);
    }
    // lámpara colgante sobre la mesa
    const pend = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.03, 8, 64), this.glow('living', '#ffe0b0', 3));
    pend.rotation.x = Math.PI / 2;
    pend.position.set(-12, 2.6, 6.5);
    this.group.add(pend);
    // mesa de DJ junto al ventanal
    b.box(2.2, 1.0, 0.8, m.black, -4, 0.5, -10.4, 0, 0.03);
    b.box(2.0, 0.02, 0.6, this.glow('living', '#b06bff', 2.5), -4, 1.01, -10.4);
    for (const dx of [-0.6, 0.6]) b.box(0.45, 0.04, 0.45, m.steel, -4 + dx, 1.04, -10.45, 0, 0);
    this.col(-5.2, -2.8, 0, 1.1, -10.9, -9.9);
    this.stations.push({ id: 'dj', pos: new THREE.Vector3(-4, 1.1, -10), zone: 'living', label: 'Mesa de DJ' });
    // teléfono fijo (el misterio)
    b.box(0.6, 0.6, 0.6, m.walnut, -16.2, 0.3, -3.2, 0, 0.03);
    b.box(0.25, 0.08, 0.18, this.mats.black, -16.2, 0.64, -3.2, 0.3, 0.02);
    this.stations.push({ id: 'telefono', pos: new THREE.Vector3(-16.2, 0.7, -3.2), zone: 'living', label: 'Teléfono' });
    // plantas grandes
    for (const [px, pz] of [[-18.8, -0.8], [-1.2, -11], [-18.6, 10.8]]) this.plant(px, pz, 0);
    // luces del living
    this.light('living', new THREE.PointLight(0xffd2a0, 18, 14, 1.6)).position.set(-10, 6, -6);
    this.light('living', new THREE.PointLight(0xb06bff, 10, 12, 1.8)).position.set(-4, 2, -10.5);
    this.light('living', new THREE.PointLight(0xffd2a0, 10, 10, 1.8)).position.set(-12, 3.2, 6.5);
    this.light('living', new THREE.PointLight(0xffc890, 8, 9, 1.8)).position.set(-13.5, 2.5, 10.5);
    if (this.high) {
      const ra = new THREE.RectAreaLight(0xffd8a8, 3, 11, 0.4);
      ra.position.set(-13.75, 4.0, B.z1 - 0.6);
      ra.lookAt(-13.75, 0, B.z1 - 0.6);
      this.light('living', ra);
    }
    this.label('LIVING', 2.4, 0.6, new THREE.Vector3(-10, 3.6, -11.55), 0, '#e8d4ff', '#b06bff', 'living');
  }

  private plant(x: number, z: number, y: number) {
    const b = this.b;
    b.box(0.7, 0.8, 0.7, this.mats.black, x, y + 0.4, z, 0, 0.06);
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5a35, roughness: 0.6, side: THREE.DoubleSide });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const leaf = new THREE.PlaneGeometry(0.28, 1.1, 1, 4);
      const p = leaf.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) { const yy = p.getY(k) + 0.55; p.setZ(k, yy * yy * 0.25); }
      leaf.computeVertexNormals();
      b.add(leaf, leafMat, new THREE.Matrix4().compose(new THREE.Vector3(x, y + 1.2 + (i % 3) * 0.25, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.5, a, 0, 'YXZ')), new THREE.Vector3(1, 1 + (i % 4) * 0.2, 1)));
    }
    this.col(x - 0.4, x + 0.4, y, y + 1.5, z - 0.4, z + 0.4);
  }

  // ------------------------------------------------------------------ BAR & CASINO
  private buildBar() {
    const b = this.b, m = this.mats;
    // contrabarra con ónix retroiluminado y 5 secciones de botellas (4 x 15)
    const onyx = M.onyx(new THREE.Color('#ff9d3a'));
    this.rig('bar').uniforms.push({ u: onyx.userData.uniforms.uOn, base: 1.1 });
    b.box(15.4, 3.9, 0.06, onyx, 9.5, 1.95, B.z1 - 0.05);
    const z = B.z1 - 0.3;
    for (let s = 0; s < 5; s++) {
      const x0 = 2 + s * 3;
      const slots: THREE.Matrix4[] = [];
      for (let r = 0; r < 4; r++) {
        const y = 0.6 + r * 0.82;
        b.box(2.96, 0.03, 0.4, m.clearGlass, x0 + 1.5, y, z);
        b.box(2.9, 0.012, 0.02, this.glow('bar', '#ffd29a', 2.4), x0 + 1.5, y - 0.02, z - 0.19);
        for (let k = 0; k < 15; k++) slots.push(this.slot(x0 + 0.12 + k * 0.19, y + 0.015, z, 0));
      }
      b.box(0.04, 3.9, 0.42, m.brass, x0, 1.95, z);
      this.section('botella', s, 'bar', new THREE.Box3(new THREE.Vector3(x0, 0, z - 0.5), new THREE.Vector3(x0 + 3, 3.9, B.z1)), slots);
      this.label(CATEGORIES[5].variants[s].name.toUpperCase(), 1.3, 0.32, new THREE.Vector3(x0 + 1.5, 3.82, z - 0.22), Math.PI, '#ffe1b8', '#ff9d3a', 'bar');
    }
    b.box(0.04, 3.9, 0.42, m.brass, 17, 1.95, z);
    this.col(2, 17, 0, 4, z - 0.25, B.z1);
    // barra: frente de ónix, tapa de mármol blanco, apoyapiés de bronce
    const onyx2 = M.onyx(new THREE.Color('#ffb46a'));
    this.rig('bar').uniforms.push({ u: onyx2.userData.uniforms.uOn, base: 1 });
    b.box(13, 1.05, 0.7, onyx2, 9.5, 0.525, 7.6, 0, 0.02);
    b.box(13.3, 0.07, 0.95, m.marbleW, 9.5, 1.09, 7.55, 0, 0.02);
    b.box(13, 0.04, 0.04, m.brass, 9.5, 0.22, 7.15);
    this.col(3, 16, 0, 1.2, 7.1, 8.1);
    for (let i = 0; i < 7; i++) {
      const sx = 4.2 + i * 1.75;
      b.box(0.44, 0.08, 0.44, M.leather('#3b2a20'), sx, 0.78, 6.5, 0, 0.04);
      b.box(0.05, 0.74, 0.05, m.brass, sx, 0.37, 6.5);
      b.box(0.36, 0.02, 0.36, m.brass, sx, 0.01, 6.5);
    }
    this.stations.push({ id: 'tragos', pos: new THREE.Vector3(9.5, 1.2, 7.6), zone: 'bar', label: 'Barra de tragos' });
    // estantes de vidrio para copas y vasos en el tabique (4 secciones, 5 x 10)
    for (let s = 0; s < 4; s++) {
      const z0 = 0.6 + s * 2.65;
      const slots: THREE.Matrix4[] = [];
      for (let r = 0; r < 5; r++) {
        const y = 0.7 + r * 0.55;
        b.box(0.32, 0.025, 2.55, m.clearGlass, 0.3, y, z0 + 1.28);
        b.box(0.02, 0.012, 2.5, this.glow('bar', '#ffd29a', 2), 0.45, y - 0.02, z0 + 1.28);
        for (let k = 0; k < 10; k++) slots.push(this.slot(0.3, y + 0.013, z0 + 0.16 + k * 0.245, Math.PI / 2));
      }
      this.section('copa', s, 'bar', new THREE.Box3(new THREE.Vector3(0, 0.3, z0), new THREE.Vector3(1.1, 3.4, z0 + 2.6)), slots);
      this.label(CATEGORIES[6].variants[s].name.toUpperCase(), 1.2, 0.3, new THREE.Vector3(0.48, 3.55, z0 + 1.28), Math.PI / 2, '#ffe1b8', undefined, 'bar');
    }
    this.col(0, 0.5, 0.4, 3.5, 0.5, 11.3);
    // CASINO: ruleta, blackjack, tragamonedas
    const table = (x: number, z: number, w: number, d: number) => {
      b.box(w + 0.2, 0.1, d + 0.2, m.walnut, x, 0.85, z, 0, 0.05);
      b.box(w, 0.02, d, m.felt, x, 0.91, z);
      b.box(w * 0.6, 0.8, d * 0.5, m.black, x, 0.4, z);
      this.col(x - w / 2 - 0.1, x + w / 2 + 0.1, 0, 1, z - d / 2 - 0.1, z + d / 2 + 0.1);
    };
    table(7, -7.2, 3.2, 1.8);
    const wheel = new THREE.Group();
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 0.16, 48), m.walnut);
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.04, 37), M.proc({ color: 0xffffff, roughness: 0.3 }, { color: `float a = atan(vLP.z, vLP.x); float s = floor((a + 3.14159) / 6.28318 * 37.0); diffuseColor.rgb = s < 0.5 ? vec3(0.05, 0.4, 0.15) : mod(s, 2.0) < 0.5 ? vec3(0.55, 0.04, 0.05) : vec3(0.03, 0.03, 0.035); if (length(vLP.xz) < 0.28) diffuseColor.rgb = vec3(0.35, 0.22, 0.12);` }));
    rotor.position.y = 0.08;
    const spindle = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 12), m.brass);
    spindle.position.y = 0.18;
    wheel.add(bowl, rotor, spindle);
    wheel.position.set(5.9, 0.98, -7.2);
    wheel.name = 'ruleta';
    this.group.add(wheel);
    this.stations.push({ id: 'ruleta', pos: new THREE.Vector3(7, 1, -7.2), zone: 'bar', label: 'Ruleta' });
    table(12.6, -7.2, 2.8, 1.6);
    this.stations.push({ id: 'blackjack', pos: new THREE.Vector3(12.6, 1, -7.2), zone: 'bar', label: 'Blackjack' });
    for (let i = 0; i < 3; i++) {
      const sx = 14.4 + i * 1.6;
      b.box(1.1, 1.9, 0.9, m.black, sx, 0.95, -10.9, 0, 0.06);
      b.box(0.8, 0.6, 0.02, this.glow('bar', ['#ff2fa0', '#ffd23f', '#2ee6ff'][i], 1.8), sx, 1.35, -10.44);
      b.box(1.1, 0.12, 0.9, this.glow('bar', '#ff5a3a', 2.4), sx, 1.96, -10.9);
      this.col(sx - 0.55, sx + 0.55, 0, 2, -11.4, -10.4);
    }
    this.stations.push({ id: 'tragamonedas', pos: new THREE.Vector3(16, 1.3, -10.3), zone: 'bar', label: 'Tragamonedas' });
    this.label('CASINO', 4, 1, new THREE.Vector3(10, 5.2, -11.5), 0, '#fff0d0', '#ff4f9a', 'bar');
    this.plant(18.8, -1, 0);
    // luces del bar
    this.light('bar', new THREE.PointLight(0xffa860, 16, 12, 1.6)).position.set(9.5, 3.4, 9.5);
    this.light('bar', new THREE.PointLight(0xff4fa3, 14, 14, 1.6)).position.set(9, 4.5, -7);
    this.light('bar', new THREE.PointLight(0xffd29a, 4, 8, 1.8)).position.set(2.2, 3.2, 6);
    for (let i = 0; i < 4; i++) {
      const pend = new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 12), this.glow('bar', '#ffcf8a', 3));
      pend.position.set(5 + i * 3, 2.7, 7.6);
      this.group.add(pend);
      b.box(0.01, 1.4, 0.01, m.black, 5 + i * 3, 3.45, 7.6);
    }
    if (this.high) {
      const ra = new THREE.RectAreaLight(0xff9d3a, 4, 15, 3.6);
      ra.position.set(9.5, 1.95, B.z1 - 0.15);
      ra.lookAt(9.5, 1.95, 0);
      this.light('bar', ra);
    }
  }

  // ------------------------------------------------------------------ VESTIDOR + ZAPATILLAS (planta alta)
  private buildVestidor() {
    const b = this.b, m = this.mats, y0 = MEZZ;
    b.box(19.6, CEIL - MEZZ, 0.05, M.walnut(1), -10, y0 + (CEIL - MEZZ) / 2, B.z1 - 0.03);
    // percheros cromados: 4 tramos x 2 niveles = 8 colores, 75 perchas cada uno
    for (let bay = 0; bay < 4; bay++) {
      const x0 = -19.4 + bay * 4.05;
      for (let tier = 0; tier < 2; tier++) {
        const v = bay * 2 + tier;
        const y = y0 + (tier ? 3.3 : 1.75);
        b.box(3.9, 0.035, 0.035, m.chrome, x0 + 1.95, y, B.z1 - 0.45);
        b.box(3.9, 0.012, 0.02, this.glow('vestidor', '#ffe6c8', 2.2), x0 + 1.95, y + 0.25, B.z1 - 0.2);
        const slots: THREE.Matrix4[] = [];
        for (let k = 0; k < 75; k++) slots.push(this.slot(x0 + 0.06 + k * 0.051, y - 0.02, B.z1 - 0.45, Math.PI / 2));
        this.section('prenda', v, 'vestidor', new THREE.Box3(new THREE.Vector3(x0, y - 1.3, B.z1 - 1.2), new THREE.Vector3(x0 + 3.9, y + 0.3, B.z1)), slots);
        this.label(CATEGORIES[7].variants[v].name.toUpperCase(), 1.0, 0.25, new THREE.Vector3(x0 + 1.95, y + 0.42, B.z1 - 0.12), Math.PI, '#ffe6f0', undefined, 'vestidor');
      }
      b.box(0.06, CEIL - MEZZ - 0.6, 0.6, m.walnut, x0 - 0.03, y0 + (CEIL - MEZZ - 0.6) / 2, B.z1 - 0.35);
    }
    this.col(-19.6, -3.1, y0, y0 + 4.2, B.z1 - 0.75, B.z1);
    // pared de zapatillas: 6 marcas, cubículos retroiluminados 5 x 10
    const wx = B.x0 + 0.3;
    for (let s = 0; s < 6; s++) {
      const z0 = 1.2 + s * 1.68;
      const slots: THREE.Matrix4[] = [];
      for (let r = 0; r < 5; r++) {
        const y = y0 + 0.6 + r * 0.36;
        b.box(0.42, 0.025, 1.66, m.walnut, wx, y, z0 + 0.83);
        b.box(0.02, 0.012, 1.6, this.glow('vestidor', '#ffe6c8', 2.2), wx + 0.2, y + 0.33, z0 + 0.83);
        for (let k = 0; k < 10; k++) slots.push(this.slot(wx + 0.02, y + 0.012, z0 + 0.09 + k * 0.165, -Math.PI / 2));
      }
      b.box(0.02, 1.85, 1.66, m.black, B.x0 + 0.06, y0 + 1.42, z0 + 0.83);
      b.box(0.42, 1.9, 0.03, m.brass, wx, y0 + 1.45, z0);
      this.section('zapatilla', s, 'vestidor', new THREE.Box3(new THREE.Vector3(B.x0, y0 + 0.4, z0), new THREE.Vector3(wx + 0.8, y0 + 2.5, z0 + 1.68)), slots);
      this.label(CATEGORIES[8].variants[s].name.toUpperCase(), 1.1, 0.27, new THREE.Vector3(wx + 0.22, y0 + 2.55, z0 + 0.83), Math.PI / 2, '#ffffff', CATEGORIES[8].variants[s].color2, 'vestidor');
    }
    b.box(0.42, 1.9, 0.03, m.brass, wx, y0 + 1.45, 1.2 + 6 * 1.68);
    this.col(B.x0, wx + 0.25, y0, y0 + 2.6, 1.1, 11.4);
    // pared de gorras (tabique), 6 colores, 10 x 5 ganchos
    for (let s = 0; s < 6; s++) {
      const z0 = 0.6 + s * 1.16;
      const slots: THREE.Matrix4[] = [];
      b.box(0.04, 3.0, 1.12, M.walnut(1), -0.18, y0 + 1.95, z0 + 0.58);
      for (let r = 0; r < 10; r++) for (let k = 0; k < 5; k++) {
        const zz = z0 + 0.14 + k * 0.215, yy = y0 + 0.65 + r * 0.29;
        b.box(0.08, 0.02, 0.02, m.brass, -0.26, yy, zz);
        slots.push(this.slot(-0.36, yy - 0.04, zz, -Math.PI / 2, -0.15));
      }
      this.section('gorra', s, 'vestidor', new THREE.Box3(new THREE.Vector3(-1.0, y0 + 0.4, z0), new THREE.Vector3(0, y0 + 3.6, z0 + 1.16)), slots);
      this.label(CATEGORIES[9].variants[s].name.toUpperCase(), 0.9, 0.22, new THREE.Vector3(-0.22, y0 + 3.62, z0 + 0.58), -Math.PI / 2, '#ffffff', undefined, 'vestidor');
    }
    this.col(-0.5, 0, y0, y0 + 3.7, 0.5, 7.6);
    // isla central de vidrio + espejo de cuerpo entero + puf
    b.box(3.2, 0.95, 1.2, M.walnut(1), -10, y0 + 0.475, 5.2, 0, 0.03);
    b.box(3.3, 0.03, 1.3, m.clearGlass, -10, y0 + 0.97, 5.2);
    b.box(3.0, 0.02, 1.0, this.glow('vestidor', '#ffd6e8', 1.5), -10, y0 + 0.9, 5.2);
    this.col(-11.6, -8.4, y0, y0 + 1.1, 4.6, 5.8);
    b.box(1.2, 0.45, 1.2, M.velvet('#5a2a3a'), -10, y0 + 0.23, 8.2, 0, 0.15);
    this.col(-10.6, -9.4, y0, y0 + 0.5, 7.6, 8.8);
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.4), new THREE.MeshStandardMaterial({ color: 0xcfd6dd, roughness: 0.02, metalness: 1 }));
    mirror.position.set(-16, y0 + 1.4, 0.32);
    this.group.add(mirror);
    // luces del vestidor
    this.light('vestidor', new THREE.PointLight(0xffd6e8, 14, 12, 1.6)).position.set(-10, y0 + 3.5, 5);
    this.light('vestidor', new THREE.PointLight(0xff4fa3, 8, 10, 1.8)).position.set(-17, y0 + 3.2, 6);
    this.light('vestidor', new THREE.PointLight(0xffe6c8, 9, 10, 1.8)).position.set(-11, y0 + 2.5, 10.5);
    this.label('VESTIDOR', 2.6, 0.65, new THREE.Vector3(-10, y0 + 3.9, B.z1 - 0.08), Math.PI, '#ffe0ef', '#ff4fa3', 'vestidor');
  }

  // ------------------------------------------------------------------ SALA DE JUEGOS (planta alta)
  private buildJuegos() {
    const b = this.b, m = this.mats, y0 = MEZZ;
    // vitrinas de figuras: 7 series x (5 estantes x 20)
    for (let s = 0; s < 7; s++) {
      const x0 = 1.4 + s * 2.5;
      const slots: THREE.Matrix4[] = [];
      b.box(2.46, 2.8, 0.05, m.black, x0 + 1.23, y0 + 1.4, B.z1 - 0.05);
      for (let r = 0; r < 5; r++) {
        const y = y0 + 0.45 + r * 0.5;
        b.box(2.4, 0.02, 0.38, m.clearGlass, x0 + 1.23, y, B.z1 - 0.28);
        b.box(2.35, 0.012, 0.02, this.glow('juegos', '#9ff3ff', 2.4), x0 + 1.23, y + 0.46, B.z1 - 0.44);
        for (let k = 0; k < 20; k++) slots.push(this.slot(x0 + 0.1 + k * 0.119, y + 0.012, B.z1 - 0.28, Math.PI));
      }
      b.box(0.05, 2.9, 0.42, m.steel, x0, y0 + 1.45, B.z1 - 0.25);
      this.section('figura', s, 'juegos', new THREE.Box3(new THREE.Vector3(x0, y0 + 0.3, B.z1 - 1.0), new THREE.Vector3(x0 + 2.5, y0 + 3.0, B.z1)), slots);
      this.label(CATEGORIES[10].variants[s].name.toUpperCase(), 1.3, 0.32, new THREE.Vector3(x0 + 1.23, y0 + 3.1, B.z1 - 0.3), Math.PI, '#e8fdff', '#2ee6ff', 'juegos');
    }
    b.box(0.05, 2.9, 0.42, m.steel, 1.4 + 7 * 2.5, y0 + 1.45, B.z1 - 0.25);
    this.col(1.3, 19, y0, y0 + 3.1, B.z1 - 0.5, B.z1);
    // máquinas arcade
    for (let i = 0; i < 2; i++) {
      const az = 2.4 + i * 1.6;
      b.box(0.9, 1.9, 0.8, m.black, 19.1, y0 + 0.95, az, 0, 0.04);
      b.box(0.02, 0.6, 0.62, this.glow('juegos', ['#2ee6ff', '#ff4fa3'][i], 1.8), 18.64, y0 + 1.35, az);
      b.box(0.9, 0.2, 0.8, this.glow('juegos', ['#ff4fa3', '#2ee6ff'][i], 2.6), 19.1, y0 + 1.95, az);
      this.col(18.6, 19.6, y0, y0 + 2, az - 0.45, az + 0.45);
    }
    this.stations.push({ id: 'arcade', pos: new THREE.Vector3(18.5, y0 + 1.3, 3.2), zone: 'juegos', label: 'Arcade' });
    // sillón y pantalla gigante en el tabique
    b.box(0.04, 2.0, 3.6, m.screen, 0.2, y0 + 1.8, 4.4);
    b.box(1.0, 0.45, 3.0, M.velvet('#20304a'), 3.2, y0 + 0.23, 4.4, 0, 0.15);
    this.col(2.6, 3.8, y0, y0 + 0.6, 2.8, 6);
    // neones
    b.box(6, 0.05, 0.05, this.glow('juegos', '#2ee6ff', 3), 10, CEIL - 0.6, 6);
    b.box(6, 0.05, 0.05, this.glow('juegos', '#ff4fa3', 3), 10, CEIL - 0.9, 6.4);
    this.light('juegos', new THREE.PointLight(0x2ee6ff, 14, 14, 1.6)).position.set(10, y0 + 3.5, 6);
    this.light('juegos', new THREE.PointLight(0xff4fa3, 9, 10, 1.8)).position.set(17.5, y0 + 2.5, 3.5);
    this.light('juegos', new THREE.PointLight(0xe8fdff, 8, 10, 1.8)).position.set(9, y0 + 2.8, 10.5);
    this.label('GAME ROOM', 3.2, 0.8, new THREE.Vector3(10, y0 + 3.75, B.z1 - 0.1), Math.PI, '#e8fdff', '#2ee6ff', 'juegos');
  }

  // ------------------------------------------------------------------ TERRAZA
  private buildTerrace() {
    const b = this.b, m = this.mats, T = TERRACE;
    b.box(T.x1 - T.x0, 0.2, T.z1 - T.z0, m.deck, (T.x0 + T.x1) / 2, -0.1, (T.z0 + T.z1) / 2);
    const rail = (x0: number, x1: number, z0: number, z1: number) => {
      b.box(Math.max(0.03, x1 - x0), 1.1, Math.max(0.03, z1 - z0), m.clearGlass, (x0 + x1) / 2, 0.55, (z0 + z1) / 2);
      b.box(Math.max(0.06, x1 - x0), 0.05, Math.max(0.06, z1 - z0), m.brass, (x0 + x1) / 2, 1.12, (z0 + z1) / 2);
      this.col(x0 - 0.05, x1 + 0.05, 0, 1.3, z0 - 0.05, z1 + 0.05);
    };
    rail(T.x0, T.x1, T.z0, T.z0);
    rail(T.x1, T.x1, T.z0, T.z1);
    rail(T.x0, T.x1, T.z1, T.z1);
    // aro de básquet
    this.hoop.set(T.x1 - 0.9, 3.05, -6);
    b.box(0.12, 3.6, 0.12, m.steel, T.x1 - 0.35, 1.8, -6);
    b.box(0.05, 1.05, 1.8, m.clearGlass, T.x1 - 0.42, 3.4, -6);
    b.box(0.06, 0.42, 0.6, this.glow('terraza', '#ff5a3a', 1.2), T.x1 - 0.4, 3.25, -6);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.015, 8, 32), new THREE.MeshStandardMaterial({ color: 0xff5a1f, roughness: 0.4, metalness: 0.6 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.copy(this.hoop);
    this.group.add(ring);
    this.stations.push({ id: 'basquet', pos: new THREE.Vector3(T.x1 - 4, 1, -6), zone: 'terraza', label: 'Básquet' });
    // reposeras y macetas
    for (let i = 0; i < 2; i++) b.box(0.8, 0.35, 2.0, M.velvet('#d9d0c4'), 23 + i * 1.3, 0.18, -10.4, 0, 0.12);
    this.plant(21, 2.2, 0);
    this.plant(30.2, 2.2, 0);
    // caja fuerte
    b.box(0.7, 0.8, 0.6, m.steel, 25, 0.4, 2.4, 0, 0.03);
    b.box(0.2, 0.2, 0.02, this.glow('terraza', '#7dffb0', 1.5), 25, 0.55, 2.09);
    this.col(24.6, 25.4, 0, 0.9, 2.05, 2.75);
    this.stations.push({ id: 'cajafuerte', pos: new THREE.Vector3(25, 0.6, 2.1), zone: 'terraza', label: 'Caja fuerte' });
    this.light('terraza', new THREE.PointLight(0x7dffb0, 8, 12, 1.8)).position.set(25, 2.5, -4);
    this.light('terraza', new THREE.PointLight(0xffd0a0, 6, 10, 1.8)).position.set(29, 3.5, -6);
  }

  // ------------------------------------------------------------------ HABITACIÓN SECRETA
  private buildSecret() {
    const b = this.b, m = this.mats, S = SECRET;
    b.box(S.x1 - S.x0, 0.2, S.z1 - S.z0, m.ceil, (S.x0 + S.x1) / 2, -0.1, (S.z0 + S.z1) / 2);
    b.box(S.x1 - S.x0, 0.2, S.z1 - S.z0, m.ceil, (S.x0 + S.x1) / 2, 3.6, (S.z0 + S.z1) / 2);
    b.box(0.2, 3.6, S.z1 - S.z0, m.wallDark, S.x0 - 0.1, 1.8, (S.z0 + S.z1) / 2);
    b.box(0.2, 3.6, S.z1 - S.z0, m.wallDark, S.x1 + 0.1, 1.8, (S.z0 + S.z1) / 2);
    b.box(S.x1 - S.x0, 3.6, 0.2, m.wallDark, (S.x0 + S.x1) / 2, 1.8, S.z1 + 0.1);
    this.col(S.x0 - 0.2, S.x0, 0, 3.6, S.z0, S.z1);
    this.col(S.x1, S.x1 + 0.2, 0, 3.6, S.z0, S.z1);
    this.col(S.x0, S.x1, 0, 3.6, S.z1, S.z1 + 0.2);
    // escritorio con monitores
    b.box(3, 0.06, 0.9, m.black, -5.5, 0.76, 15.9);
    this.col(-7, -4, 0, 0.9, 15.4, 16.4);
    for (let i = 0; i < 3; i++) b.box(0.9, 0.55, 0.04, this.glow('secreta', '#7fa8ff', 1.2), -6.5 + i * 1, 1.35, 16.3, 0, 0);
    // pizarra de notas con hilos rojos
    b.box(0.04, 1.6, 2.6, M.proc({ color: 0xffffff, roughness: 1 }, { color: `diffuseColor.rgb = vec3(0.55, 0.42, 0.28) * (0.8 + 0.3 * pn2(vLP.yz * 40.0));` }), S.x0 + 0.05, 1.7, 14.5);
    for (let i = 0; i < 9; i++) b.box(0.01, 0.2, 0.15, m.white, S.x0 + 0.08, 1.2 + (i % 3) * 0.45, 13.6 + Math.floor(i / 3) * 0.8, 0, 0);
    // espejo del final
    this.mirror = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.2), new THREE.MeshStandardMaterial({ color: 0xbfc8d0, roughness: 0.05, metalness: 1 }));
    this.mirror.position.set(S.x1 - 0.02, 1.4, 14.2);
    this.mirror.rotation.y = -Math.PI / 2;
    this.group.add(this.mirror);
    this.stations.push({ id: 'espejo', pos: new THREE.Vector3(S.x1 - 0.4, 1.4, 14.2), zone: 'secreta', label: 'Espejo' });
    this.light('secreta', new THREE.PointLight(0xff2a2a, 4, 8, 1.8)).position.set(-5.5, 2.6, 14.5);
    // puerta secreta: panel con cuadro en la pared sur del living
    const panel = new THREE.Group();
    const pw = new THREE.Mesh(new THREE.BoxGeometry(2, 3.2, 0.12), M.walnut(1));
    const art = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.8), M.proc({ color: 0xffffff, roughness: 0.6 }, { color: `vec2 p = vLP.xy * 1.6; float a = pfbm(p * 2.0); diffuseColor.rgb = mix(vec3(0.08, 0.06, 0.12), vec3(0.75, 0.2, 0.25), smoothstep(0.45, 0.6, a)) + vec3(0.9, 0.7, 0.3) * smoothstep(0.02, 0.0, abs(length(p) - 0.6));` }));
    art.position.z = -0.065;
    art.rotation.y = Math.PI;
    panel.add(pw, art);
    panel.position.set(-5.6, 1.6, B.z1 - 0.02);
    this.door('door-secreta', panel, -6.6, -4.6, 0, 3.2, B.z1 - 0.1, B.z1 + 0.3, new THREE.Vector3(2.1, 0, 0));
  }

  // ------------------------------------------------------------------ dinámica
  openDoor(id: string) {
    const d = this.doors.find((x) => x.id === id);
    if (d) d.open = true;
  }

  isDoorOpen(id: string) {
    return !!this.doors.find((x) => x.id === id)?.open;
  }

  setZoneLevel(zone: ZoneId, level: number) {
    this.rig(zone).target = level;
  }

  update(dt: number, t: number) {
    this.timeU.value = t;
    for (const d of this.doors) {
      const target = d.open ? 1 : 0;
      if (d.t !== target) {
        d.t += Math.sign(target - d.t) * Math.min(Math.abs(target - d.t), dt * 0.9);
        d.mesh.position.copy(d.base).addScaledVector(d.slide, d.t);
        if (d.t > 0.5) d.collider.makeEmpty();
      }
    }
    for (const [, r] of this.rigs) {
      r.level += (r.target - r.level) * Math.min(1, dt * 1.5);
      const f = r.level * this.power;
      for (const l of r.lights) l.l.intensity = l.base * f;
      for (const m of r.mats) m.m.emissiveIntensity = m.base * Math.max(0.05, f);
      for (const u of r.uniforms) u.u.value = u.base * Math.max(0.05, f);
    }
    const wheel = this.group.getObjectByName('ruleta');
    if (wheel) wheel.rotation.y += dt * 0.4;
  }

  /** Altura del piso según dónde está el jugador (planta baja, escalera, entrepiso, terraza). */
  groundAt(x: number, z: number, y: number): number {
    const onStairs = z > STAIRS.z0 - 0.1 && z < STAIRS.z1 + 0.1 && x < STAIRS.xStart && x > STAIRS.xEnd;
    if (onStairs) {
      const ramp = (MEZZ * (STAIRS.xStart - x)) / (STAIRS.xStart - STAIRS.xEnd);
      if (y >= ramp - 0.5) return ramp;
    }
    if (y > MEZZ - 0.8) {
      if (z >= 0 && x > B.x0 && x < B.x1 && z < B.z1) return MEZZ;
      if (x >= LANDING.x0 && x <= LANDING.x1 + 0.05 && z >= LANDING.z0 && z <= LANDING.z1) return MEZZ;
    }
    return 0;
  }
}
