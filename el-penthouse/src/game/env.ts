import * as THREE from 'three';

/** Mapa de entorno nocturno: habitación oscura con ventanal azulado, tiras cálidas y neones. */
export function nightEnvironment(renderer: THREE.WebGLRenderer) {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 12, 30), new THREE.MeshBasicMaterial({ color: 0x050407, side: THREE.BackSide }));
  room.position.y = 4;
  s.add(room);
  const panel = (w: number, h: number, color: THREE.ColorRepresentation, k: number, x: number, y: number, z: number, ry = 0, rx = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    s.add(m);
  };
  panel(38, 9, '#1a2448', 1.0, 0, 4.5, -14.9);                      // ventanal con la ciudad
  for (let i = 0; i < 4; i++) panel(30, 0.25, '#ffd2a0', 6, 0, 9.9, -10 + i * 6, 0, Math.PI / 2); // tiras del techo
  panel(10, 3, '#ff9d3a', 2.2, 12, 2, 14.9, Math.PI);               // ónix del bar
  panel(3, 0.3, '#b06bff', 5, -8, 1.2, -14.5);                       // neón violeta
  panel(4, 0.3, '#2ee6ff', 4, 14, 6, 10);                            // neón cian
  panel(0.3, 3, '#ff4fa3', 4, -19.9, 5, 4, Math.PI / 2);             // neón rosa
  panel(40, 30, '#120c0a', 1, 0, -1.9, 0, 0, Math.PI / 2);           // piso cálido oscuro
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(s, 0.02).texture;
  pm.dispose();
  return tex;
}
