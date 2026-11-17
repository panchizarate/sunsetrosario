import * as THREE from 'three';
import { BL, BH, LAYERS, T, WallDef, buildWalls, isOpening, wallBrickCount, CRUMBLE_AT } from './config';

// =====================================================================================
// Paredes de ladrillos "por píxel": cada pared es UNA caja; el fragment shader recorre
// la grilla de ladrillos (DDA) contra una textura de estado (cuántas capas se rompieron
// desde el frente y desde el fondo de cada celda). Así hay 1.000.000 de ladrillos reales,
// rompibles uno por uno, con el costo de dibujar ~30 cajas.
// =====================================================================================

const LT = T / LAYERS;

const GLSL_COMMON = /* glsl */ `
uniform sampler2D uMask;
uniform vec3 uSize;     // W, H, T
uniform float uSeed;
varying vec3 vLocal;
varying vec3 vCamLocal;
const float BLc = ${BL.toFixed(4)};
const float BHc = ${BH.toFixed(4)};
const int LAY = ${LAYERS};
const float LTc = ${LT.toFixed(4)};
float hsh(vec3 p){ p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.x + p.y) * p.z); }
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
float fbm2(vec2 p){ return n2(p) * 0.5 + n2(p * 2.03) * 0.27 + n2(p * 4.1) * 0.15 + n2(p * 8.3) * 0.08; }
ivec2 cellState(int c, int r){ return ivec2(texelFetch(uMask, ivec2(c, r), 0).rg * 255.0 + 0.5); }
`;

/** Recorre la grilla: devuelve true si pega en un ladrillo; hitP / hitN / cell en espacio local. */
const GLSL_MARCH = /* glsl */ `
bool marchBricks(vec3 ro, vec3 rd, out vec3 hitP, out vec3 hitN, out ivec3 cell){
  vec3 lo = vec3(0.0, 0.0, -uSize.z * 0.5), hi = vec3(uSize.x, uSize.y, uSize.z * 0.5);
  // normal de la cara de entrada
  vec3 dlo = abs(ro - lo), dhi = abs(ro - hi);
  float m = min(min(min(dlo.x, dlo.y), dlo.z), min(min(dhi.x, dhi.y), dhi.z));
  vec3 n = m == dhi.z ? vec3(0, 0, 1) : m == dlo.z ? vec3(0, 0, -1) : m == dhi.y ? vec3(0, 1, 0) : m == dlo.y ? vec3(0, -1, 0) : m == dhi.x ? vec3(1, 0, 0) : vec3(-1, 0, 0);
  vec3 p = ro + rd * 1e-4;
  vec3 eps = vec3(1e-3);
  for (int i = 0; i < 72; i++) {
    if (any(lessThan(p, lo - eps)) || any(greaterThan(p, hi + eps))) return false;
    int r = int(floor(clamp(p.y, 0.0, uSize.y - 1e-4) / BHc));
    float off = (r & 1) == 1 ? BLc * 0.5 : 0.0;
    int c = int(floor((clamp(p.x, 0.0, uSize.x - 1e-4) + off) / BLc));
    int k = int(floor((uSize.z * 0.5 - clamp(p.z, lo.z, hi.z - 1e-4)) / LTc));
    k = clamp(k, 0, LAY - 1);
    ivec2 s = cellState(c, r);
    if (k >= s.x && k < LAY - s.y) { hitP = p; hitN = n; cell = ivec3(c, r, k); return true; }
    float x0 = float(c) * BLc - off, x1 = x0 + BLc;
    float y0 = float(r) * BHc, y1 = y0 + BHc;
    float z1 = uSize.z * 0.5 - float(k) * LTc, z0 = z1 - LTc;
    float tx = rd.x > 0.0 ? (x1 - p.x) / rd.x : rd.x < 0.0 ? (x0 - p.x) / rd.x : 1e9;
    float ty = rd.y > 0.0 ? (y1 - p.y) / rd.y : rd.y < 0.0 ? (y0 - p.y) / rd.y : 1e9;
    float tz = rd.z > 0.0 ? (z1 - p.z) / rd.z : rd.z < 0.0 ? (z0 - p.z) / rd.z : 1e9;
    float tm = min(tx, min(ty, tz));
    n = tm == tx ? vec3(-sign(rd.x), 0, 0) : tm == ty ? vec3(0, -sign(rd.y), 0) : vec3(0, 0, -sign(rd.z));
    p += rd * (max(tm, 0.0) + 2e-4);
  }
  return false;
}
`;

function brickMaterial(): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, (mat as any).userData.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;\nvarying vec3 vCamLocal;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vLocal = position;
        vCamLocal = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform mat4 modelMatrix;\nuniform mat4 projectionMatrix;\n' + GLSL_COMMON + GLSL_MARCH + `
        vec3 gBrickN; float gBrickRough; float gAO;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // tamaño del píxel en metros: a distancia el mortero y el bisel se funden (sin rayas)
          float fw = length(fwidth(vLocal));
          float detail = 1.0 - smoothstep(0.006, 0.03, fw);
          vec3 rd = normalize(vLocal - vCamLocal);
          vec3 hp, hn; ivec3 cell;
          if (!marchBricks(vLocal, rd, hp, hn, cell)) discard;
          // profundidad real del punto alcanzado (agujeros con volumen)
          vec4 clip = projectionMatrix * viewMatrix * modelMatrix * vec4(hp, 1.0);
          gl_FragDepth = clamp((clip.z / clip.w) * 0.5 + 0.5, 0.0, 1.0);

          int r = cell.y, c = cell.x, k = cell.z;
          float off = (r & 1) == 1 ? BLc * 0.5 : 0.0;
          float x0 = float(c) * BLc - off, y0 = float(r) * BHc;
          float zf = uSize.z * 0.5 - float(k) * LTc;
          vec2 uv, sz;
          if (abs(hn.z) > 0.5) { uv = vec2(hp.x - x0, hp.y - y0); sz = vec2(BLc, BHc); }
          else if (abs(hn.x) > 0.5) { uv = vec2(zf - hp.z, hp.y - y0); sz = vec2(LTc, BHc); }
          else { uv = vec2(hp.x - x0, zf - hp.z); sz = vec2(BLc, LTc); }
          vec2 d2 = min(uv, sz - uv);
          float mw = 0.0055;
          bool front = abs(hn.z) > 0.5 && k == 0 || abs(hn.z) > 0.5 && k == LAY - 1;
          float edge = min(d2.x, d2.y);
          float hb = hsh(vec3(float(c) + uSeed * 13.1, float(r), float(k) * 7.0));
          float hb2 = hsh(vec3(float(r) * 1.7, float(c) + 3.3, uSeed));
          // color del ladrillo (sRGB -> lineal)
          vec3 base = mix(vec3(0.56, 0.24, 0.15), vec3(0.70, 0.33, 0.20), hb);
          if (hb2 < 0.05) base *= 0.68;                       // quemados
          else if (hb2 > 0.975) base = vec3(0.7, 0.48, 0.32);  // claros
          vec3 wp = (modelMatrix * vec4(hp, 1.0)).xyz;
          float grain = n2(hp.xy * 55.0 + hp.z * 40.0) * 0.18 + n2(hp.xy * 160.0) * 0.08;
          base *= 0.86 + grain;
          bool exposed = !(abs(hn.z) > 0.5 && (k == 0 && hn.z > 0.0 || k == LAY - 1 && hn.z < 0.0));
          // intemperie: hollín, humedad abajo, verdín
          if (!exposed) {
            float soot = fbm2(vec2(hp.x * 0.35 + uSeed, hp.y * 0.12));
            base *= mix(1.0, 0.68, smoothstep(0.45, 0.85, soot));
            float damp = 1.0 - smoothstep(0.0, 1.6, wp.y);
            base = mix(base, base * vec3(0.55, 0.62, 0.45), damp * 0.6);
            base *= 0.9 + 0.1 * smoothstep(0.0, 0.4, fract(hp.y * 0.07 + n2(hp.xz * 0.5)));
          } else {
            base *= vec3(1.06, 1.02, 1.0); // interior más limpio
          }
          vec3 col = pow(base, vec3(2.2));
          vec3 nn = hn;
          gBrickRough = 0.9;
          gAO = 1.0;
          vec3 mortarCol = pow(vec3(0.62, 0.6, 0.56), vec3(2.2));
          if (abs(hn.z) > 0.5 && edge < mw && detail > 0.5) {
            // junta de mortero
            float mn = n2(hp.xy * 90.0);
            col = pow(vec3(0.72, 0.69, 0.63) * (0.85 + 0.25 * mn), vec3(2.2)) * (exposed ? 1.0 : 0.88);
            gBrickRough = 1.0;
            gAO = 0.86;
          } else {
            // bisel suave en los cantos del ladrillo
            float bev = 0.012;
            vec2 tilt = vec2(0.0);
            if (d2.x < mw + bev) tilt.x = (uv.x < sz.x * 0.5 ? -1.0 : 1.0) * (1.0 - (d2.x - mw) / bev);
            if (d2.y < mw + bev) tilt.y = (uv.y < sz.y * 0.5 ? -1.0 : 1.0) * (1.0 - (d2.y - mw) / bev);
            tilt = clamp(tilt, -1.0, 1.0) * 0.55 * detail;
            // micro relieve
            tilt += (vec2(n2(hp.xy * 70.0 + 1.3), n2(hp.yx * 70.0 + 7.1)) - 0.5) * 0.25;
            if (abs(hn.z) > 0.5) nn = normalize(hn + vec3(tilt.x, tilt.y, 0.0));
            else if (abs(hn.x) > 0.5) nn = normalize(hn + vec3(0.0, tilt.y, -tilt.x * sign(hn.x)));
            else nn = normalize(hn + vec3(tilt.x, 0.0, tilt.y));
          }
          // a distancia: promedio de ladrillo + junta
          if (detail < 1.0 && abs(hn.z) > 0.5) col = mix(mix(col, mortarCol, 0.16), col, detail);
          // oclusión: caras dentro de un agujero
          if (exposed) gAO *= abs(hn.z) > 0.5 ? 0.72 : 0.6;
          diffuseColor.rgb = col * gAO;
          gBrickN = normalize((viewMatrix * modelMatrix * vec4(nn, 0.0)).xyz);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = gBrickRough;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = gBrickN;')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\n reflectedLight.indirectDiffuse *= gAO;');
  };
  return mat;
}

/** Material de sombras: deja pasar la luz por ventanas y agujeros pasantes. */
function shadowMaterial(): THREE.MeshDepthMaterial {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, (mat as any).userData.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;\nvarying vec3 vCamLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vLocal = position; vCamLocal = vec3(0.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          int r = int(floor(clamp(vLocal.y, 0.0, uSize.y - 1e-4) / BHc));
          float off = (r & 1) == 1 ? BLc * 0.5 : 0.0;
          int c = int(floor((clamp(vLocal.x, 0.0, uSize.x - 1e-4) + off) / BLc));
          ivec2 s = cellState(c, r);
          if (s.x + s.y >= LAY) discard;
        }`);
  };
  return mat;
}

export interface Wall {
  def: WallDef;
  mesh: THREE.Mesh;
  mask: Uint8Array; // 2 bytes por celda: capas rotas desde el frente / desde el fondo
  tex: THREE.DataTexture;
  w: number; // ancho de la textura (cols + 1)
  total: number;
  remaining: number;
  rowSolid: Int32Array; // celdas con algún ladrillo por hilada
  rowCells: Int32Array;
  inv: THREE.Matrix4;
  dirty: boolean;
  box: THREE.Box3;
}

export interface Hit {
  wall: Wall;
  c: number;
  r: number;
  k: number;
  point: THREE.Vector3; // mundo
  normal: THREE.Vector3; // mundo
  dist: number;
}

export interface Removal {
  count: number;
  points: THREE.Vector3[]; // muestras (mundo) para escombros
  normal: THREE.Vector3;
}

export interface Collapse {
  wall: Wall;
  count: number;
  fromRow: number;
}

const tmpV = new THREE.Vector3();
const tmpO = new THREE.Vector3();
const tmpD = new THREE.Vector3();

export class BrickSystem {
  walls: Wall[] = [];
  group = new THREE.Group();
  buildings = new Map<string, { walls: Wall[]; total: number; remaining: number; done: boolean }>();
  remaining = 0;
  onCollapse: (c: Collapse) => void = () => {};

  constructor(scene: THREE.Scene, castShadows: boolean) {
    const defs = buildWalls();
    for (const def of defs) {
      const W = def.cols * BL, H = def.rows * BH;
      const geo = new THREE.BoxGeometry(W, H, T);
      geo.translate(W / 2, H / 2, 0);
      const w = def.cols + 1;
      const mask = new Uint8Array(w * def.rows * 2);
      const rowSolid = new Int32Array(def.rows), rowCells = new Int32Array(def.rows);
      for (let r = 0; r < def.rows; r++) {
        const cells = def.cols + (r & 1);
        rowCells[r] = cells;
        for (let c = 0; c < w; c++) {
          const i = (r * w + c) * 2;
          if (c >= cells || isOpening(def, c, r)) mask[i] = LAYERS;
          else rowSolid[r]++;
        }
        // en hiladas pares la última celda (c = cols) no existe
      }
      // daño inicial determinístico (ladrillos ya caídos del muro viejo)
      let dmg = def.damage ?? 0;
      let seed = 1234 + def.id;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      while (dmg > 0) {
        const r = Math.floor(rnd() * def.rows), c = Math.floor(rnd() * (def.cols - 1));
        const i = (r * w + c) * 2;
        if (mask[i] === 0) { mask[i] = 1; dmg--; }
      }
      const tex = new THREE.DataTexture(mask, w, def.rows, THREE.RGFormat, THREE.UnsignedByteType);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.needsUpdate = true;
      const uniforms = {
        uMask: { value: tex },
        uSize: { value: new THREE.Vector3(W, H, T) },
        uSeed: { value: (def.id * 0.731) % 1 },
      };
      const mat = brickMaterial();
      mat.userData.uniforms = uniforms;
      const dmat = shadowMaterial();
      dmat.userData.uniforms = uniforms;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.customDepthMaterial = dmat;
      mesh.position.set(def.ox, 0, def.oz);
      mesh.rotation.y = def.rotY;
      mesh.castShadow = castShadows;
      mesh.receiveShadow = castShadows;
      mesh.updateMatrixWorld(true);
      this.group.add(mesh);
      const total = wallBrickCount(def) - (def.damage ?? 0);
      const wall: Wall = {
        def, mesh, mask, tex, w, total, remaining: total, rowSolid, rowCells,
        inv: mesh.matrixWorld.clone().invert(), dirty: false,
        box: new THREE.Box3().setFromObject(mesh),
      };
      this.walls.push(wall);
      const b = this.buildings.get(def.building) ?? { walls: [], total: 0, remaining: 0, done: false };
      b.walls.push(wall);
      b.total += total;
      b.remaining += total;
      this.buildings.set(def.building, b);
      this.remaining += total;
    }
    scene.add(this.group);
  }

  // ------------------------------------------------------------------ estado de celdas
  private st(w: Wall, c: number, r: number): [number, number] {
    const i = (r * w.w + c) * 2;
    return [w.mask[i], w.mask[i + 1]];
  }

  /** Rompe `layers` capas de una celda desde el lado indicado. Devuelve cuántos ladrillos se rompieron. */
  private breakCell(w: Wall, c: number, r: number, layers: number, fromFront: boolean): number {
    if (c < 0 || r < 0 || r >= w.def.rows || c >= w.w) return 0;
    const i = (r * w.w + c) * 2;
    const f = w.mask[i], b = w.mask[i + 1];
    const left = LAYERS - f - b;
    if (left <= 0) return 0;
    const n = Math.min(left, layers);
    if (fromFront) w.mask[i] = f + n;
    else w.mask[i + 1] = b + n;
    if (n === left) w.rowSolid[r]--;
    w.remaining -= n;
    w.dirty = true;
    this.remaining -= n;
    const bd = this.buildings.get(w.def.building)!;
    bd.remaining -= n;
    return n;
  }

  /** Centro (local) de una celda. */
  private cellLocal(w: Wall, c: number, r: number, k: number, out: THREE.Vector3) {
    const off = r & 1 ? BL / 2 : 0;
    return out.set(Math.min(w.def.cols * BL, Math.max(0, c * BL - off + BL / 2)), r * BH + BH / 2, T / 2 - (k + 0.5) * LT);
  }

  // ------------------------------------------------------------------ raycast (misma lógica que el shader)
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): Hit | null {
    let best: Hit | null = null;
    const ray = new THREE.Ray(origin, dir);
    for (const w of this.walls) {
      if (w.remaining <= 0) continue;
      const hitBox = ray.intersectBox(w.box, tmpV);
      if (!hitBox && !w.box.containsPoint(origin)) continue;
      if (hitBox && hitBox.distanceTo(origin) > maxDist) continue;
      const h = this.marchWall(w, origin, dir, maxDist);
      if (h && (!best || h.dist < best.dist)) best = h;
    }
    return best;
  }

  private marchWall(w: Wall, origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): Hit | null {
    const o = tmpO.copy(origin).applyMatrix4(w.inv);
    const d = tmpD.copy(dir).transformDirection(w.inv);
    const W = w.def.cols * BL, H = w.def.rows * BH;
    const lo = [0, 0, -T / 2], hi = [W, H, T / 2];
    // intersección con la caja
    let t0 = 0, t1 = maxDist;
    const oa = [o.x, o.y, o.z], da = [d.x, d.y, d.z];
    let nAxis = -1, nSign = 0;
    for (let a = 0; a < 3; a++) {
      if (Math.abs(da[a]) < 1e-9) {
        if (oa[a] < lo[a] || oa[a] > hi[a]) return null;
        continue;
      }
      let ta = (lo[a] - oa[a]) / da[a], tb = (hi[a] - oa[a]) / da[a];
      let s = -1;
      if (ta > tb) { [ta, tb] = [tb, ta]; s = 1; }
      if (ta > t0) { t0 = ta; nAxis = a; nSign = s * (da[a] > 0 ? 1 : -1) * (s === 1 ? -1 : 1); nSign = da[a] > 0 ? -1 : 1; }
      if (tb < t1) t1 = tb;
      if (t0 > t1) return null;
    }
    const p = [oa[0] + da[0] * (t0 + 1e-4), oa[1] + da[1] * (t0 + 1e-4), oa[2] + da[2] * (t0 + 1e-4)];
    let n = [0, 0, 0];
    if (nAxis >= 0) n[nAxis] = nSign;
    let t = t0;
    for (let i = 0; i < 200; i++) {
      if (p[0] < -1e-3 || p[1] < -1e-3 || p[2] < -T / 2 - 1e-3 || p[0] > W + 1e-3 || p[1] > H + 1e-3 || p[2] > T / 2 + 1e-3) return null;
      if (t > maxDist) return null;
      const r = Math.min(w.def.rows - 1, Math.max(0, Math.floor(p[1] / BH)));
      const off = r & 1 ? BL / 2 : 0;
      const c = Math.min(w.w - 1, Math.max(0, Math.floor((Math.min(W - 1e-4, Math.max(0, p[0])) + off) / BL)));
      const k = Math.min(LAYERS - 1, Math.max(0, Math.floor((T / 2 - p[2]) / LT)));
      const [f, b] = this.st(w, c, r);
      if (k >= f && k < LAYERS - b) {
        const point = new THREE.Vector3(p[0], p[1], p[2]).applyMatrix4(w.mesh.matrixWorld);
        const normal = new THREE.Vector3(n[0], n[1], n[2]).transformDirection(w.mesh.matrixWorld);
        return { wall: w, c, r, k, point, normal, dist: point.distanceTo(origin) };
      }
      const x0 = c * BL - off, x1 = x0 + BL, y0 = r * BH, y1 = y0 + BH;
      const z1 = T / 2 - k * LT, z0 = z1 - LT;
      const tx = da[0] > 0 ? (x1 - p[0]) / da[0] : da[0] < 0 ? (x0 - p[0]) / da[0] : 1e9;
      const ty = da[1] > 0 ? (y1 - p[1]) / da[1] : da[1] < 0 ? (y0 - p[1]) / da[1] : 1e9;
      const tz = da[2] > 0 ? (z1 - p[2]) / da[2] : da[2] < 0 ? (z0 - p[2]) / da[2] : 1e9;
      const tm = Math.max(0, Math.min(tx, ty, tz));
      n = tm === tx ? [-Math.sign(da[0]), 0, 0] : tm === ty ? [0, -Math.sign(da[1]), 0] : [0, 0, -Math.sign(da[2])];
      p[0] += da[0] * (tm + 2e-4);
      p[1] += da[1] * (tm + 2e-4);
      p[2] += da[2] * (tm + 2e-4);
      t += tm + 2e-4;
    }
    return null;
  }

  // ------------------------------------------------------------------ romper
  /** Golpe puntual: rompe el ladrillo alcanzado (y `layers` capas de esa celda). */
  breakHit(h: Hit, layers: number): Removal {
    const w = h.wall;
    const [f] = this.st(w, h.c, h.r);
    const n = this.breakCell(w, h.c, h.r, layers, h.k === f);
    const pts: THREE.Vector3[] = [];
    if (n > 0) pts.push(h.point.clone().addScaledVector(h.normal, 0.08));
    this.afterChange(w);
    return { count: n, points: pts, normal: h.normal.clone() };
  }

  /**
   * Rompe todo lo que haya dentro de una esfera (maza, martillo neumático, bola, explosivos).
   * `through` = atraviesa la pared entera; si no, saca `layers` capas del lado del impacto.
   */
  breakSphere(center: THREE.Vector3, radius: number, layers: number, through: boolean, maxSamples = 30): Removal {
    const out: Removal = { count: 0, points: [], normal: new THREE.Vector3() };
    const changed = new Set<Wall>();
    for (const w of this.walls) {
      if (w.remaining <= 0) continue;
      if (w.box.distanceToPoint(center) > radius) continue;
      const lc = tmpV.copy(center).applyMatrix4(w.inv);
      const zDist = Math.max(0, Math.abs(lc.z) - T / 2);
      if (zDist > radius) continue;
      const rr = Math.sqrt(radius * radius - zDist * zDist);
      const fromFront = lc.z >= 0;
      const r0 = Math.max(0, Math.floor((lc.y - rr) / BH)), r1 = Math.min(w.def.rows - 1, Math.floor((lc.y + rr) / BH));
      const nrm = new THREE.Vector3(0, 0, fromFront ? 1 : -1).transformDirection(w.mesh.matrixWorld);
      for (let r = r0; r <= r1; r++) {
        const off = r & 1 ? BL / 2 : 0;
        const c0 = Math.max(0, Math.floor((lc.x - rr + off) / BL)), c1 = Math.min(w.w - 1, Math.floor((lc.x + rr + off) / BL));
        const cy = r * BH + BH / 2;
        for (let c = c0; c <= c1; c++) {
          const cx = c * BL - off + BL / 2;
          const dx = cx - lc.x, dy = cy - lc.y;
          if (dx * dx + dy * dy > rr * rr) continue;
          const n = this.breakCell(w, c, r, through ? LAYERS : layers, fromFront);
          if (n > 0) {
            out.count += n;
            changed.add(w);
            if (out.points.length < maxSamples || Math.random() < maxSamples / (out.count + 1)) {
              const p = this.cellLocal(w, c, r, 0, new THREE.Vector3()).applyMatrix4(w.mesh.matrixWorld).addScaledVector(nrm, 0.15);
              if (out.points.length < maxSamples) out.points.push(p);
              else out.points[Math.floor(Math.random() * maxSamples)] = p;
            }
          }
        }
      }
      out.normal.add(nrm);
    }
    if (out.normal.lengthSq() > 0) out.normal.normalize();
    for (const w of changed) this.afterChange(w);
    return out;
  }

  /** Romper la celda más baja disponible cerca de un punto (robots). */
  breakNear(w: Wall, lx: number, ly: number, fromFront: boolean): Removal | null {
    const r = Math.min(w.def.rows - 1, Math.max(0, Math.floor(ly / BH)));
    const off = r & 1 ? BL / 2 : 0;
    const c = Math.min(w.w - 1, Math.max(0, Math.floor((lx + off) / BL)));
    const n = this.breakCell(w, c, r, 1, fromFront);
    if (!n) return null;
    const nrm = new THREE.Vector3(0, 0, fromFront ? 1 : -1).transformDirection(w.mesh.matrixWorld);
    const p = this.cellLocal(w, c, r, 0, new THREE.Vector3()).applyMatrix4(w.mesh.matrixWorld).addScaledVector(nrm, 0.15);
    this.afterChange(w);
    return { count: n, points: [p], normal: nrm };
  }

  // ------------------------------------------------------------------ derrumbes
  /** Si una hilada quedó casi toda cortada, todo lo que está arriba se viene abajo. */
  private afterChange(w: Wall) {
    for (let r = 0; r < w.def.rows - 1; r++) {
      if (w.rowSolid[r] <= w.rowCells[r] * 0.1) {
        let above = 0;
        for (let rr = r + 1; rr < w.def.rows; rr++) above += w.rowSolid[rr];
        if (above > 0) {
          this.collapseAbove(w, r);
          break;
        }
      }
    }
    const b = this.buildings.get(w.def.building)!;
    if (!b.done && b.remaining <= b.total * CRUMBLE_AT) {
      b.done = true;
      for (const bw of b.walls) if (bw.remaining > 0) this.collapseAbove(bw, -1);
    }
  }

  private collapseAbove(w: Wall, row: number) {
    let count = 0;
    for (let r = row + 1; r < w.def.rows; r++) {
      for (let c = 0; c < w.w; c++) count += this.breakCell(w, c, r, LAYERS, true);
    }
    if (count > 0) this.onCollapse({ wall: w, count, fromRow: row + 1 });
  }

  /** Punto (mundo) sobre la cara de una pared, en coordenadas locales x,y. */
  wallPoint(w: Wall, lx: number, ly: number, front = true, out = new THREE.Vector3()) {
    return out.set(lx, ly, front ? T / 2 : -T / 2).applyMatrix4(w.mesh.matrixWorld);
  }

  /** ¿Hay ladrillos (sólidos) en esta posición? Para colisiones del jugador y NPCs. */
  solidAt(w: Wall, lx: number, ly: number): boolean {
    if (ly < 0 || ly >= w.def.rows * BH || lx < 0 || lx > w.def.cols * BL) return false;
    const r = Math.floor(ly / BH);
    const off = r & 1 ? BL / 2 : 0;
    const c = Math.min(w.w - 1, Math.floor((lx + off) / BL));
    const [f, b] = this.st(w, c, r);
    return f + b < LAYERS;
  }

  flush() {
    for (const w of this.walls) {
      if (w.dirty) {
        w.tex.needsUpdate = true;
        w.dirty = false;
      }
    }
  }

  // ------------------------------------------------------------------ guardado (RLE)
  serialize(): string[] {
    return this.walls.map((w) => {
      const out: number[] = [];
      let prev = -1, run = 0;
      for (let i = 0; i < w.mask.length; i++) {
        const v = w.mask[i];
        if (v === prev && run < 65535) run++;
        else {
          if (prev >= 0) out.push(prev, run);
          prev = v;
          run = 1;
        }
      }
      out.push(prev, run);
      return out.join(',');
    });
  }

  restore(data: string[]) {
    if (!data || data.length !== this.walls.length) return;
    this.walls.forEach((w, wi) => {
      const parts = data[wi].split(',').map(Number);
      let i = 0;
      for (let p = 0; p + 1 < parts.length; p += 2) for (let k = 0; k < parts[p + 1] && i < w.mask.length; k++) w.mask[i++] = parts[p];
      // recalcular contadores
      const b = this.buildings.get(w.def.building)!;
      const before = w.remaining;
      let rem = 0;
      for (let r = 0; r < w.def.rows; r++) {
        w.rowSolid[r] = 0;
        for (let c = 0; c < w.rowCells[r]; c++) {
          const ii = (r * w.w + c) * 2;
          const left = LAYERS - w.mask[ii] - w.mask[ii + 1];
          if (isOpening(w.def, c, r)) continue;
          rem += Math.max(0, left);
          if (left > 0) w.rowSolid[r]++;
        }
      }
      w.remaining = rem;
      this.remaining -= before - rem;
      b.remaining -= before - rem;
      w.tex.needsUpdate = true;
    });
    for (const b of this.buildings.values()) b.done = b.remaining <= b.total * CRUMBLE_AT;
  }
}
