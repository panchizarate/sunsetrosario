// Modelos y texturas escaneados de objetos reales (Poly Haven, CC0), optimizados para web.
import * as THREE from 'three';
import { GLTFLoader, GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const MODEL_IDS = [
  'ceramic_vase_01', 'ceramic_vase_02', 'ceramic_vase_03', 'ceramic_vase_04', 'brass_vase_01', 'brass_vase_03', 'brass_vase_04', 'antique_ceramic_vase_01',
  'marble_bust_01', 'horse_statue_01', 'concrete_cat_statue', 'bronze_whale_statue', 'carved_wooden_elephant', 'bronze_shark_statue',
  'wooden_candlestick', 'brass_candleholders', 'throw_pillows_01', 'wine_bottles_01',
  'potted_plant_02', 'potted_plant_04', 'mid_century_lounge_chair', 'modern_ceiling_lamp_01', 'chess_set', 'standing_picture_frame_01',
] as const;
export const TEX_IDS = ['herringbone_parquet', 'marble_01', 'plastered_wall_04', 'velour_velvet', 'brown_leather', 'wood_floor_deck', 'rectangular_parquet', 'poly_wool_herringbone', 'terrazzo_tiles'] as const;
export type TexId = (typeof TEX_IDS)[number];
export interface TexSet { diff: THREE.Texture; nor: THREE.Texture; arm: THREE.Texture }

const models = new Map<string, GLTF>();
const textures = new Map<string, TexSet>();
const BASE = './assets/';

export async function loadAssets(onProgress: (f: number) => void) {
  const loader = new GLTFLoader();
  const tl = new THREE.TextureLoader();
  const total = MODEL_IDS.length + TEX_IDS.length * 3;
  let done = 0;
  const tick = () => onProgress(++done / total);
  const ld = (url: string, srgb: boolean) => new Promise<THREE.Texture>((res) => tl.load(url, (t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 8;
    tick(); res(t);
  }, undefined, () => { tick(); res(new THREE.Texture()); }));
  await Promise.all([
    ...MODEL_IDS.map((id) => loader.loadAsync(BASE + 'm/' + id + '.glb').then((g) => { models.set(id, g); tick(); }).catch(() => tick())),
    ...TEX_IDS.map(async (id) => {
      const [diff, nor, arm] = await Promise.all([ld(`${BASE}t/${id}_diff.webp`, true), ld(`${BASE}t/${id}_nor.webp`, false), ld(`${BASE}t/${id}_arm.webp`, false)]);
      textures.set(id, { diff, nor, arm });
    }),
  ]);
}

export function tex(id: TexId) { return textures.get(id)!; }
export function hasModel(id: string) { return models.has(id); }

export interface Part { geo: THREE.BufferGeometry; mat: THREE.Material }
/**
 * Partes (geometría + material) de un modelo o de uno de sus nodos, con la transformación aplicada,
 * apoyado en y=0, centrado en xz y escalado para que entre en (alto H, ancho máximo W).
 */
export function modelParts(id: string, node: string | null, H: number, W: number): { parts: Part[]; size: THREE.Vector3 } {
  const g = models.get(id);
  if (!g) return { parts: [], size: new THREE.Vector3() };
  g.scene.updateMatrixWorld(true);
  const root = node ? g.scene.getObjectByName(node) ?? g.scene : g.scene;
  const raw: Part[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geo = m.geometry.clone();
    geo.applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    geo.morphAttributes = {};
    raw.push({ geo, mat: m.material as THREE.Material });
  });
  const box = new THREE.Box3();
  for (const p of raw) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox!); }
  const size = box.getSize(new THREE.Vector3());
  const s = Math.min(H / size.y, W / Math.max(size.x, size.z));
  const c = box.getCenter(new THREE.Vector3());
  const m = new THREE.Matrix4().makeScale(s, s, s).multiply(new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z));
  for (const p of raw) { p.geo.applyMatrix4(m); p.geo.computeBoundingSphere(); }
  return { parts: raw, size: size.multiplyScalar(s) };
}

/** Objeto decorativo (mueble, planta, lámpara) listo para poner en la escena. */
export function prop(id: string, H: number, W = 99, shadows = true): THREE.Group {
  const grp = new THREE.Group();
  for (const p of modelParts(id, null, H, W).parts) {
    const me = new THREE.Mesh(p.geo, p.mat);
    me.castShadow = shadows;
    me.receiveShadow = shadows;
    grp.add(me);
  }
  return grp;
}
