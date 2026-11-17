import './style.css';
import * as THREE from 'three';
import { nightEnvironment } from './game/env';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { House } from './game/house';
import { City } from './game/city';
import { ItemSystem } from './game/items';
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x1a0f22, 0.0018);
const pm = new THREE.PMREMGenerator(renderer);
scene.environment = nightEnvironment(renderer);
scene.environmentIntensity = 1.0;
void pm;
scene.add(new THREE.HemisphereLight(0x8a7aff, 0x1a1210, 0.25));
const moon = new THREE.DirectionalLight(0x9fb4ff, 1.2);
moon.position.set(-30, 40, -60); moon.castShadow = true; moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, near: 1, far: 200 }); moon.shadow.bias = -0.0005;
scene.add(moon);
const house = new House(scene, true, true);
const city = new City(scene, true);
const items = new ItemSystem(scene, house, true);
const fill = (new URLSearchParams(location.search).get('fill') ?? '').split(',');
for (const it of items.items) {
  if (fill.includes(it.zone)) {
    const sec = house.sections.find((s) => s.kind === it.kind && s.variant === it.variant)!;
    const slot = sec.filled++;
    it.state = 'placed';
    it.mesh.setMatrixAt(it.index, sec.slots[slot]);
  }
}
for (const m of items.meshes) m.instanceMatrix.needsUpdate = true;
const p = new URLSearchParams(location.search);
const lv = +(p.get('lv') ?? 1);
for (const z of ['living', 'bar', 'vestidor', 'juegos', 'terraza', 'secreta']) house.setZoneLevel(z as any, lv);
for (const d of house.doors) if (p.has('open')) d.open = true;
const cam = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.05, 3000);
cam.position.set(+(p.get('x') ?? -17), +(p.get('y') ?? 1.7), +(p.get('z') ?? 4));
cam.lookAt(+(p.get('lx') ?? -8), +(p.get('ly') ?? 2.5), +(p.get('lz') ?? -6));
const size = renderer.getDrawingBufferSize(new THREE.Vector2());
const comp = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 }));
comp.addPass(new RenderPass(scene, cam));
comp.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.6, 0.85));
comp.addPass(new OutputPass());
let t = 0;
function loop() { t += 0.016; house.update(0.5, t); items.update(0.016, t); city.update(0.016, t, cam.position, (x, z) => x > -20 && x < 20 && z > -12 && z < 12); comp.render(); requestAnimationFrame(loop); }
loop();
console.log('sections', house.sections.length, 'slots', house.sections.reduce((a, s) => a + s.slots.length, 0));
