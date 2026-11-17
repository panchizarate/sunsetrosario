import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { TrashTypeId } from './config';

const nonIndexed = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const clean = parts.map((p) => {
    const g = nonIndexed(p);
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    return g;
  });
  const m = mergeGeometries(clean, false)!;
  m.computeVertexNormals();
  return m;
}

/** Geometrías de basura (orientadas para flotar) + paleta de colores por tipo. */
export function trashGeometry(id: TrashTypeId): { geo: THREE.BufferGeometry; colors: string[] } {
  switch (id) {
    case 'lata': {
      const g = new THREE.CylinderGeometry(0.13, 0.13, 0.36, 10);
      g.rotateZ(Math.PI / 2);
      g.translate(0, 0.05, 0);
      return { geo: g, colors: ['#e63946', '#c0c7cc', '#3a86ff', '#ffbe0b', '#2a9d8f'] };
    }
    case 'bolsa': {
      const g = new THREE.IcosahedronGeometry(0.45, 1);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const n = Math.sin(x * 9 + z * 7) * 0.08;
        p.setXYZ(i, x * (1.1 + n), y * 0.32 + n * 0.5, z * (0.85 - n));
      }
      g.translate(0, 0.04, 0);
      return { geo: g, colors: ['#f4f1ea', '#2b2d42', '#8ecae6', '#e9edc9'] };
    }
    case 'botella': {
      const body = new THREE.CylinderGeometry(0.15, 0.15, 0.5, 10);
      const shoulder = new THREE.CylinderGeometry(0.06, 0.15, 0.16, 10);
      shoulder.translate(0, 0.33, 0);
      const neck = new THREE.CylinderGeometry(0.055, 0.055, 0.14, 8);
      neck.translate(0, 0.48, 0);
      const g = merge([body, shoulder, neck]);
      g.rotateZ(Math.PI / 2);
      g.translate(0, 0.06, 0);
      return { geo: g, colors: ['#52b788', '#a8dadc', '#90e0ef', '#7a5c3a', '#e0fbfc'] };
    }
    case 'neumatico': {
      const g = new THREE.TorusGeometry(0.55, 0.24, 8, 16);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0.05, 0);
      return { geo: g, colors: ['#2b2b2b', '#3a3a3a', '#1f1f1f'] };
    }
    case 'tambor': {
      const body = new THREE.CylinderGeometry(0.45, 0.45, 1.25, 14);
      const r1 = new THREE.TorusGeometry(0.46, 0.04, 4, 14);
      r1.rotateX(Math.PI / 2);
      r1.translate(0, 0.3, 0);
      const r2 = r1.clone();
      r2.translate(0, -0.6, 0);
      const g = merge([body, r1, r2]);
      g.rotateZ(Math.PI / 2);
      g.translate(0, 0.08, 0);
      return { geo: g, colors: ['#c8553d', '#264653', '#f4a261', '#2a9d8f'] };
    }
    case 'heladera': {
      const body = new THREE.BoxGeometry(0.9, 1.7, 0.75);
      const handle = new THREE.BoxGeometry(0.06, 0.5, 0.06);
      handle.translate(0.32, 0.25, 0.4);
      const line = new THREE.BoxGeometry(0.92, 0.03, 0.77);
      line.translate(0, 0.3, 0);
      const g = merge([body, handle, line]);
      g.rotateZ(1.25);
      g.rotateY(0.3);
      g.translate(0, -0.15, 0);
      return { geo: g, colors: ['#e9e4d8', '#d8d2c0', '#c9d6df'] };
    }
    case 'auto': {
      const body = new THREE.BoxGeometry(1.9, 0.75, 4.2);
      const cabin = new THREE.BoxGeometry(1.7, 0.65, 2.1);
      cabin.translate(0, 0.68, -0.25);
      const wheels: THREE.BufferGeometry[] = [];
      for (const [x, z] of [[-0.95, 1.3], [0.95, 1.3], [-0.95, -1.3], [0.95, -1.3]]) {
        const w = new THREE.CylinderGeometry(0.38, 0.38, 0.25, 10);
        w.rotateZ(Math.PI / 2);
        w.translate(x, -0.35, z);
        wheels.push(w);
      }
      const g = merge([body, cabin, ...wheels]);
      g.rotateZ(0.12);
      g.rotateX(-0.08);
      g.translate(0, -0.15, 0);
      return { geo: g, colors: ['#9c4a2f', '#5c6b73', '#7b2d26', '#3d5a80'] };
    }
    case 'contenedor': {
      const body = new THREE.BoxGeometry(2.5, 2.5, 6.2);
      const ribs: THREE.BufferGeometry[] = [];
      for (let i = -5; i <= 5; i++) {
        const r = new THREE.BoxGeometry(2.56, 2.3, 0.1);
        r.translate(0, 0, i * 0.55);
        ribs.push(r);
      }
      const g = merge([body, ...ribs]);
      g.rotateZ(0.18);
      g.translate(0, -0.55, 0);
      return { geo: g, colors: ['#c1121f', '#1d4e89', '#e09f3e', '#335c67'] };
    }
  }
}

/** Barco recolector. Mira hacia +Z local. */
export function makeBoat(primary: string, accent: string, scale = 1) {
  const g = new THREE.Group();
  const hullGeo = new THREE.BoxGeometry(2.4, 1, 5.2, 4, 2, 8);
  const p = hullGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i);
    const z = p.getZ(i);
    const front = Math.max(0, z / 2.6); // 0..1 hacia la proa
    x *= 1 - Math.pow(front, 2.2) * 0.85;
    if (y < 0) x *= 0.72;
    y += Math.pow(front, 2) * 0.35 * (y > 0 ? 1 : 0.4);
    p.setXYZ(i, x, y, z);
  }
  hullGeo.computeVertexNormals();
  const hull = new THREE.Mesh(hullGeo, new THREE.MeshStandardMaterial({ color: primary, roughness: 0.55 }));
  hull.position.y = 0.2;
  g.add(hull);

  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.46, 0.18, 4.2), new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 }));
  stripe.position.set(0, 0.5, -0.3);
  g.add(stripe);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.08, 4.4), new THREE.MeshStandardMaterial({ color: '#b98b5e', roughness: 0.8 }));
  deck.position.set(0, 0.72, -0.2);
  g.add(deck);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 1.5), new THREE.MeshStandardMaterial({ color: '#f8f9fa', roughness: 0.4 }));
  cabin.position.set(0, 1.3, -1.2);
  g.add(cabin);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.45, 1.2), new THREE.MeshStandardMaterial({ color: '#7fd1e8', roughness: 0.1, metalness: 0.3 }));
  glass.position.set(0, 1.5, -1.1);
  g.add(glass);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 1.7), new THREE.MeshStandardMaterial({ color: accent }));
  roof.position.set(0, 1.92, -1.2);
  g.add(roof);

  // motor fuera de borda
  const motor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.5), new THREE.MeshStandardMaterial({ color: '#222', roughness: 0.4 }));
  motor.position.set(0, 0.6, -2.75);
  g.add(motor);

  // contenedor de carga (se llena)
  const bin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.5, 1.4), new THREE.MeshStandardMaterial({ color: '#2d6a4f', roughness: 0.7 }));
  bin.position.set(0, 0.98, 0.6);
  g.add(bin);
  const load = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 1), new THREE.MeshStandardMaterial({ color: '#8d99ae', roughness: 0.9, flatShading: true }));
  load.position.set(0, 1.0, 0.6);
  load.scale.set(1.15, 0.0001, 1.05);
  g.add(load);

  // brazos y red delantera
  const armMat = new THREE.MeshStandardMaterial({ color: '#ffb703', roughness: 0.4, metalness: 0.3 });
  const netGroup = new THREE.Group();
  netGroup.position.set(0, 0.45, 2.6);
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.9, 6), armMat);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = s * 0.5;
    arm.position.set(s * 0.8, 0, 0.4);
    netGroup.add(arm);
  }
  const net = new THREE.Mesh(
    new THREE.TorusGeometry(1.0, 0.05, 6, 24, Math.PI),
    armMat,
  );
  net.rotation.x = Math.PI / 2;
  net.rotation.z = Math.PI;
  net.position.set(0, -0.05, 0.75);
  netGroup.add(net);
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(1.0, 20, 0, Math.PI),
    new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, side: THREE.DoubleSide, wireframe: true }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = Math.PI;
  mesh.position.set(0, -0.1, 0.75);
  netGroup.add(mesh);
  g.add(netGroup);

  // grúa (visible desde Grúa 1)
  const crane = new THREE.Group();
  const mast = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.8, 0.22), armMat);
  mast.position.set(0.7, 1.6, 0.2);
  crane.add(mast);
  const boom = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 2.6), armMat);
  boom.position.set(0.7, 2.45, 1.3);
  boom.rotation.x = -0.35;
  crane.add(boom);
  const hook = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 4), new THREE.MeshBasicMaterial({ color: '#333' }));
  hook.position.set(0.7, 2.25, 2.45);
  crane.add(hook);
  crane.visible = false;
  g.add(crane);

  // bandera
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.2, 4), new THREE.MeshBasicMaterial({ color: '#555' }));
  pole.position.set(-0.6, 2.5, -1.7);
  g.add(pole);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.38), new THREE.MeshLambertMaterial({ color: '#74c0fc', side: THREE.DoubleSide }));
  flag.position.set(-0.6, 2.9, -2.0);
  flag.rotation.y = Math.PI / 2;
  g.add(flag);

  g.scale.setScalar(scale);
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = true;
  });
  return { group: g, load, crane, flag, netGroup };
}

export type BoatModel = ReturnType<typeof makeBoat>;

/** Pez simple (cuerpo + cola) */
export function makeFishGeo() {
  const body = new THREE.SphereGeometry(0.25, 8, 6);
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
