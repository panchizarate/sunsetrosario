import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LOT, DUMPSTER, BUILDINGS, BL } from './config';

export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const GLSL_NOISE = /* glsl */ `
float wh21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float wn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wh21(i), wh21(i + vec2(1, 0)), f.x), mix(wh21(i + vec2(0, 1)), wh21(i + vec2(1, 1)), f.x), f.y); }
float wfbm(vec2 p){ return wn2(p) * 0.5 + wn2(p * 2.03) * 0.27 + wn2(p * 4.1) * 0.15 + wn2(p * 8.3) * 0.08; }
`;

export function merge(parts: THREE.BufferGeometry[]) {
  const clean = parts.map((p) => {
    const g = p.index ? p.toNonIndexed() : p;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    return g;
  });
  const m = mergeGeometries(clean, false)!;
  m.computeVertexNormals();
  return m;
}

export interface Quality {
  level: 0 | 1 | 2;
  high: boolean;
  shadows: boolean;
  shadowSize: number;
  post: boolean;
  pixelRatio: number;
}
export function makeQuality(level: 0 | 1 | 2): Quality {
  return {
    level,
    high: level === 2,
    shadows: level >= 1,
    shadowSize: level === 2 ? 4096 : 2048,
    post: level >= 1,
    pixelRatio: level === 2 ? 2 : level === 1 ? 1.5 : 1,
  };
}

// Sol de atardecer (golden hour)
export const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 16), THREE.MathUtils.degToRad(38));

const sm = (color: string, rough = 0.7, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });

export class World {
  scene = new THREE.Scene();
  sun!: THREE.DirectionalLight;
  private pmrem: THREE.PMREMGenerator;
  private timeU = { value: 0 };
  dumpster = new THREE.Group();
  dumpsterFill!: THREE.Mesh;
  craneTip = new THREE.Vector3();
  colliders: THREE.Box3[] = [];

  constructor(renderer: THREE.WebGLRenderer, private q: Quality) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.fog = new THREE.FogExp2(0xd9b994, 0.0042);
    this.buildSky();
    this.buildLights();
    this.buildGround();
    this.buildSlabs();
    this.buildProps();
    this.buildCrane();
    this.buildSurroundings();
  }

  private buildSky() {
    const sky = new Sky();
    sky.scale.setScalar(1500);
    const u = sky.material.uniforms;
    u.turbidity.value = 4.5;
    u.rayleigh.value = 1.7;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.85;
    u.sunPosition.value.copy(SUN_DIR);
    this.scene.add(sky);
    const envScene = new THREE.Scene();
    const sky2 = new Sky();
    sky2.scale.setScalar(1500);
    Object.assign(sky2.material.uniforms.turbidity, { value: 4.5 });
    sky2.material.uniforms.rayleigh.value = 1.7;
    sky2.material.uniforms.mieCoefficient.value = 0.006;
    sky2.material.uniforms.mieDirectionalG.value = 0.85;
    sky2.material.uniforms.sunPosition.value.copy(SUN_DIR);
    envScene.add(sky2);
    // suelo cálido en el entorno para que el rebote de luz no sea azul
    const g = new THREE.Mesh(new THREE.CircleGeometry(800, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x6b5a45 }));
    g.position.y = -2;
    envScene.add(g);
    this.scene.environment = this.pmrem.fromScene(envScene, 0.02).texture;
    this.scene.environmentIntensity = 0.85;

    // nubes procedurales
    const clouds = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: this.timeU, uSun: { value: SUN_DIR.clone() } },
      vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform vec3 uSun; varying vec3 vW;
        ${GLSL_NOISE}
        void main(){
          vec2 p = vW.xz * 0.004 + vec2(uTime * 0.003, uTime * 0.001);
          float n = wfbm(p) * 0.65 + wfbm(p * 2.7 + 3.1) * 0.35;
          float a = smoothstep(0.5, 0.74, n) * (1.0 - smoothstep(0.5, 1.0, length(vW.xz) / 1300.0));
          vec3 dir = normalize(vW - cameraPosition);
          float sunSide = pow(max(dot(normalize(dir.xz), normalize(uSun.xz)), 0.0), 3.0);
          vec3 lit = mix(vec3(1.0, 0.92, 0.84), vec3(1.0, 0.68, 0.42), sunSide);
          vec3 col = mix(lit, vec3(0.6, 0.6, 0.68), smoothstep(0.55, 0.95, n) * 0.6);
          gl_FragColor = vec4(col * 1.4, a * 0.9);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const cl = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), clouds);
    cl.rotation.x = -Math.PI / 2;
    cl.position.y = 220;
    cl.frustumCulled = false;
    this.scene.add(cl);
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x6a5038, 0.35));
    this.sun = new THREE.DirectionalLight(0xffd0a0, 3.2);
    this.sun.position.copy(SUN_DIR).multiplyScalar(150);
    if (this.q.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(this.q.shadowSize, this.q.shadowSize);
      const c = this.sun.shadow.camera;
      c.left = -70; c.right = 70; c.top = 70; c.bottom = -70; c.near = 1; c.far = 400;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.05;
    }
    this.scene.add(this.sun, this.sun.target);
  }

  followShadow(x: number, z: number) {
    // ajustar al texel para evitar parpadeo de sombras al moverse
    const step = 140 / this.q.shadowSize;
    const sx = Math.round(x / step) * step, sz = Math.round(z / step) * step;
    this.sun.position.set(sx + SUN_DIR.x * 150, SUN_DIR.y * 150, sz + SUN_DIR.z * 150);
    this.sun.target.position.set(sx, 0, sz);
  }

  // ------------------------------------------------------------------ suelo: tierra, grava, pasto, charcos
  private buildGround() {
    const geo = new THREE.PlaneGeometry(1600, 1600, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, envMapIntensity: 0.35 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'varying vec3 vWP;\n' + GLSL_NOISE + `
        uniform float uLx0, uLx1, uLz0, uLz1;
        float gGRough;
` + sh.fragmentShader
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec2 p = vWP.xz;
            float inLot = step(${LOT.x0.toFixed(1)}, p.x) * step(p.x, ${LOT.x1.toFixed(1)}) * step(${LOT.z0.toFixed(1)}, p.y) * step(p.y, ${LOT.z1.toFixed(1)});
            float n1 = wfbm(p * 0.08), n2v = wfbm(p * 0.7), n3 = wn2(p * 6.0);
            vec3 dirt = mix(vec3(0.42, 0.33, 0.24), vec3(0.55, 0.45, 0.34), n1);
            vec3 gravel = mix(vec3(0.42, 0.39, 0.35), vec3(0.58, 0.54, 0.48), n3);
            float gmask = smoothstep(0.45, 0.62, n2v);
            vec3 lot = mix(dirt, gravel, gmask * 0.65);
            lot *= 0.85 + 0.3 * wn2(p * 18.0);
            // huellas de máquinas
            float track = smoothstep(0.08, 0.0, abs(fract(p.x * 0.6 + wn2(p * 0.05) * 3.0) - 0.5) - 0.42) * smoothstep(0.6, 0.3, n1);
            lot *= 1.0 - track * 0.12;
            // pasto afuera del predio
            vec3 grass = mix(vec3(0.24, 0.32, 0.12), vec3(0.38, 0.42, 0.18), wfbm(p * 0.15));
            grass *= 0.85 + 0.25 * wn2(p * 9.0);
            vec3 col = mix(grass, lot, inLot);
            // calle de acceso
            float road = step(abs(p.x - 0.0), 5.0) * step(${LOT.z1.toFixed(1)}, p.y);
            col = mix(col, vec3(0.2, 0.2, 0.21) * (0.9 + 0.2 * wn2(p * 3.0)), road);
            // charcos
            float puddle = smoothstep(0.76, 0.79, wfbm(p * 0.12 + 7.0)) * inLot;
            col = mix(col, col * 0.35, puddle);
            gGRough = mix(0.95, 0.25, puddle);
            diffuseColor.rgb = pow(col, vec3(2.2)) * 1.25;
          }`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = gGRough;');
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = this.q.shadows;
    this.scene.add(mesh);
  }

  /** Pisos de hormigón dentro de cada edificio. */
  private buildSlabs() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vWP;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'varying vec3 vWP;\n' + GLSL_NOISE + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        { float n = wfbm(vWP.xz * 0.3); vec3 c = mix(vec3(0.5, 0.49, 0.46), vec3(0.62, 0.6, 0.56), n) * (0.88 + 0.2 * wn2(vWP.xz * 12.0));
          float joint = step(0.97, fract(vWP.x / 3.0)) + step(0.97, fract(vWP.z / 3.0));
          c *= 1.0 - min(joint, 1.0) * 0.25;
          diffuseColor.rgb = pow(c, vec3(2.2)) * 1.6; }`);
    };
    for (const b of BUILDINGS) {
      const sx = b.sx * BL, sz = b.sz * BL;
      const slab = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.12, sz), mat);
      slab.position.set(b.x, 0.03, b.z);
      slab.receiveShadow = this.q.shadows;
      this.scene.add(slab);
    }
  }

  // ------------------------------------------------------------------ utilería de obra
  private buildProps() {
    // volquete (contenedor de escombros)
    const d = this.dumpster;
    const yellow = sm('#e0a00f', 0.55, 0.35);
    const shape = new THREE.Shape();
    shape.moveTo(-2.4, 0); shape.lineTo(2.4, 0); shape.lineTo(3.2, 1.6); shape.lineTo(-3.2, 1.6); shape.lineTo(-2.4, 0);
    const body = new THREE.ExtrudeGeometry(shape, { depth: 2.2, bevelEnabled: false });
    body.translate(0, 0, -1.1);
    const walls = new THREE.Mesh(body, yellow);
    walls.position.y = 0.15;
    d.add(walls);
    const ribs = new THREE.Group();
    for (let i = -2; i <= 2; i++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.5, 2.32), sm('#c78a0a', 0.5, 0.4));
      rib.position.set(i * 1.2, 0.95, 0);
      ribs.add(rib);
    }
    d.add(ribs);
    const fill = new THREE.Mesh(new THREE.BoxGeometry(5.6, 0.2, 2.0), sm('#8e4a32', 0.95));
    fill.position.y = 0.4;
    fill.scale.y = 0.01;
    d.add(fill);
    this.dumpsterFill = fill;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.6), new THREE.MeshBasicMaterial({ map: this.labelTexture('ESCOMBROS'), transparent: true }));
    label.position.set(0, 1.0, 1.12);
    d.add(label);
    d.position.set(DUMPSTER.x, 0, DUMPSTER.z);
    d.rotation.y = 0.15;
    d.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = this.q.shadows; o.receiveShadow = this.q.shadows; } });
    this.scene.add(d);
    this.colliders.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(DUMPSTER.x, 1, DUMPSTER.z), new THREE.Vector3(6.2, 2, 2.4)));

    // conos y vallas
    const r = rng(9);
    const coneGeo = merge([new THREE.ConeGeometry(0.22, 0.7, 12).translate(0, 0.35, 0), new THREE.BoxGeometry(0.5, 0.05, 0.5).translate(0, 0.025, 0)]);
    const cones = new THREE.InstancedMesh(coneGeo, sm('#ff5a1f', 0.5), 40);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * Math.PI * 2;
      const x = i < 20 ? -30 + i * 1.1 : 30 + Math.cos(a) * 2.5;
      const z = i < 20 ? LOT.z1 - 3 : 34 + Math.sin(a) * 2.5;
      m.makeRotationY(r() * 6).setPosition(x + (r() - 0.5) * 0.3, 0, z);
      cones.setMatrixAt(i, m);
    }
    cones.castShadow = this.q.shadows;
    this.scene.add(cones);

    // contenedor-oficina
    const office = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(6, 2.6, 2.5), sm('#2f6f8f', 0.5, 0.3));
    box.position.y = 1.4;
    office.add(box);
    for (let i = 0; i < 2; i++) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 0.05), sm('#9fd3e6', 0.08, 0.5));
      win.position.set(-1.5 + i * 3, 1.7, 1.26);
      office.add(win);
    }
    office.position.set(-12, 0, 40);
    office.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = this.q.shadows; o.receiveShadow = this.q.shadows; } });
    this.scene.add(office);
    this.colliders.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(-12, 1.4, 40), new THREE.Vector3(6.2, 2.8, 2.7)));

    // postes de luz
    for (const [x, z] of [[-40, 40], [40, 40], [-40, -45], [42, -45]]) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 9, 8), sm('#555b60', 0.5, 0.6));
      pole.position.set(x, 4.5, z);
      pole.castShadow = this.q.shadows;
      this.scene.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 0.4), sm('#333', 0.4, 0.5));
      lamp.position.set(x, 9, z);
      this.scene.add(lamp);
    }
    // pallets de ladrillos nuevos (detalle)
    const palletGeo = merge([new THREE.BoxGeometry(1.2, 0.15, 1.0).translate(0, 0.075, 0), new THREE.BoxGeometry(1.1, 0.8, 0.9).translate(0, 0.55, 0)]);
    const pallets = new THREE.InstancedMesh(palletGeo, sm('#a5523a', 0.9), 6);
    for (let i = 0; i < 6; i++) {
      m.makeRotationY(r() * 0.4).setPosition(-20 + i * 1.5, 0, 40.5);
      pallets.setMatrixAt(i, m);
    }
    pallets.castShadow = this.q.shadows;
    this.scene.add(pallets);
  }

  private labelTexture(text: string) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 120;
    const x = c.getContext('2d')!;
    x.fillStyle = '#1b1b1b';
    x.font = '900 86px Inter, system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(text, 256, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  // ------------------------------------------------------------------ grúa torre (de ahí cuelga la bola de demolición)
  private buildCrane() {
    const g = new THREE.Group();
    const steel = sm('#e8b21a', 0.45, 0.5);
    const lattice = (len: number, w: number) => {
      const parts: THREE.BufferGeometry[] = [];
      for (const [x, z] of [[-w, -w], [w, -w], [-w, w], [w, w]]) parts.push(new THREE.BoxGeometry(0.12, len, 0.12).translate(x, len / 2, z));
      for (let y = 0; y < len; y += 1.6) {
        parts.push(new THREE.BoxGeometry(w * 2, 0.07, 0.07).translate(0, y, -w), new THREE.BoxGeometry(w * 2, 0.07, 0.07).translate(0, y, w));
        parts.push(new THREE.BoxGeometry(0.07, 0.07, w * 2).translate(-w, y, 0), new THREE.BoxGeometry(0.07, 0.07, w * 2).translate(w, y, 0));
      }
      return merge(parts);
    };
    const mast = new THREE.Mesh(lattice(58, 0.9), steel);
    g.add(mast);
    const jibGeo = lattice(52, 0.6);
    jibGeo.rotateZ(-Math.PI / 2);
    const jib = new THREE.Mesh(jibGeo, steel);
    jib.position.set(-4, 58.6, 0);
    g.add(jib);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2, 2.2), sm('#f2f2f2', 0.4));
    cab.position.set(0, 57, 1.5);
    g.add(cab);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(4, 2.2, 2), sm('#888', 0.8));
    counter.position.set(-8, 57.8, 0);
    g.add(counter);
    const base = new THREE.Mesh(new THREE.BoxGeometry(5, 1, 5), sm('#777', 0.9));
    base.position.y = 0.5;
    g.add(base);
    g.position.set(44, 0, 30);
    g.rotation.y = 2.6;
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = this.q.shadows; });
    this.scene.add(g);
    g.updateMatrixWorld(true);
    this.craneTip.set(44, 58, 0).set(0, 58, 0);
    this.craneTip.set(46, 0, 0).applyMatrix4(new THREE.Matrix4().makeRotationY(2.6)).add(new THREE.Vector3(44, 58, 30));
    this.colliders.push(new THREE.Box3().setFromCenterAndSize(new THREE.Vector3(44, 3, 30), new THREE.Vector3(5, 6, 5)));
  }

  // ------------------------------------------------------------------ alrededores: árboles y skyline
  private buildSurroundings() {
    const r = rng(31);
    const n = this.q.high ? 260 : 140;
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 4; i++) {
      const s = 0.6 + r() * 0.5;
      const a = (i / 4) * Math.PI * 2;
      parts.push(new THREE.IcosahedronGeometry(s, 1).translate(Math.cos(a) * 0.5 * (i ? 1 : 0), 1 + r() * 0.5, Math.sin(a) * 0.5 * (i ? 1 : 0)));
    }
    const canopy = merge(parts);
    const trees = new THREE.InstancedMesh(canopy, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), n);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.2, 1.6, 6).translate(0, 0.8, 0), sm('#5a4130', 0.9), n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    let k = 0;
    while (k < n) {
      const x = (r() - 0.5) * 360, z = (r() - 0.5) * 360;
      if (x > LOT.x0 - 6 && x < LOT.x1 + 6 && z > LOT.z0 - 6 && z < LOT.z1 + 14) continue;
      if (Math.abs(x) < 8 && z > LOT.z1) continue;
      const sc = 2 + r() * 2.6;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6);
      m.compose(new THREE.Vector3(x, sc * 0.9, z), q, s.set(sc, sc * (0.9 + r() * 0.3), sc));
      trees.setMatrixAt(k, m);
      trees.setColorAt(k, new THREE.Color().setHSL(0.24 + r() * 0.06, 0.45, 0.22 + r() * 0.1));
      m.compose(new THREE.Vector3(x, 0, z), q, s.set(sc * 0.6, sc * 0.7, sc * 0.6));
      trunks.setMatrixAt(k, m);
      k++;
    }
    trees.castShadow = trunks.castShadow = this.q.shadows;
    this.scene.add(trees, trunks);

    // skyline lejano con ventanas
    const city = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.2 }), 120);
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2 + r() * 0.04;
      const d = 280 + r() * 160;
      const h = 15 + Math.pow(r(), 2) * 90;
      m.compose(new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 2), s.set(14 + r() * 20, h, 14 + r() * 20));
      city.setMatrixAt(i, m);
      city.setColorAt(i, new THREE.Color().setHSL(0.08 + r() * 0.5, 0.08, 0.45 + r() * 0.25));
    }
    this.scene.add(city);
  }

  update(t: number) {
    this.timeU.value = t;
  }
}
