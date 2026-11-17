import * as THREE from 'three';
import { bankDistance, riverCenter, riverHalfWidth, plantDock, PLANT_X, DOCK_RADIUS } from './config';

// RNG determinístico para que el mundo sea siempre igual
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Ruido de valor 2D simple
const perm = new Uint8Array(512);
{
  const r = mulberry32(7);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
}
function vnoise(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const h = (a: number, b: number) => perm[(perm[a & 255] + b) & 511] / 255;
  const s = (t: number) => t * t * (3 - 2 * t);
  const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
  const u = s(xf), v = s(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x: number, y: number) {
  return vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.28 + vnoise(x * 4.3, y * 4.3) * 0.17;
}

export function terrainHeight(x: number, z: number): number {
  const d = bankDistance(x, z);
  if (d < 0) {
    const t = Math.min(1, -d / 14);
    return -0.35 - 3.2 * (t * t * (3 - 2 * t));
  }
  const rise = Math.min(1, d / 16);
  const hills = fbm(x * 0.012, z * 0.012) * 16 * Math.min(1, Math.max(0, (d - 12) / 50));
  return -0.35 + 1.4 * Math.sqrt(rise) + hills + fbm(x * 0.08, z * 0.08) * 0.5 * rise;
}

const GLSL_RIVER = /* glsl */ `
float riverCenter(float x){ return 14.0*sin(x*0.018) + 6.0*sin(x*0.047+1.3); }
float riverHalfWidth(float x){ return 34.0 + 7.0*sin(x*0.031+0.5); }
float bankDist(vec2 p){ return abs(p.y - riverCenter(p.x)) - riverHalfWidth(p.x); }
`;

const lerpColor = (a: THREE.Color, b: THREE.Color, t: number) => a.clone().lerp(b, t);

export interface Quality {
  high: boolean;
}

export class World {
  scene = new THREE.Scene();
  sun!: THREE.DirectionalLight;
  hemi!: THREE.HemisphereLight;
  waterMat!: THREE.ShaderMaterial;
  skyMat!: THREE.ShaderMaterial;
  private terrainGeo!: THREE.BufferGeometry;
  private terrainDirty!: Float32Array;
  private terrainClean!: Float32Array;
  private trees!: { canopy: THREE.InstancedMesh; dirty: THREE.Color[]; clean: THREE.Color[] };
  private reeds!: { mesh: THREE.InstancedMesh; dirty: THREE.Color[]; clean: THREE.Color[] };
  private bloomers: { mesh: THREE.InstancedMesh; mats: THREE.Matrix4[]; thresholds: number[] }[] = [];
  private swayUniforms: { value: number }[] = [];
  private dockRing!: THREE.Mesh;
  private appliedClean = -1;
  fogDirty = new THREE.Color('#c9b48f');
  fogClean = new THREE.Color('#f3cfa4');

  constructor(private q: Quality) {
    this.scene.fog = new THREE.FogExp2(this.fogDirty.getHex(), 0.0075);
    this.buildLights();
    this.buildSky();
    this.buildTerrain();
    this.buildWater();
    this.buildTrees();
    this.buildShore();
    this.buildPlant();
    this.buildBridge();
  }

  // ------------------------------------------------------------- luces
  private buildLights() {
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a4a30, 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffd9a8, 2.6);
    this.sun.position.set(-60, 55, -40);
    if (this.q.high) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(2048, 2048);
      const c = this.sun.shadow.camera;
      c.left = -45; c.right = 45; c.top = 45; c.bottom = -45; c.near = 1; c.far = 200;
      this.sun.shadow.bias = -0.0008;
      this.sun.shadow.normalBias = 0.04;
    }
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  followShadow(x: number, z: number) {
    this.sun.position.set(x - 60, 55, z - 40);
    this.sun.target.position.set(x, 0, z);
  }

  // ------------------------------------------------------------- cielo
  private buildSky() {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uClean: { value: 0 },
        uSunDir: { value: new THREE.Vector3(-0.6, 0.35, -0.4).normalize() },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main(){
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uClean; uniform vec3 uSunDir; uniform float uTime;
        varying vec3 vDir;
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 zenC = vec3(0.20,0.42,0.78), horC = vec3(1.0,0.78,0.55);
          vec3 zenD = vec3(0.52,0.58,0.62), horD = vec3(0.88,0.76,0.58);
          vec3 zen = mix(zenD, zenC, uClean), hor = mix(horD, horC, uClean);
          vec3 col = mix(hor, zen, pow(max(h,0.0), 0.55));
          float s = max(dot(d, uSunDir), 0.0);
          col += vec3(1.0,0.75,0.45) * (pow(s, 6.0)*0.35 + pow(s, 64.0)*0.6) * mix(0.5,1.0,uClean);
          col += vec3(1.0,0.95,0.85) * smoothstep(0.9993, 0.9997, s) * 2.0;
          // nubes suaves
          vec2 uv = d.xz / max(d.y, 0.08) * 0.6 + vec2(uTime*0.004, 0.0);
          float cl = smoothstep(0.55, 0.85, n2(uv*1.3)*0.6 + n2(uv*3.1)*0.4);
          vec3 cloudCol = mix(vec3(0.6,0.56,0.5), vec3(1.0,0.9,0.82), uClean);
          col = mix(col, cloudCol, cl * smoothstep(0.02, 0.25, d.y) * 0.75);
          // smog
          col = mix(col, vec3(0.62,0.56,0.44), (1.0-uClean) * 0.35 * (1.0 - smoothstep(0.0,0.5,h)));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), this.skyMat);
    sky.frustumCulled = false;
    sky.renderOrder = -1;
    this.scene.add(sky);
  }

  // ------------------------------------------------------------- terreno
  private buildTerrain() {
    const W = 760, D = 520;
    const sx = this.q.high ? 230 : 150, sz = this.q.high ? 160 : 100;
    const geo = new THREE.PlaneGeometry(W, D, sx, sz);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    this.terrainDirty = new Float32Array(n * 3);
    this.terrainClean = new Float32Array(n * 3);
    const sandC = new THREE.Color('#e3c48d'), grassC = new THREE.Color('#5fae3c'), grass2 = new THREE.Color('#3e8a35');
    const hillC = new THREE.Color('#7fb04a'), bedC = new THREE.Color('#8a7a52');
    const sandD = new THREE.Color('#b5a078'), grassD = new THREE.Color('#9a9157'), grass2D = new THREE.Color('#7f7a4a');
    const bedD = new THREE.Color('#4a4232');
    const tmp = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = terrainHeight(x, z);
      pos.setY(i, y);
      const d = bankDistance(x, z);
      const nz = fbm(x * 0.05, z * 0.05);
      let c: THREE.Color, cd: THREE.Color;
      if (d < 0.5) { c = bedC; cd = bedD; }
      else if (d < 4.5) { c = sandC; cd = sandD; }
      else {
        const t = Math.min(1, (d - 4.5) / 6);
        c = tmp.copy(sandC).lerp(nz > 0.5 ? grassC : grass2, t).clone();
        cd = sandD.clone().lerp(nz > 0.5 ? grassD : grass2D, t);
        if (y > 7) { c.lerp(hillC, Math.min(1, (y - 7) / 6)); }
      }
      const v = 0.9 + nz * 0.2;
      this.terrainClean.set([c.r * v, c.g * v, c.b * v], i * 3);
      this.terrainDirty.set([cd.r * v, cd.g * v, cd.b * v], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.terrainDirty), 3));
    geo.computeVertexNormals();
    this.terrainGeo = geo;
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  // ------------------------------------------------------------- agua
  private buildWater() {
    const segX = this.q.high ? 200 : 120, segZ = this.q.high ? 120 : 70;
    const geo = new THREE.PlaneGeometry(760, 520, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    this.waterMat = new THREE.ShaderMaterial({
      transparent: true,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uClean: { value: 0 },
          uSunDir: { value: new THREE.Vector3(-0.6, 0.55, -0.4).normalize() },
          uBoat: { value: new THREE.Vector3(0, 0, 0) },
        },
      ]),
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vWorld;
        #include <fog_pars_vertex>
        ${GLSL_RIVER}
        void main(){
          vec3 p = (modelMatrix * vec4(position,1.0)).xyz;
          float w = sin(p.x*0.21 + uTime*1.3)*0.035 + sin(p.z*0.27 - uTime*1.1)*0.03 + sin((p.x+p.z)*0.5 + uTime*2.0)*0.015;
          p.y += w;
          vWorld = p;
          vec4 mvPosition = viewMatrix * vec4(p,1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uClean; uniform vec3 uSunDir; uniform vec3 uBoat;
        varying vec3 vWorld;
        #include <common>
        #include <fog_pars_fragment>
        ${GLSL_RIVER}
        float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
        float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
        float hgt(vec2 p){
          float t = uTime;
          vec2 flow = vec2(t*0.55, 0.0);
          return n2((p - flow)*0.35)*0.6 + n2((p*0.9 - flow*1.3 + vec2(0.0,t*0.2))*0.9)*0.3 + n2((p - flow*1.8)*2.3)*0.12;
        }
        void main(){
          vec2 p = vWorld.xz;
          float d = bankDist(p);
          float depth = smoothstep(0.0, -18.0, d);
          // normal desde el campo de alturas
          float e = 0.15;
          float h0 = hgt(p);
          vec3 N = normalize(vec3((h0 - hgt(p+vec2(e,0.0)))*1.3, 1.0, (h0 - hgt(p+vec2(0.0,e)))*1.3));
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 L = normalize(uSunDir);

          vec3 shallowD = vec3(0.45,0.47,0.28), deepD = vec3(0.22,0.30,0.18);
          vec3 shallowC = vec3(0.20,0.78,0.72), deepC = vec3(0.03,0.33,0.45);
          vec3 shallow = mix(shallowD, shallowC, uClean);
          vec3 deep = mix(deepD, deepC, uClean);
          vec3 col = mix(shallow, deep, depth);

          // reflejo de cielo + fresnel
          float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
          vec3 skyC = mix(vec3(0.66,0.6,0.48), vec3(1.0,0.82,0.62), uClean);
          col = mix(col, skyC, fres * 0.55);

          // brillo especular del sol
          vec3 H = normalize(L + V);
          float spec = pow(max(dot(N, H), 0.0), 380.0);
          col += vec3(1.0,0.86,0.6) * spec * mix(0.4, 1.3, uClean);
          float glint = step(0.985, h21(floor(p*6.0) + floor(uTime*4.0))) * pow(max(dot(N,H),0.0), 40.0);
          col += vec3(1.0) * glint * 0.35 * uClean;

          // película de aceite (iridiscencia) cuando está sucio
          float oil = smoothstep(0.62, 0.85, n2(p*0.05 + vec2(uTime*0.02, 0.0))) * (1.0 - uClean) * (1.0 - smoothstep(0.0, 0.3, uClean));
          vec3 rainbow = 0.5 + 0.5*cos(6.2831*(n2(p*0.4)*1.5 + vec3(0.0,0.33,0.67)));
          col = mix(col, col*0.7 + rainbow*0.35, oil * 0.45);
          // espuma sucia / limpia
          float foamN = n2(p*1.6 + vec2(uTime*0.4, 0.0));
          float shore = smoothstep(-2.6, 0.2, d) * smoothstep(0.35, 0.75, foamN + 0.25*sin(uTime*1.5 + d*3.0));
          vec3 foamC = mix(vec3(0.72,0.68,0.52), vec3(0.97,0.98,1.0), uClean);
          col = mix(col, foamC, shore * 0.85);
          // estela del barco
          float bd = length(p - uBoat.xz);
          float wake = smoothstep(4.0, 0.0, bd) * uBoat.y * smoothstep(0.4, 0.8, foamN);
          col = mix(col, foamC, wake * 0.6);

          float alpha = mix(0.72, 0.96, depth);
          alpha = max(alpha, shore * 0.9);
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geo, this.waterMat);
    mesh.renderOrder = 1;
    this.scene.add(mesh);
  }

  // ------------------------------------------------------------- árboles
  private addSway(mat: THREE.Material, amp: number) {
    const u = { value: 0 };
    this.swayUniforms.push(u);
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = u;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         #ifdef USE_INSTANCING
           vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
         #else
           vec3 ip = vec3(0.0);
         #endif
         float sw = sin(uTime*1.3 + ip.x*0.3 + ip.z*0.2) * ${amp.toFixed(3)} * max(position.y, 0.0);
         transformed.x += sw; transformed.z += sw*0.6;`,
      );
    };
  }

  private buildTrees() {
    const r = mulberry32(42);
    const count = this.q.high ? 900 : 480;
    // copa redondeada + pino
    const roundGeo = new THREE.IcosahedronGeometry(1, 1);
    roundGeo.translate(0, 1, 0);
    const pineGeo = new THREE.ConeGeometry(0.9, 2.6, 7);
    pineGeo.translate(0, 1.3, 0);
    const trunkGeo = new THREE.CylinderGeometry(0.12, 0.2, 1.4, 6);
    trunkGeo.translate(0, 0.7, 0);

    const canopyMat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.addSway(canopyMat, 0.05);
    const roundMesh = new THREE.InstancedMesh(roundGeo, canopyMat, count);
    const pineMesh = new THREE.InstancedMesh(pineGeo, canopyMat, count);
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#6b4a2f' }), count * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let nr = 0, np = 0, nt = 0;
    const dirty: THREE.Color[] = [], clean: THREE.Color[] = [];
    const dirtyP: THREE.Color[] = [], cleanP: THREE.Color[] = [];
    const greens = ['#4f9a3a', '#64b043', '#3d8a3c', '#7cbf4a', '#2f7a43', '#8cc63f'];
    const plant = plantDock();
    let tries = 0;
    while ((nr + np) < count && tries < count * 20) {
      tries++;
      const x = (r() - 0.5) * 700;
      const z = (r() - 0.5) * 480;
      const d = bankDistance(x, z);
      if (d < 7 || d > 200) continue;
      if (Math.hypot(x - plant.x, z - plant.z) < 28) continue;
      if (Math.abs(x - 120) < 10 && d < 30) continue; // puente
      const density = fbm(x * 0.02 + 10, z * 0.02);
      if (r() > density * 1.4 - 0.1) continue;
      const y = terrainHeight(x, z) - 0.2;
      const sc = 1.6 + r() * 2.2;
      const isPine = r() < 0.35;
      p.set(x, y + sc * 0.9, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      const g = new THREE.Color(greens[Math.floor(r() * greens.length)]);
      const dc = new THREE.Color('#6d6845').lerp(new THREE.Color('#8a6a3a'), r() * 0.5);
      if (isPine) {
        s.set(sc * 0.9, sc * 1.2, sc * 0.9);
        m.compose(p, q, s);
        pineMesh.setMatrixAt(np, m);
        dirtyP.push(dc); cleanP.push(g.clone().multiplyScalar(0.85));
        np++;
      } else {
        s.set(sc * (0.9 + r() * 0.3), sc * (0.8 + r() * 0.3), sc * (0.9 + r() * 0.3));
        m.compose(p, q, s);
        roundMesh.setMatrixAt(nr, m);
        dirty.push(dc); clean.push(g);
        nr++;
      }
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sc * 0.7, sc * 0.75, sc * 0.7));
      trunkMesh.setMatrixAt(nt++, m);
    }
    roundMesh.count = nr; pineMesh.count = np; trunkMesh.count = nt;
    for (let i = 0; i < nr; i++) roundMesh.setColorAt(i, dirty[i]);
    for (let i = 0; i < np; i++) pineMesh.setColorAt(i, dirtyP[i]);
    for (const mesh of [roundMesh, pineMesh, trunkMesh]) {
      mesh.castShadow = this.q.high;
      mesh.receiveShadow = false;
      this.scene.add(mesh);
    }
    this.trees = { canopy: roundMesh, dirty, clean };
    (this as any).pines = { canopy: pineMesh, dirty: dirtyP, clean: cleanP };
  }

  // ------------------------------------------------------------- orilla: juncos, rocas, flores, nenúfares
  private buildShore() {
    const r = mulberry32(99);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    // juncos
    const reedGeo = new THREE.ConeGeometry(0.06, 1.6, 4);
    reedGeo.translate(0, 0.8, 0);
    const reedMat = new THREE.MeshLambertMaterial();
    this.addSway(reedMat, 0.12);
    const nReeds = this.q.high ? 2600 : 1300;
    const reeds = new THREE.InstancedMesh(reedGeo, reedMat, nReeds);
    const rd: THREE.Color[] = [], rc: THREE.Color[] = [];
    let i = 0;
    while (i < nReeds) {
      const x = (r() - 0.5) * 680;
      const side = r() < 0.5 ? -1 : 1;
      const off = -2.5 + r() * 5.5;
      const z = riverCenter(x) + side * (riverHalfWidth(x) + off);
      if (fbm(x * 0.04, side * 9) < 0.42) continue;
      const pl = plantDock();
      if (Math.hypot(x - pl.x, z - pl.z) < 18) continue;
      const y = Math.max(terrainHeight(x, z), -0.6);
      for (let k = 0; k < 6 && i < nReeds; k++) {
        p.set(x + (r() - 0.5) * 1.6, y, z + (r() - 0.5) * 1.6);
        q.setFromAxisAngle(new THREE.Vector3(r() - 0.5, 0, r() - 0.5).normalize(), (r() - 0.5) * 0.4);
        const h = 0.7 + r() * 0.9;
        s.set(1, h, 1);
        m.compose(p, q, s);
        reeds.setMatrixAt(i, m);
        rd.push(new THREE.Color('#7d7046').multiplyScalar(0.8 + r() * 0.3));
        rc.push(new THREE.Color(r() < 0.5 ? '#6aa84f' : '#93b956').multiplyScalar(0.8 + r() * 0.3));
        reeds.setColorAt(i, rd[i]);
        i++;
      }
    }
    this.scene.add(reeds);
    this.reeds = { mesh: reeds, dirty: rd, clean: rc };

    // rocas
    const rockGeo = new THREE.DodecahedronGeometry(1, 0);
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ color: '#8a8378', flatShading: true }), 260);
    for (let k = 0; k < 260; k++) {
      const x = (r() - 0.5) * 680;
      const side = r() < 0.5 ? -1 : 1;
      const z = riverCenter(x) + side * (riverHalfWidth(x) + 1 + r() * 6);
      const sc = 0.3 + r() * 1.1;
      p.set(x, terrainHeight(x, z) + sc * 0.2, z);
      q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
      s.set(sc * (1 + r()), sc, sc * (1 + r() * 0.5));
      m.compose(p, q, s);
      rocks.setMatrixAt(k, m);
    }
    rocks.castShadow = this.q.high;
    this.scene.add(rocks);

    // flores (aparecen con la limpieza)
    const flowerGeo = new THREE.IcosahedronGeometry(0.42, 0);
    flowerGeo.scale(1, 0.6, 1);
    flowerGeo.translate(0, 0.55, 0);
    const nF = this.q.high ? 2200 : 1100;
    const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshLambertMaterial(), nF);
    const fm: THREE.Matrix4[] = [], ft: number[] = [];
    const fcols = ['#ffd23f', '#ff6b9a', '#ffffff', '#c084fc', '#ff8c42', '#7dd3fc'];
    i = 0;
    while (i < nF) {
      const x = (r() - 0.5) * 700, z = (r() - 0.5) * 480;
      const d = bankDistance(x, z);
      if (d < 5 || d > 70) continue;
      const cx = x, cz = z;
      const col = new THREE.Color(fcols[Math.floor(r() * fcols.length)]);
      const thr = 0.1 + r() * 0.85;
      for (let k = 0; k < 8 && i < nF; k++) {
        const fx = cx + (r() - 0.5) * 5, fz = cz + (r() - 0.5) * 5;
        p.set(fx, terrainHeight(fx, fz), fz);
        q.setFromAxisAngle(up, r() * 6);
        const sc = 0.7 + r() * 0.8;
        s.set(sc, sc, sc);
        fm.push(new THREE.Matrix4().compose(p, q, s));
        ft.push(thr + r() * 0.05);
        flowers.setColorAt(i, col);
        flowers.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
        i++;
      }
    }
    this.scene.add(flowers);
    this.bloomers.push({ mesh: flowers, mats: fm, thresholds: ft });

    // nenúfares sobre el agua cerca de la orilla
    const padGeo = new THREE.CircleGeometry(0.8, 10, 0.3, Math.PI * 1.8);
    padGeo.rotateX(-Math.PI / 2);
    const nP = 500;
    const pads = new THREE.InstancedMesh(padGeo, new THREE.MeshLambertMaterial({ color: '#4f9d3a', side: THREE.DoubleSide }), nP);
    const pm: THREE.Matrix4[] = [], pt: number[] = [];
    for (let k = 0; k < nP; k++) {
      const x = (r() - 0.5) * 680;
      const side = r() < 0.5 ? -1 : 1;
      const z = riverCenter(x) + side * (riverHalfWidth(x) - 1.5 - r() * 6);
      p.set(x, 0.06, z);
      q.setFromAxisAngle(up, r() * 6.28);
      const sc = 0.6 + r() * 0.9;
      pm.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(sc, 1, sc)));
      pt.push(0.25 + r() * 0.7);
      pads.setMatrixAt(k, new THREE.Matrix4().makeScale(0, 0, 0));
    }
    pads.renderOrder = 2;
    this.scene.add(pads);
    this.bloomers.push({ mesh: pads, mats: pm, thresholds: pt });
  }

  // ------------------------------------------------------------- planta de reciclaje
  plantGroup = new THREE.Group();
  private buildPlant() {
    const g = this.plantGroup;
    const dock = plantDock();
    const bankZ = riverCenter(PLANT_X) - riverHalfWidth(PLANT_X);
    const baseY = terrainHeight(PLANT_X, bankZ - 14);
    const white = new THREE.MeshLambertMaterial({ color: '#f1efe6' });
    const green = new THREE.MeshLambertMaterial({ color: '#2fa560' });
    const darkGreen = new THREE.MeshLambertMaterial({ color: '#1f6e45' });
    const wood = new THREE.MeshLambertMaterial({ color: '#9a6b43' });
    const metal = new THREE.MeshLambertMaterial({ color: '#9aa3a8' });
    const solar = new THREE.MeshStandardMaterial({ color: '#1d3557', metalness: 0.6, roughness: 0.25 });

    const shed = new THREE.Mesh(new THREE.BoxGeometry(18, 7, 11), white);
    shed.position.set(PLANT_X, baseY + 3.5, bankZ - 15);
    g.add(shed);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(19, 0.6, 12), green);
    roof.position.set(PLANT_X, baseY + 7.3, bankZ - 15);
    g.add(roof);
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.15, 4.5), solar);
      sp.position.set(PLANT_X - 6.5 + i * 4.3, baseY + 7.9, bankZ - 15);
      sp.rotation.x = -0.35;
      g.add(sp);
    }
    // franja verde y portón
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(18.1, 1.2, 11.1), green);
    stripe.position.set(PLANT_X, baseY + 5.2, bankZ - 15);
    g.add(stripe);
    const door = new THREE.Mesh(new THREE.BoxGeometry(6, 4.5, 0.2), darkGreen);
    door.position.set(PLANT_X, baseY + 2.25, bankZ - 9.45);
    g.add(door);
    // silos
    for (const [dx, h, col] of [[12, 9, '#2fa560'], [15.5, 7, '#f2b134'], [12.5, 6, '#3a86ff']] as const) {
      const silo = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, h, 14), new THREE.MeshLambertMaterial({ color: col }));
      silo.position.set(PLANT_X + dx, baseY + h / 2, bankZ - 15 + (dx === 12.5 ? -4.5 : 0));
      g.add(silo);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1, 14), metal);
      cap.position.set(silo.position.x, baseY + h + 0.5, silo.position.z);
      g.add(cap);
    }
    // cinta transportadora al muelle
    const belt = new THREE.Mesh(new THREE.BoxGeometry(2, 0.4, 13), new THREE.MeshLambertMaterial({ color: '#56646b' }));
    belt.position.set(PLANT_X + 5, baseY + 1.6, bankZ - 3);
    belt.rotation.x = -0.12;
    g.add(belt);
    // muelle de madera
    const deck = new THREE.Mesh(new THREE.BoxGeometry(12, 0.35, 7), wood);
    deck.position.set(PLANT_X, 0.55, bankZ + 1.5);
    g.add(deck);
    for (let i = -1; i <= 1; i += 2)
      for (let j = 0; j < 3; j++) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.4, 6), wood);
        post.position.set(PLANT_X + i * 5.6, 0.1, bankZ - 1.2 + j * 2.8);
        g.add(post);
      }
    // contenedores de colores
    const binCols = ['#2fa560', '#f2b134', '#3a86ff', '#e63946'];
    binCols.forEach((c, i) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 1.4), new THREE.MeshLambertMaterial({ color: c }));
      b.position.set(PLANT_X - 7 + i * 1.7, baseY + 0.75, bankZ - 6.5);
      g.add(b);
    });
    // cartel
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.2), new THREE.MeshBasicMaterial({ map: this.signTexture(), transparent: true }));
    sign.position.set(PLANT_X, baseY + 9.8, bankZ - 9.4);
    g.add(sign);
    const signPost = new THREE.Mesh(new THREE.BoxGeometry(10.4, 2.6, 0.2), darkGreen);
    signPost.position.set(PLANT_X, baseY + 9.8, bankZ - 9.55);
    g.add(signPost);

    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = this.q.high;
        o.receiveShadow = this.q.high;
      }
    });
    this.scene.add(g);

    // anillo que marca la zona de descarga
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(DOCK_RADIUS - 0.6, DOCK_RADIUS, 48),
      new THREE.MeshBasicMaterial({ color: '#7dffb0', transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(dock.x, 0.15, dock.z);
    ring.renderOrder = 3;
    this.dockRing = ring;
    this.scene.add(ring);
  }

  private signTexture() {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 220;
    const x = c.getContext('2d')!;
    x.fillStyle = '#ffffff';
    x.font = '800 120px "Baloo 2", system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('♻ RECICLAJE', 512, 118);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }

  // ------------------------------------------------------------- puente atirantado (guiño al Rosario–Victoria)
  private buildBridge() {
    const bx = 120;
    const c = riverCenter(bx), hw = riverHalfWidth(bx);
    const g = new THREE.Group();
    const concrete = new THREE.MeshLambertMaterial({ color: '#d9d4c7' });
    const deckLen = hw * 2 + 40;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(5, 0.9, deckLen), concrete);
    deck.position.set(bx, 9, c);
    g.add(deck);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.3, deckLen), new THREE.MeshLambertMaterial({ color: '#e63946' }));
    rail.position.set(bx, 9.6, c);
    g.add(rail);
    const cableMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 });
    for (const side of [-1, 1]) {
      const tz = c + side * (hw + 3);
      const ty = terrainHeight(bx, tz);
      const tower = new THREE.Mesh(new THREE.BoxGeometry(1.4, 34 - ty, 1.4), concrete);
      tower.position.set(bx, ty + (34 - ty) / 2, tz);
      g.add(tower);
      // tirantes en abanico
      const pts: THREE.Vector3[] = [];
      for (let k = 1; k <= 7; k++) {
        for (const dir of [-1, 1]) {
          pts.push(new THREE.Vector3(bx, 32 - k * 0.6, tz));
          pts.push(new THREE.Vector3(bx, 9.4, tz + dir * k * 4.2));
        }
      }
      g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), cableMat));
    }
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = this.q.high;
    });
    this.scene.add(g);
  }

  // ------------------------------------------------------------- update
  update(t: number, cleanliness: number, boat: THREE.Vector3, boatSpeedNorm: number) {
    this.waterMat.uniforms.uTime.value = t;
    this.waterMat.uniforms.uClean.value = cleanliness;
    this.waterMat.uniforms.uBoat.value.set(boat.x, boatSpeedNorm, boat.z);
    this.skyMat.uniforms.uTime.value = t;
    this.skyMat.uniforms.uClean.value = cleanliness;
    for (const u of this.swayUniforms) u.value = t;
    const pulse = 0.35 + 0.25 * Math.sin(t * 3);
    (this.dockRing.material as THREE.MeshBasicMaterial).opacity = pulse;
    this.dockRing.scale.setScalar(1 + 0.04 * Math.sin(t * 3));

    if (Math.abs(cleanliness - this.appliedClean) > 0.004) this.applyCleanliness(cleanliness);
  }

  private applyCleanliness(c: number) {
    this.appliedClean = c;
    const ce = Math.pow(c, 0.75); // visual un poco adelantado para que se note el progreso
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(lerpColor(this.fogDirty, this.fogClean, ce));
    fog.density = 0.0055 - 0.0028 * ce;
    this.sun.intensity = 2.3 + 0.9 * ce;
    this.sun.color.copy(lerpColor(new THREE.Color('#ffe2b8'), new THREE.Color('#ffd9a8'), ce));
    this.hemi.intensity = 1.1 + 0.3 * ce;

    const col = this.terrainGeo.attributes.color as THREE.BufferAttribute;
    const arr = col.array as Float32Array;
    for (let i = 0; i < arr.length; i++) arr[i] = this.terrainDirty[i] + (this.terrainClean[i] - this.terrainDirty[i]) * ce;
    col.needsUpdate = true;

    const tmp = new THREE.Color();
    const lerpInst = (o: { canopy?: THREE.InstancedMesh; mesh?: THREE.InstancedMesh; dirty: THREE.Color[]; clean: THREE.Color[] }) => {
      const mesh = (o.canopy ?? o.mesh)!;
      for (let i = 0; i < o.dirty.length; i++) mesh.setColorAt(i, tmp.copy(o.dirty[i]).lerp(o.clean[i], ce));
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    lerpInst(this.trees);
    lerpInst((this as any).pines);
    lerpInst(this.reeds);

    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const b of this.bloomers) {
      for (let i = 0; i < b.mats.length; i++) b.mesh.setMatrixAt(i, c >= b.thresholds[i] ? b.mats[i] : zero);
      b.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
