import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { ItemKind } from './config';

// Geometrías procedurales de los objetos. Todas con el "piso" del objeto en y=0
// (para apoyarlo en un estante) y mirando hacia -Z (frente).

function merge(parts: THREE.BufferGeometry[]) {
  const clean = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    return g;
  });
  return mergeGeometries(clean, false)!;
}
const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
  g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  return g;
};
const lathe = (pts: [number, number][], seg = 24) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

export function itemGeometry(kind: ItemKind, variant: number): THREE.BufferGeometry {
  switch (kind) {
    case 'libro':
      return at(new RoundedBoxGeometry(0.05, 0.27, 0.19, 2, 0.006), 0, 0.135, 0);
    case 'almohadon': {
      const g = new RoundedBoxGeometry(0.46, 0.46, 0.16, 6, 0.07);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const k = 1 - Math.pow(Math.max(Math.abs(x), Math.abs(y)) / 0.23, 2) * 0.55;
        p.setZ(i, z * Math.max(0.35, k));
      }
      g.computeVertexNormals();
      return at(g, 0, 0.23, 0);
    }
    case 'jarron':
      return lathe([[0, 0], [0.05, 0], [0.065, 0.02], [0.085, 0.09], [0.08, 0.15], [0.04, 0.22], [0.035, 0.27], [0.045, 0.3], [0.04, 0.3], [0.03, 0.27], [0, 0.26]], 28);
    case 'escultura': {
      const k = new THREE.TorusKnotGeometry(0.06, 0.018, 96, 12, 2, 3);
      at(k, 0, 0.16, 0);
      const base = new THREE.CylinderGeometry(0.06, 0.07, 0.04, 24);
      at(base, 0, 0.02, 0);
      return merge([k, base]);
    }
    case 'vela': {
      const body = new THREE.CylinderGeometry(0.035, 0.035, 0.16, 20);
      at(body, 0, 0.08, 0);
      const holder = lathe([[0, 0], [0.05, 0], [0.05, 0.01], [0.042, 0.015], [0.042, 0.03], [0, 0.03]], 20);
      const wick = new THREE.CylinderGeometry(0.002, 0.002, 0.015, 4);
      at(wick, 0, 0.167, 0);
      return merge([body, holder, wick]);
    }
    case 'botella': {
      const prof: [number, number][][] = [
        [[0, 0], [0.036, 0], [0.038, 0.005], [0.038, 0.2], [0.03, 0.24], [0.014, 0.27], [0.013, 0.33], [0.015, 0.335], [0, 0.335]], // vino
        [[0, 0], [0.045, 0], [0.048, 0.006], [0.048, 0.17], [0.04, 0.19], [0.016, 0.205], [0.016, 0.25], [0.022, 0.25], [0.022, 0.275], [0, 0.275]], // whisky
        [[0, 0], [0.04, 0], [0.042, 0.006], [0.042, 0.19], [0.03, 0.22], [0.016, 0.235], [0.016, 0.27], [0.02, 0.27], [0.02, 0.29], [0, 0.29]], // gin
        [[0, 0], [0.04, 0], [0.041, 0.005], [0.041, 0.18], [0.034, 0.23], [0.017, 0.28], [0.016, 0.33], [0.019, 0.335], [0, 0.335]], // champagne
        [[0, 0], [0.036, 0], [0.037, 0.006], [0.037, 0.22], [0.03, 0.245], [0.013, 0.26], [0.013, 0.3], [0.016, 0.3], [0.016, 0.315], [0, 0.315]], // vodka
      ];
      return lathe(prof[variant % 5], variant === 1 ? 4 : 28);
    }
    case 'copa': {
      const prof: [number, number][][] = [
        [[0, 0], [0.04, 0], [0.04, 0.004], [0.005, 0.008], [0.004, 0.09], [0.012, 0.1], [0.04, 0.13], [0.043, 0.17], [0.037, 0.2], [0.035, 0.2], [0.04, 0.17], [0.037, 0.13], [0.01, 0.105], [0, 0.105]],
        [[0, 0], [0.034, 0], [0.034, 0.004], [0.004, 0.008], [0.004, 0.09], [0.012, 0.1], [0.022, 0.17], [0.024, 0.22], [0.022, 0.22], [0.02, 0.17], [0.01, 0.105], [0, 0.105]],
        [[0, 0], [0.042, 0], [0.042, 0.012], [0.044, 0.085], [0.041, 0.085], [0.039, 0.012], [0, 0.012]],
        [[0, 0], [0.032, 0], [0.032, 0.01], [0.035, 0.15], [0.032, 0.15], [0.029, 0.01], [0, 0.01]],
      ];
      return lathe(prof[variant % 4], 28);
    }
    case 'prenda': {
      // remera/buzo en percha, en el plano XY (frente -Z)
      const s = new THREE.Shape();
      s.moveTo(-0.07, 0);
      s.lineTo(-0.2, -0.04);
      s.lineTo(-0.28, -0.2);
      s.lineTo(-0.21, -0.24);
      s.lineTo(-0.17, -0.16);
      s.lineTo(-0.17, -0.66);
      s.quadraticCurveTo(0, -0.69, 0.17, -0.66);
      s.lineTo(0.17, -0.16);
      s.lineTo(0.21, -0.24);
      s.lineTo(0.28, -0.2);
      s.lineTo(0.2, -0.04);
      s.lineTo(0.07, 0);
      s.quadraticCurveTo(0, -0.05, -0.07, 0);
      const body = new THREE.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 6 });
      at(body, 0, -0.04, -0.0175);
      const hook = new THREE.TorusGeometry(0.025, 0.003, 4, 12, Math.PI * 1.3);
      at(hook, 0, 0.015, 0, 0, 0, Math.PI * 0.85);
      const bar = new THREE.CylinderGeometry(0.003, 0.003, 0.36, 4);
      at(bar, 0, -0.07, 0, 0, 0, Math.PI / 2);
      return merge([body, hook, bar]);
    }
    case 'zapatilla': {
      const sole = new RoundedBoxGeometry(0.11, 0.035, 0.29, 3, 0.015);
      at(sole, 0, 0.0175, 0);
      const upper = new RoundedBoxGeometry(0.1, 0.085, 0.27, 4, 0.04);
      const p = upper.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i), y = p.getY(i);
        const toe = Math.max(0, -z / 0.135); // punta hacia -Z
        p.setY(i, y - toe * toe * 0.03 * (y > 0 ? 1 : 0));
        p.setX(i, p.getX(i) * (1 - toe * toe * 0.2));
      }
      upper.computeVertexNormals();
      at(upper, 0, 0.075, 0.005);
      const collar = new THREE.TorusGeometry(0.038, 0.012, 6, 16);
      at(collar, 0, 0.12, 0.07, Math.PI / 2, 0, 0);
      const parts: THREE.BufferGeometry[] = [sole, upper, collar];
      for (let i = 0; i < 4; i++) parts.push(at(new THREE.BoxGeometry(0.07, 0.006, 0.008), 0, 0.118 - i * 0.004, -0.02 - i * 0.025, 0.25, 0, 0));
      return merge(parts);
    }
    case 'gorra': {
      const crown = new THREE.SphereGeometry(0.095, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      at(crown, 0, 0.0, 0);
      const brim = new THREE.CylinderGeometry(0.09, 0.09, 0.008, 24, 1, false, -Math.PI / 2 - 0.9, 1.8);
      brim.scale(1, 1, 1.25);
      at(brim, 0, 0.004, -0.06, -0.12, 0, 0);
      const button = new THREE.SphereGeometry(0.01, 8, 6);
      at(button, 0, 0.095, 0);
      return merge([crown, brim, button]);
    }
    case 'figura':
      return figureGeometry(variant);
  }
}

function figureGeometry(series: number): THREE.BufferGeometry {
  const base = new THREE.CylinderGeometry(0.04, 0.045, 0.012, 20);
  at(base, 0, 0.006, 0);
  const parts: THREE.BufferGeometry[] = [base];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, r = 0.008) => parts.push(at(new RoundedBoxGeometry(w, h, d, 2, r), x, y, z));
  const sph = (r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => { const g = new THREE.SphereGeometry(r, 16, 12); g.scale(sx, sy, sz); parts.push(at(g, x, y, z)); };
  const cyl = (r: number, h: number, x: number, y: number, z: number, rz = 0) => parts.push(at(new THREE.CylinderGeometry(r, r, h, 10), x, y, z, 0, 0, rz));
  switch (series) {
    case 0: // robot
      box(0.05, 0.05, 0.035, 0, 0.04, 0); box(0.055, 0.045, 0.04, 0, 0.088, 0); box(0.04, 0.035, 0.035, 0, 0.13, 0); cyl(0.003, 0.025, 0, 0.16, 0);
      sph(0.006, 0, 0.175, 0); box(0.014, 0.04, 0.014, -0.037, 0.09, 0); box(0.014, 0.04, 0.014, 0.037, 0.09, 0); break;
    case 1: // dino
      sph(0.032, 0, 0.055, 0.005, 1, 0.9, 1.4); sph(0.022, 0, 0.1, -0.035); cyl(0.012, 0.04, 0, 0.075, -0.02, 0.4);
      cyl(0.008, 0.05, 0, 0.04, 0.055, 1.2); box(0.012, 0.03, 0.012, -0.018, 0.02, 0.01); box(0.012, 0.03, 0.012, 0.018, 0.02, 0.01);
      for (let i = 0; i < 4; i++) parts.push(at(new THREE.ConeGeometry(0.008, 0.016, 4), 0, 0.09 - i * 0.006, -0.01 + i * 0.018)); break;
    case 2: // astronauta
      box(0.045, 0.06, 0.035, 0, 0.055, 0, 0.012); sph(0.026, 0, 0.11, 0); box(0.03, 0.04, 0.02, 0, 0.06, 0.025, 0.008);
      box(0.013, 0.045, 0.013, -0.032, 0.065, 0); box(0.013, 0.045, 0.013, 0.032, 0.065, 0); box(0.016, 0.03, 0.016, -0.012, 0.015, 0); box(0.016, 0.03, 0.016, 0.012, 0.015, 0); break;
    case 3: // ninja
      box(0.04, 0.055, 0.03, 0, 0.05, 0, 0.01); sph(0.022, 0, 0.1, 0); box(0.046, 0.008, 0.035, 0, 0.105, 0);
      cyl(0.003, 0.08, 0.02, 0.07, 0.018, 0.6); box(0.012, 0.04, 0.012, -0.028, 0.06, 0); box(0.012, 0.04, 0.012, 0.028, 0.06, 0); break;
    case 4: // monstruo
      sph(0.045, 0, 0.058, 0, 1, 1.1, 0.9); sph(0.012, -0.015, 0.09, -0.035); sph(0.012, 0.015, 0.09, -0.035);
      parts.push(at(new THREE.ConeGeometry(0.01, 0.03, 8), -0.025, 0.115, 0, 0, 0, 0.4), at(new THREE.ConeGeometry(0.01, 0.03, 8), 0.025, 0.115, 0, 0, 0, -0.4)); break;
    case 5: // héroe con capa
      box(0.042, 0.06, 0.03, 0, 0.06, 0, 0.01); sph(0.021, 0, 0.115, 0); box(0.05, 0.07, 0.006, 0, 0.065, 0.02, 0.003);
      box(0.012, 0.045, 0.012, -0.03, 0.08, 0); box(0.012, 0.045, 0.012, 0.03, 0.09, -0.005); box(0.014, 0.03, 0.014, -0.01, 0.015, 0); box(0.014, 0.03, 0.014, 0.01, 0.015, 0); break;
    default: // gato
      sph(0.034, 0, 0.045, 0, 1, 0.9, 1.1); sph(0.026, 0, 0.09, -0.012);
      parts.push(at(new THREE.ConeGeometry(0.009, 0.02, 4), -0.014, 0.115, -0.012), at(new THREE.ConeGeometry(0.009, 0.02, 4), 0.014, 0.115, -0.012));
      cyl(0.005, 0.06, 0, 0.06, 0.04, -0.8); break;
  }
  const g = merge(parts);
  g.scale(1.25, 1.25, 1.25);
  return g;
}

/** Radio aproximado para seleccionar con la mira. */
export const PICK_RADIUS: Record<ItemKind, number> = {
  libro: 0.17, almohadon: 0.3, jarron: 0.18, escultura: 0.17, vela: 0.14, botella: 0.2, copa: 0.14, prenda: 0.35, zapatilla: 0.19, gorra: 0.15, figura: 0.14,
};
