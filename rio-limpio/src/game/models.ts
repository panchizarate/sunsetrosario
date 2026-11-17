import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TrashTypeId, VehicleId } from './config';

const nonIndexed = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((p) => {
    const g = nonIndexed(p);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    return g;
  });
  const m = mergeGeometries(clean, false)!;
  m.computeVertexNormals();
  return m;
}

/** Deformación suave pseudoaleatoria (abolladuras) para que nada se vea perfecto. */
function dent(g: THREE.BufferGeometry, amt: number, freq = 7) {
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * freq + y * 3.1) * Math.cos(z * freq * 0.8 + x * 1.7);
    p.setXYZ(i, x * (1 + n * amt), y * (1 + n * amt * 0.6), z * (1 - n * amt));
  }
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ basura
export function trashGeometry(id: TrashTypeId, high: boolean): { geo: THREE.BufferGeometry; colors: string[] } {
  const seg = high ? 12 : 8;
  switch (id) {
    case 'lata': {
      const body = new THREE.CylinderGeometry(0.13, 0.13, 0.36, seg);
      const rim = new THREE.TorusGeometry(0.12, 0.012, 4, seg);
      rim.rotateX(Math.PI / 2);
      rim.translate(0, 0.18, 0);
      const g = dent(merge([body, rim]), 0.06, 11);
      g.rotateZ(Math.PI / 2);
      g.translate(0, 0.02, 0);
      return { geo: g, colors: ['#c1121f', '#d8dde0', '#1d4ed8', '#e9b10a', '#15803d', '#f1f1f1'] };
    }
    case 'bolsa': {
      const g = new THREE.IcosahedronGeometry(0.45, high ? 2 : 1);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const n = Math.sin(x * 9 + z * 7) * 0.1 + Math.sin(y * 13 + x * 5) * 0.05;
        p.setXYZ(i, x * (1.15 + n), y * 0.3 + n * 0.4, z * (0.85 - n));
      }
      g.computeVertexNormals();
      g.translate(0, 0.0, 0);
      return { geo: g, colors: ['#f2f0ea', '#1f2328', '#9bc7dc', '#e8ecd2', '#3b6db0'] };
    }
    case 'botella': {
      const pts: THREE.Vector2[] = [];
      const prof = [[0, -0.28], [0.13, -0.28], [0.15, -0.25], [0.15, 0.1], [0.12, 0.2], [0.06, 0.27], [0.055, 0.36], [0.065, 0.37], [0.065, 0.4], [0, 0.4]];
      for (const [r, y] of prof) pts.push(new THREE.Vector2(r, y));
      const g = new THREE.LatheGeometry(pts, seg);
      g.rotateZ(Math.PI / 2);
      g.translate(0, 0.04, 0);
      return { geo: g, colors: ['#3f9e6b', '#b9dfe8', '#8fd3e8', '#7a4f25', '#e6f6fa'] };
    }
    case 'neumatico': {
      const g = new THREE.TorusGeometry(0.55, 0.24, high ? 10 : 7, high ? 22 : 14);
      // dibujo de la banda de rodadura
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const a = Math.atan2(y, x);
        const rr = Math.hypot(x, y);
        const k = 1 + (rr > 0.7 ? 0.03 * Math.sign(Math.sin(a * 24)) : 0);
        p.setXYZ(i, x * k, y * k, z);
      }
      g.computeVertexNormals();
      g.rotateX(Math.PI / 2);
      return { geo: g, colors: ['#232323', '#2c2c2c', '#1b1b1b'] };
    }
    case 'tambor': {
      const body = new THREE.CylinderGeometry(0.45, 0.45, 1.25, seg + 4);
      const rings = [0.3, -0.3, 0.6, -0.6].map((y) => {
        const r1 = new THREE.TorusGeometry(0.46, 0.035, 4, seg + 4);
        r1.rotateX(Math.PI / 2);
        r1.translate(0, y, 0);
        return r1;
      });
      const g = dent(merge([body, ...rings]), 0.035, 5);
      g.rotateZ(Math.PI / 2);
      g.translate(0, 0.05, 0);
      return { geo: g, colors: ['#b5462f', '#21424f', '#d9822b', '#2a7d73', '#7d8a2e'] };
    }
    case 'heladera': {
      const body = new THREE.BoxGeometry(0.9, 1.7, 0.75, 2, 4, 2);
      const handle = new THREE.BoxGeometry(0.06, 0.5, 0.06);
      handle.translate(0.32, 0.25, 0.4);
      const line = new THREE.BoxGeometry(0.92, 0.03, 0.77);
      line.translate(0, 0.3, 0);
      const g = dent(merge([body, handle, line]), 0.03, 3);
      g.rotateZ(1.3);
      g.rotateY(0.3);
      g.translate(0, -0.18, 0);
      return { geo: g, colors: ['#e9e4d8', '#d8d2c0', '#c9d6df', '#d9cbb0'] };
    }
    case 'auto': {
      const body = new THREE.BoxGeometry(1.9, 0.7, 4.3, 2, 1, 4);
      const hood = body.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < hood.count; i++) if (Math.abs(hood.getZ(i)) > 1.8 && hood.getY(i) > 0) hood.setY(i, hood.getY(i) - 0.15);
      const cabin = new THREE.BoxGeometry(1.7, 0.62, 2.0);
      const cp = cabin.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < cp.count; i++) if (cp.getY(i) > 0) cp.setZ(i, cp.getZ(i) * 0.75);
      cabin.translate(0, 0.66, -0.25);
      const wheels: THREE.BufferGeometry[] = [];
      for (const [x, z] of [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35], [0.95, -1.35]]) {
        const w = new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12);
        w.rotateZ(Math.PI / 2);
        w.translate(x, -0.35, z);
        wheels.push(w);
      }
      const g = dent(merge([body, cabin, ...wheels]), 0.025, 2);
      g.rotateZ(0.14);
      g.rotateX(-0.08);
      g.translate(0, -0.2, 0);
      return { geo: g, colors: ['#8e3b25', '#56636b', '#6e2a22', '#3a5579', '#a07c3c'] };
    }
    case 'contenedor': {
      const body = new THREE.BoxGeometry(2.5, 2.6, 6.2);
      const ribs: THREE.BufferGeometry[] = [];
      for (let i = -5; i <= 5; i++) {
        const r = new THREE.BoxGeometry(2.56, 2.4, 0.1);
        r.translate(0, 0, i * 0.55);
        ribs.push(r);
      }
      const g = merge([body, ...ribs]);
      g.rotateZ(0.2);
      g.rotateX(0.05);
      g.translate(0, -0.65, 0);
      return { geo: g, colors: ['#a61b1b', '#1d4e89', '#d08a2c', '#2f5d5f', '#5b6b2f'] };
    }
    case 'barco': {
      // pesquero oxidado medio hundido
      const hullGeo = new THREE.BoxGeometry(5, 3.2, 15, 6, 3, 14);
      const p = hullGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        let x = p.getX(i);
        const y = p.getY(i), z = p.getZ(i);
        const front = Math.max(0, z / 7.5);
        x *= 1 - Math.pow(front, 2.2) * 0.9;
        if (y < 0) x *= 0.7;
        p.setXYZ(i, x, y + Math.pow(front, 2) * 0.8, z);
      }
      const cabin = new THREE.BoxGeometry(3.4, 2.6, 4);
      cabin.translate(0, 2.8, -3.5);
      const mast = new THREE.CylinderGeometry(0.15, 0.2, 7, 6);
      mast.translate(0, 4.8, 2.5);
      const boom = new THREE.CylinderGeometry(0.1, 0.1, 5, 5);
      boom.rotateZ(1.1);
      boom.translate(1.6, 5.5, 2.5);
      const stack = new THREE.CylinderGeometry(0.5, 0.6, 2, 8);
      stack.translate(0, 5, -4.8);
      const g = dent(merge([hullGeo, cabin, mast, boom, stack]), 0.02, 0.7);
      g.rotateZ(0.32);
      g.rotateX(-0.09);
      g.translate(0, -1.3, 0);
      return { geo: g, colors: ['#7a3b1e', '#4e5a5e', '#8a4a24', '#355055'] };
    }
  }
}

export function trashMaterial(id: TrashTypeId): THREE.MeshStandardMaterial {
  switch (id) {
    case 'lata':
      return new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.85 });
    case 'botella':
      return new THREE.MeshStandardMaterial({ roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.72, depthWrite: true });
    case 'bolsa':
      return new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0, transparent: true, opacity: 0.92 });
    case 'neumatico':
      return new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0 });
    case 'tambor':
    case 'contenedor':
      return new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.55 });
    case 'auto':
    case 'barco':
      return new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0.4 });
    default:
      return new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.15 });
  }
}

// ------------------------------------------------------------------ vehículos
export interface BoatModel {
  group: THREE.Group;
  load: THREE.Mesh;
  crane: THREE.Group;
  flag: THREE.Mesh;
  netGroup: THREE.Group;
  oars: THREE.Group | null;
  field: THREE.Mesh; // halo del imán / aspiradora
  kind: VehicleId;
  length: number; // largo aprox. (para ubicar la red)
}

const std = (color: string, rough = 0.6, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

function shapedHull(w: number, h: number, l: number, taper: number, rise: number) {
  const g = new THREE.BoxGeometry(w, h, l, 6, 3, 12);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i);
    const z = p.getZ(i);
    const front = Math.max(0, z / (l / 2));
    const back = Math.max(0, -z / (l / 2));
    x *= 1 - Math.pow(front, 2.2) * taper - Math.pow(back, 6) * 0.15;
    if (y < 0) x *= 0.62 + 0.38 * (1 + y / (h / 2)) * 0.5;
    y += Math.pow(front, 2) * rise * (y > 0 ? 1 : 0.35);
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

function addCraneAndNet(g: THREE.Group, frontZ: number, deckY: number, scale: number) {
  const armMat = std('#ffb703', 0.4, 0.3);
  const netGroup = new THREE.Group();
  netGroup.position.set(0, deckY - 0.3, frontZ);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.9, 6), armMat);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = s * 0.5;
    arm.position.set(s * 0.8, 0, 0.4);
    netGroup.add(arm);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.05, 6, 24, Math.PI), armMat);
  ring.rotation.x = Math.PI / 2;
  ring.rotation.z = Math.PI;
  ring.position.set(0, -0.05, 0.75);
  netGroup.add(ring);
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(1.0, 20, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, side: THREE.DoubleSide, wireframe: true }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = Math.PI;
  mesh.position.set(0, -0.1, 0.75);
  netGroup.add(mesh);
  netGroup.visible = false;
  g.add(netGroup);

  const crane = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.8, 0.22), armMat);
  mast.position.set(0.7, deckY + 0.9, frontZ - 2.4);
  crane.add(mast);
  const boom = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 2.6), armMat);
  boom.position.set(0.7, deckY + 1.75, frontZ - 1.3);
  boom.rotation.x = -0.35;
  crane.add(boom);
  const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 4), new THREE.MeshBasicMaterial({ color: '#333' }));
  hook.position.set(0.7, deckY + 1.55, frontZ - 0.15);
  crane.add(hook);
  crane.visible = false;
  crane.scale.setScalar(scale);
  g.add(crane);
  return { netGroup, crane };
}

function fieldMesh() {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1, 64),
    new THREE.MeshBasicMaterial({ color: '#8fe3ff', transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.15;
  m.visible = false;
  return m;
}

export function makeVehicle(kind: VehicleId, primary = '#ffffff', accent = '#ff7b39', scale = 1): BoatModel {
  const g = new THREE.Group();
  let load: THREE.Mesh, flag: THREE.Mesh, oars: THREE.Group | null = null, length = 5.2, deckY = 0.72;
  const loadMat = std('#8d99ae', 0.9);
  (loadMat as THREE.MeshStandardMaterial).flatShading = true;

  if (kind === 'remo') {
    // bote de madera a remo
    const hull = new THREE.Mesh(shapedHull(1.5, 0.6, 3.8, 0.9, 0.25), std('#9c6b3f', 0.75));
    hull.position.y = 0.15;
    g.add(hull);
    const inside = new THREE.Mesh(shapedHull(1.25, 0.1, 3.4, 0.9, 0.2), std('#c49a6c', 0.85));
    inside.position.y = 0.42;
    g.add(inside);
    for (const z of [-0.6, 0.5]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.3), std('#7a5230', 0.8));
      seat.position.set(0, 0.5, z);
      g.add(seat);
    }
    // remero
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.45, 4, 8), std('#ff7b39', 0.7));
    body.position.set(0, 0.95, -0.55);
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), std('#e0b08a', 0.7));
    head.position.set(0, 1.42, -0.55);
    g.add(head);
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.12, 12), std('#ffd23f', 0.7));
    hat.position.set(0, 1.55, -0.55);
    g.add(hat);
    oars = new THREE.Group();
    for (const s of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * 0.7, 0.75, -0.4);
      const oar = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 5), std('#d9b382', 0.7));
      oar.rotation.z = s * 1.25;
      oar.position.set(s * 0.95, -0.35, 0);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.18), std('#d9b382', 0.7));
      blade.position.set(s * 1.0, -0.4, 0);
      blade.rotation.z = s * 1.25;
      oar.add(blade);
      pivot.add(oar);
      oars.add(pivot);
    }
    g.add(oars);
    load = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 1), loadMat);
    load.position.set(0, 0.55, 1.0);
    load.scale.set(1.1, 0.0001, 1.1);
    g.add(load);
    flag = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.01), std('#fff'));
    g.add(flag);
    length = 3.8;
    deckY = 0.5;
  } else if (kind === 'lancha') {
    const hull = new THREE.Mesh(shapedHull(2.4, 1, 5.2, 0.85, 0.35), std(primary, 0.45, 0.05));
    hull.position.y = 0.2;
    g.add(hull);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.18, 4.2), std(accent, 0.5));
    stripe.position.set(0, 0.5, -0.3);
    g.add(stripe);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 4.4), std('#b98b5e', 0.8));
    deck.position.set(0, 0.72, -0.2);
    g.add(deck);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.5), std('#f8f9fa', 0.4));
    cabin.position.set(0, 1.3, -1.2);
    g.add(cabin);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.45, 1.2), std('#7fd1e8', 0.05, 0.6));
    glass.position.set(0, 1.5, -1.1);
    g.add(glass);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 1.7), std(accent, 0.5));
    roof.position.set(0, 1.92, -1.2);
    g.add(roof);
    const motor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.5), std('#222', 0.35, 0.3));
    motor.position.set(0, 0.6, -2.75);
    g.add(motor);
    const bin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.4), std('#2d6a4f', 0.7));
    bin.position.set(0, 0.98, 0.6);
    g.add(bin);
    load = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 1), loadMat);
    load.position.set(0, 1.0, 0.6);
    load.scale.set(1.15, 0.0001, 1.05);
    g.add(load);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 4), std('#555'));
    pole.position.set(-0.6, 2.5, -1.7);
    g.add(pole);
    flag = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.38), new THREE.MeshStandardMaterial({ color: '#74c0fc', side: THREE.DoubleSide }));
    flag.position.set(-0.6, 2.9, -2.0);
    flag.rotation.y = Math.PI / 2;
    g.add(flag);
  } else {
    // barcaza industrial
    const hull = new THREE.Mesh(shapedHull(5.2, 1.6, 12, 0.35, 0.3), std('#2f4858', 0.55, 0.3));
    hull.position.y = 0.2;
    g.add(hull);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(5.3, 0.3, 11), std('#e85d04', 0.5));
    stripe.position.set(0, 0.85, -0.3);
    g.add(stripe);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.1, 11.4), std('#55606a', 0.8, 0.2));
    deck.position.set(0, 1.02, -0.2);
    g.add(deck);
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.4, 2.4), std('#f1f3f5', 0.45));
    bridge.position.set(0, 2.25, -4.5);
    g.add(bridge);
    const win = new THREE.Mesh(new THREE.BoxGeometry(3.64, 0.6, 2.0), std('#7fd1e8', 0.05, 0.6));
    win.position.set(0, 2.9, -4.4);
    g.add(win);
    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 1.6, 10), std('#e85d04', 0.5));
    stack.position.set(1.2, 4.0, -5.0);
    g.add(stack);
    // bodega abierta
    const holdWalls = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.2, 6), std('#3d5a6c', 0.7, 0.2));
    holdWalls.position.set(0, 1.6, 1.4);
    g.add(holdWalls);
    load = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), loadMat);
    load.position.set(0, 1.9, 1.4);
    load.scale.set(1.2, 0.0001, 1.7);
    g.add(load);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 4), std('#555'));
    pole.position.set(-1.4, 4.2, -5.2);
    g.add(pole);
    flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshStandardMaterial({ color: '#74c0fc', side: THREE.DoubleSide }));
    flag.position.set(-1.4, 4.7, -5.6);
    flag.rotation.y = Math.PI / 2;
    g.add(flag);
    length = 12;
    deckY = 1.1;
  }

  const { netGroup, crane } = addCraneAndNet(g, length / 2, deckY, kind === 'barcaza' ? 2.2 : 1);
  if (kind === 'barcaza') netGroup.scale.setScalar(1.6);
  const field = fieldMesh();
  g.add(field);
  g.scale.setScalar(scale);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o !== field) o.castShadow = true;
  });
  return { group: g, load, crane, flag, netGroup, oars, field, kind, length };
}

// ------------------------------------------------------------------ dron
export function makeDrone() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.7), std('#f1f3f5', 0.35, 0.2));
  g.add(body);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), std('#2bb3d6', 0.1, 0.4));
  dome.position.y = 0.1;
  g.add(dome);
  const rotors: THREE.Mesh[] = [];
  for (const [x, z] of [[0.55, 0.55], [-0.55, 0.55], [0.55, -0.55], [-0.55, -0.55]]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.8), std('#333', 0.5));
    arm.position.set(x / 2, 0, z / 2);
    arm.rotation.y = Math.atan2(x, z);
    g.add(arm);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.02, 0.08), std('#222', 0.4));
    rotor.position.set(x, 0.12, z);
    g.add(rotor);
    rotors.push(rotor);
  }
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 6), new THREE.MeshBasicMaterial({ color: '#7dffb0' }));
  led.position.set(0, -0.08, 0.36);
  g.add(led);
  const cargo = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 0.35), std('#8d99ae', 0.9));
  cargo.position.y = -0.4;
  cargo.visible = false;
  g.add(cargo);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { group: g, rotors, cargo };
}
export type DroneModel = ReturnType<typeof makeDrone>;

/** Pez simple (cuerpo + cola) */
export function makeFishGeo() {
  const body = new THREE.SphereGeometry(0.25, 10, 8);
  body.scale(1, 0.6, 2.0);
  const tail = new THREE.ConeGeometry(0.22, 0.4, 4);
  tail.rotateX(-Math.PI / 2);
  tail.translate(0, 0, -0.6);
  return merge([body, tail]);
}

/** Pájaro: dos alas planas en V (se animan con escala Y). */
export function makeBirdGeo() {
  const g = new THREE.BufferGeometry();
  const v = new Float32Array([
    0, 0, 0.3, -1.1, 0.25, -0.1, 0, 0, -0.3,
    0, 0, 0.3, 0, 0, -0.3, 1.1, 0.25, -0.1,
  ]);
  g.setAttribute('position', new THREE.BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}
