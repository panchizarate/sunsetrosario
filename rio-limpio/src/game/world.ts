import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { bankDistance, riverCenter, riverHalfWidth, plantDock, PLANT_X, DOCK_RADIUS } from './config';
import { merge } from './models';

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
export function fbm(x: number, y: number) {
  return vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.28 + vnoise(x * 4.3, y * 4.3) * 0.17;
}

export function terrainHeight(x: number, z: number): number {
  const d = bankDistance(x, z);
  if (d < 0) {
    const t = Math.min(1, -d / 14);
    return -0.35 - 3.2 * (t * t * (3 - 2 * t));
  }
  const rise = Math.min(1, d / 16);
  const hills = fbm(x * 0.012, z * 0.012) * 18 * Math.min(1, Math.max(0, (d - 12) / 50));
  return -0.35 + 1.4 * Math.sqrt(rise) + hills + fbm(x * 0.08, z * 0.08) * 0.6 * rise;
}

const GLSL_NOISE = /* glsl */ `
float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float n2(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float fbm2(vec2 p){ return n2(p)*0.5 + n2(p*2.03)*0.27 + n2(p*4.11)*0.15 + n2(p*8.3)*0.08; }
`;
const GLSL_RIVER = /* glsl */ `
float riverCenter(float x){ return 14.0*sin(x*0.018) + 6.0*sin(x*0.047+1.3); }
float riverHalfWidth(float x){ return 34.0 + 7.0*sin(x*0.031+0.5); }
float bankDist(vec2 p){ return abs(p.y - riverCenter(p.x)) - riverHalfWidth(p.x); }
`;

export interface Quality {
  level: 0 | 1 | 2;
  high: boolean; // geometría detallada, más objetos
  refl: boolean; // reflejos reales en el agua
  shadows: boolean;
  post: boolean; // bloom + MSAA
  grass: number; // cantidad de matas de pasto
}
export function makeQuality(level: 0 | 1 | 2): Quality {
  return {
    level,
    high: level === 2,
    refl: level >= 1,
    shadows: level >= 1,
    post: level === 2,
    grass: level === 2 ? 16000 : level === 1 ? 7000 : 0,
  };
}

// Sol bajo de atardecer (golden hour): la misma dirección para cielo, luz y agua
const SUN_DIR = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - 13), THREE.MathUtils.degToRad(215));

export class World {
  scene = new THREE.Scene();
  sun!: THREE.DirectionalLight;
  hemi!: THREE.HemisphereLight;
  water!: THREE.Mesh;
  waterMat!: THREE.ShaderMaterial;
  private sky!: Sky;
  private envScene = new THREE.Scene();
  private envSky!: Sky;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private envClean = -1;
  private terrainGeo!: THREE.BufferGeometry;
  private terrainDirty!: Float32Array;
  private terrainClean!: Float32Array;
  private tinted: { mesh: THREE.InstancedMesh; dirty: THREE.Color[]; clean: THREE.Color[] }[] = [];
  private bloomers: { mesh: THREE.InstancedMesh; mats: THREE.Matrix4[]; thresholds: number[] }[] = [];
  private timeUniforms: { value: number }[] = [];
  private dockRing!: THREE.Mesh;
  private appliedClean = -1;
  fogDirty = new THREE.Color('#c2ae8a');
  fogClean = new THREE.Color('#e9c9a3');

  constructor(private renderer: THREE.WebGLRenderer, private q: Quality) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.fog = new THREE.FogExp2(this.fogDirty.getHex(), 0.005);
    this.buildSky();
    this.buildLights();
    this.buildTerrain();
    this.buildWater();
    this.buildTrees();
    this.buildGrass();
    this.buildShore();
    this.buildPlant();
    this.buildBridge();
    this.applyCleanliness(0);
  }

  get sunDir() {
    return SUN_DIR;
  }

  private timeUniform() {
    const u = { value: 0 };
    this.timeUniforms.push(u);
    return u;
  }

  // ------------------------------------------------------------- cielo + luz ambiente (PBR)
  private makeSky() {
    const sky = new Sky();
    sky.scale.setScalar(1200);
    const u = sky.material.uniforms;
    u.sunPosition.value.copy(SUN_DIR);
    u.mieDirectionalG.value = 0.82;
    return sky;
  }

  private clouds!: THREE.ShaderMaterial;
  private buildSky() {
    this.sky = this.makeSky();
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.envSky = this.makeSky();
    this.envScene.add(this.envSky);

    // capa de nubes procedural (se ilumina del lado del sol y se refleja en el agua)
    this.clouds = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      side: THREE.DoubleSide,
      uniforms: { uTime: this.timeUniform(), uClean: { value: 0 }, uSun: { value: SUN_DIR.clone() } },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uClean; uniform vec3 uSun;
        varying vec3 vW;
        ${GLSL_NOISE}
        void main(){
          vec2 p = vW.xz * 0.0045 + vec2(uTime * 0.004, uTime * 0.0015);
          float n = fbm2(p) * 0.65 + fbm2(p * 2.7 + 3.1) * 0.35;
          float cover = mix(0.48, 0.56, uClean);
          float a = smoothstep(cover, cover + 0.22, n);
          float edge = length(vW.xz) / 1100.0;
          a *= 1.0 - smoothstep(0.55, 1.0, edge);
          vec3 dir = normalize(vW - cameraPosition);
          float sunSide = pow(max(dot(normalize(vec3(dir.x, 0.0, dir.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0), 3.0);
          vec3 lit = mix(vec3(1.0, 0.93, 0.85), vec3(1.0, 0.72, 0.45), sunSide);
          vec3 shade = mix(vec3(0.62, 0.6, 0.62), vec3(0.55, 0.6, 0.72), uClean);
          float thick = smoothstep(cover, cover + 0.5, n);
          vec3 col = mix(lit, shade, thick * 0.7);
          col = mix(col, vec3(0.75, 0.7, 0.6), (1.0 - uClean) * 0.35);
          gl_FragColor = vec4(col * 1.6, a * 0.85);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const cl = new THREE.Mesh(new THREE.PlaneGeometry(2400, 2400), this.clouds);
    cl.rotation.x = -Math.PI / 2;
    cl.position.y = 160;
    cl.frustumCulled = false;
    this.scene.add(cl);
  }

  private setSkyParams(sky: Sky, c: number) {
    const u = sky.material.uniforms;
    u.turbidity.value = THREE.MathUtils.lerp(8, 2.6, c); // smog -> aire limpio
    u.rayleigh.value = THREE.MathUtils.lerp(0.9, 2.2, c);
    u.mieCoefficient.value = THREE.MathUtils.lerp(0.011, 0.004, c);
  }

  private updateEnv(c: number) {
    this.setSkyParams(this.envSky, c);
    const rt = this.pmrem.fromScene(this.envScene, 0.02);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.envClean = c;
  }

  private buildLights() {
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a4a30, 0.35);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffd2a0, 2.8);
    this.sun.position.copy(SUN_DIR).multiplyScalar(120);
    if (this.q.shadows) {
      this.sun.castShadow = true;
      const s = this.q.high ? 2048 : 1024;
      this.sun.shadow.mapSize.set(s, s);
      const c = this.sun.shadow.camera;
      c.left = -50; c.right = 50; c.top = 50; c.bottom = -50; c.near = 1; c.far = 300;
      this.sun.shadow.bias = -0.0005;
      this.sun.shadow.normalBias = 0.05;
      this.sun.shadow.radius = 3;
    }
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
  }

  followShadow(x: number, z: number) {
    this.sun.position.set(x + SUN_DIR.x * 120, SUN_DIR.y * 120, z + SUN_DIR.z * 120);
    this.sun.target.position.set(x, 0, z);
  }

  // ------------------------------------------------------------- terreno con detalle procedural
  private buildTerrain() {
    const W = 760, D = 520;
    const sx = this.q.high ? 260 : 170, sz = this.q.high ? 180 : 115;
    const geo = new THREE.PlaneGeometry(W, D, sx, sz);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const n = pos.count;
    this.terrainDirty = new Float32Array(n * 3);
    this.terrainClean = new Float32Array(n * 3);
    const sandC = new THREE.Color('#d8bc8a'), wetSand = new THREE.Color('#9d8463'), grassC = new THREE.Color('#5a9a36'), grass2 = new THREE.Color('#3f7f2e');
    const hillC = new THREE.Color('#6f9a3c'), bedC = new THREE.Color('#6d6046');
    const sandD = new THREE.Color('#a89474'), grassD = new THREE.Color('#8a8650'), grass2D = new THREE.Color('#716c42'), bedD = new THREE.Color('#4a4232');
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const y = terrainHeight(x, z);
      pos.setY(i, y);
      const d = bankDistance(x, z);
      const nz = fbm(x * 0.05, z * 0.05);
      let c: THREE.Color, cd: THREE.Color;
      if (d < 0) { c = bedC.clone(); cd = bedD.clone(); }
      else if (d < 1.5) { c = wetSand.clone(); cd = bedD.clone().lerp(sandD, 0.4); }
      else if (d < 5) { c = sandC.clone(); cd = sandD.clone(); }
      else {
        const t = Math.min(1, (d - 5) / 5);
        c = sandC.clone().lerp(nz > 0.5 ? grassC : grass2, t);
        cd = sandD.clone().lerp(nz > 0.5 ? grassD : grass2D, t);
        if (y > 7) c.lerp(hillC, Math.min(1, (y - 7) / 6));
      }
      const v = 0.88 + nz * 0.24;
      this.terrainClean.set([c.r * v, c.g * v, c.b * v], i * 3);
      this.terrainDirty.set([cd.r * v, cd.g * v, cd.b * v], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.terrainDirty), 3));
    geo.computeVertexNormals();
    this.terrainGeo = geo;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    // detalle de alta frecuencia en el shader: rompe la repetición y da textura de suelo
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
      sh.fragmentShader = 'varying vec3 vWPos;\n' + GLSL_NOISE + sh.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float dn = fbm2(vWPos.xz * 0.45) * 0.6 + fbm2(vWPos.xz * 3.1) * 0.4;
         diffuseColor.rgb *= 0.78 + 0.42 * dn;
         float speck = step(0.93, h21(floor(vWPos.xz * 6.0)));
         diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.25, speck * 0.5);`,
      );
    };
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = this.q.shadows;
    this.scene.add(mesh);
  }

  // ------------------------------------------------------------- agua con reflejos
  private buildWater() {
    const uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        color: { value: new THREE.Color(0x7f7f7f) },
        tDiffuse: { value: null },
        textureMatrix: { value: new THREE.Matrix4() },
        uTime: { value: 0 },
        uClean: { value: 0 },
        uSunDir: { value: SUN_DIR.clone() },
        uBoat: { value: new THREE.Vector3() },
        uHasRefl: { value: this.q.refl ? 1 : 0 },
        uHorizon: { value: new THREE.Color('#e9c9a3') },
        uZenith: { value: new THREE.Color('#5b8fc9') },
      },
    ]);
    const shader = {
      name: 'RioWater',
      uniforms,
      vertexShader: /* glsl */ `
        uniform mat4 textureMatrix;
        varying vec4 vUv;
        varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main(){
          vUv = textureMatrix * vec4(position, 1.0);
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uTime, uClean, uHasRefl;
        uniform vec3 uSunDir, uBoat, uHorizon, uZenith;
        varying vec4 vUv;
        varying vec3 vWorld;
        #include <common>
        #include <fog_pars_fragment>
        ${GLSL_NOISE}
        ${GLSL_RIVER}
        float hgt(vec2 p){
          float t = uTime;
          vec2 flow = vec2(t * 0.45, 0.0);
          return n2((p - flow) * 0.32) * 0.5
               + n2((p * 0.9 - flow * 1.3 + vec2(0.0, t * 0.15)) * 0.85) * 0.28
               + n2((p - flow * 1.9) * 2.4) * 0.14
               + n2((p + vec2(t * 0.3, -t * 0.4)) * 5.5) * 0.07;
        }
        void main(){
          vec2 p = vWorld.xz;
          float d = bankDist(p);
          float depth = smoothstep(0.0, -16.0, d);
          float e = 0.12;
          float h0 = hgt(p);
          float calm = mix(0.75, 1.0, uClean);
          vec3 N = normalize(vec3((h0 - hgt(p + vec2(e, 0.0))) * 1.6 * calm, 1.0, (h0 - hgt(p + vec2(0.0, e))) * 1.6 * calm));
          vec3 V = normalize(cameraPosition - vWorld);
          vec3 L = normalize(uSunDir);

          // color propio del agua (absorción): sucia = verde-marrón turbia, limpia = turquesa/azul
          vec3 shallow = mix(vec3(0.36, 0.38, 0.22), vec3(0.16, 0.62, 0.60), uClean);
          vec3 deep = mix(vec3(0.17, 0.21, 0.12), vec3(0.02, 0.20, 0.30), uClean);
          vec3 body = mix(shallow, deep, depth);
          // dispersión bajo la superficie en las crestas
          body += vec3(0.05, 0.12, 0.10) * uClean * smoothstep(0.55, 0.9, h0);

          // reflejo real (planar) o aproximado
          vec3 R = reflect(-V, N);
          vec3 refl;
          if (uHasRefl > 0.5) {
            vec2 uv = vUv.xy / vUv.w + N.xz * 0.045;
            refl = texture2D(tDiffuse, uv).rgb;
          } else {
            refl = mix(uHorizon, uZenith, smoothstep(0.0, 0.6, R.y));
          }
          float F = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          float reflAmt = mix(0.45, 0.85, uClean);
          vec3 col = mix(body, refl, clamp(F * reflAmt + 0.08, 0.0, 1.0));

          // sol
          vec3 H = normalize(L + V);
          float spec = pow(max(dot(N, H), 0.0), 600.0) * 6.0 + pow(max(dot(N, H), 0.0), 60.0) * 0.12;
          col += vec3(1.0, 0.85, 0.6) * spec * mix(0.5, 1.0, uClean);

          // película de aceite (solo con el río muy sucio)
          float oilMask = smoothstep(0.62, 0.85, n2(p * 0.05 + vec2(uTime * 0.02, 0.0))) * (1.0 - smoothstep(0.0, 0.3, uClean));
          vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (n2(p * 0.4) * 1.5 + vec3(0.0, 0.33, 0.67)));
          col = mix(col, col * 0.75 + rainbow * 0.3, oilMask * 0.4);
          // espuma de orilla
          float foamN = fbm2(p * 1.4 + vec2(uTime * 0.35, 0.0));
          float shore = smoothstep(-2.4, 0.15, d) * smoothstep(0.42, 0.72, foamN + 0.22 * sin(uTime * 1.4 + d * 3.0));
          vec3 foamC = mix(vec3(0.78, 0.74, 0.58), vec3(0.97, 0.98, 1.0), uClean);
          col = mix(col, foamC, shore * 0.8);
          // estela del barco
          float bd = length(p - uBoat.xz);
          float wake = smoothstep(4.5, 0.0, bd) * uBoat.y * smoothstep(0.45, 0.8, foamN);
          col = mix(col, foamC, wake * 0.55);

          float alpha = mix(0.78, 0.97, depth);
          alpha = max(alpha, shore * 0.9);
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    };
    const geo = new THREE.PlaneGeometry(760, 520);
    let mesh: THREE.Mesh;
    if (this.q.refl) {
      const s = this.q.high ? 1024 : 384;
      const refl = new Reflector(geo, { shader, textureWidth: s, textureHeight: Math.round(s * 0.6), clipBias: 0.003, multisample: this.q.high ? 4 : 0 });
      mesh = refl;
    } else {
      mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial(shader));
    }
    this.waterMat = mesh.material as THREE.ShaderMaterial;
    this.waterMat.transparent = true;
    this.waterMat.fog = true;
    mesh.rotation.x = -Math.PI / 2;
    mesh.renderOrder = 1;
    this.water = mesh;
    this.scene.add(mesh);
  }

  // ------------------------------------------------------------- vegetación
  private addSway(mat: THREE.Material, amp: number, heightScale = 1) {
    const u = this.timeUniform();
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
         float hgt = max(position.y * ${heightScale.toFixed(2)}, 0.0);
         float sw = (sin(uTime * 1.3 + ip.x * 0.3 + ip.z * 0.2) + 0.4 * sin(uTime * 3.1 + ip.x)) * ${amp.toFixed(3)} * hgt * hgt;
         transformed.x += sw; transformed.z += sw * 0.6;`,
      );
    };
  }

  private canopyGeo(r: () => number, lobes: number) {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < lobes; i++) {
      const s = 0.55 + r() * 0.5;
      const g = new THREE.IcosahedronGeometry(s, 1);
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const j = 1 + (r() - 0.5) * 0.25;
        p.setXYZ(k, p.getX(k) * j, p.getY(k) * j * 0.85, p.getZ(k) * j);
      }
      const a = (i / lobes) * Math.PI * 2;
      g.translate(Math.cos(a) * 0.45 * (i ? 1 : 0), 0.9 + r() * 0.5 + (i === 0 ? 0.35 : 0), Math.sin(a) * 0.45 * (i ? 1 : 0));
      parts.push(g);
    }
    const geo = merge(parts);
    // oclusión ambiental falsa: más oscuro abajo y adentro
    const p = geo.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(p.count * 3);
    for (let k = 0; k < p.count; k++) {
      const ao = 0.55 + 0.45 * Math.min(1, Math.max(0, (p.getY(k) - 0.4) / 1.4));
      col.set([ao, ao, ao], k * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  }

  private buildTrees() {
    const r = mulberry32(42);
    const count = this.q.high ? 1100 : 600;
    const roundGeo = this.canopyGeo(r, 5);
    const pineParts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 3; i++) {
      const c = new THREE.ConeGeometry(0.95 - i * 0.22, 1.4, 8);
      c.translate(0, 0.9 + i * 0.75, 0);
      pineParts.push(c);
    }
    const pineGeo = merge(pineParts);
    {
      const p = pineGeo.attributes.position as THREE.BufferAttribute;
      const col = new Float32Array(p.count * 3);
      for (let k = 0; k < p.count; k++) {
        const ao = 0.6 + 0.4 * Math.min(1, p.getY(k) / 2.6);
        col.set([ao, ao, ao], k * 3);
      }
      pineGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    }
    const trunkGeo = new THREE.CylinderGeometry(0.1, 0.2, 1.6, 7);
    trunkGeo.translate(0, 0.8, 0);

    const canopyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
    this.addSway(canopyMat, 0.03);
    const roundMesh = new THREE.InstancedMesh(roundGeo, canopyMat, count);
    const pineMesh = new THREE.InstancedMesh(pineGeo, canopyMat, count);
    const trunkMesh = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: '#5e4430', roughness: 0.9 }), count * 2);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let nr = 0, np = 0, nt = 0;
    const dR: THREE.Color[] = [], cR: THREE.Color[] = [], dP: THREE.Color[] = [], cP: THREE.Color[] = [];
    const greens = ['#4b8f34', '#5fa540', '#3c7f36', '#76b445', '#2e6f3d', '#86b83e', '#6a9a3a'];
    const plant = plantDock();
    let tries = 0;
    while (nr + np < count && tries < count * 25) {
      tries++;
      const x = (r() - 0.5) * 720;
      const z = (r() - 0.5) * 500;
      const d = bankDistance(x, z);
      if (d < 7 || d > 210) continue;
      if (Math.hypot(x - plant.x, z - plant.z) < 30) continue;
      if (Math.abs(x - 120) < 10 && d < 30) continue;
      const density = fbm(x * 0.02 + 10, z * 0.02);
      if (r() > density * 1.5 - 0.15) continue;
      const y = terrainHeight(x, z) - 0.2;
      const sc = 1.7 + r() * 2.4;
      const isPine = r() < 0.3;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      const g = new THREE.Color(greens[Math.floor(r() * greens.length)]);
      const dc = new THREE.Color('#7a7046').lerp(new THREE.Color('#8f6b3c'), r() * 0.6);
      p.set(x, y + sc * 0.95, z);
      if (isPine) {
        s.set(sc * 0.85, sc * 1.25, sc * 0.85);
        m.compose(p, q, s);
        pineMesh.setMatrixAt(np, m);
        dP.push(dc); cP.push(g.clone().multiplyScalar(0.8));
        np++;
      } else {
        s.set(sc * (0.9 + r() * 0.35), sc * (0.8 + r() * 0.3), sc * (0.9 + r() * 0.35));
        m.compose(p, q, s);
        roundMesh.setMatrixAt(nr, m);
        dR.push(dc); cR.push(g);
        nr++;
      }
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sc * 0.65, sc * 0.75, sc * 0.65));
      trunkMesh.setMatrixAt(nt++, m);
    }
    roundMesh.count = nr; pineMesh.count = np; trunkMesh.count = nt;
    for (let i = 0; i < nr; i++) roundMesh.setColorAt(i, dR[i]);
    for (let i = 0; i < np; i++) pineMesh.setColorAt(i, dP[i]);
    for (const mesh of [roundMesh, pineMesh, trunkMesh]) {
      mesh.castShadow = this.q.shadows;
      this.scene.add(mesh);
    }
    this.tinted.push({ mesh: roundMesh, dirty: dR, clean: cR }, { mesh: pineMesh, dirty: dP, clean: cP });

    // arbustos en las orillas
    const bushGeo = this.canopyGeo(mulberry32(5), 3);
    bushGeo.translate(0, -0.6, 0);
    const nB = this.q.high ? 900 : 450;
    const bushes = new THREE.InstancedMesh(bushGeo, canopyMat, nB);
    const dB: THREE.Color[] = [], cB: THREE.Color[] = [];
    let nb = 0;
    while (nb < nB) {
      const x = (r() - 0.5) * 700;
      const side = r() < 0.5 ? -1 : 1;
      const z = riverCenter(x) + side * (riverHalfWidth(x) + 4.5 + r() * 14);
      if (Math.hypot(x - plant.x, z - plant.z) < 24) continue;
      const sc = 0.8 + r() * 1.1;
      m.compose(new THREE.Vector3(x, terrainHeight(x, z), z), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6), new THREE.Vector3(sc * 1.3, sc, sc * 1.3));
      bushes.setMatrixAt(nb, m);
      dB.push(new THREE.Color('#857a4a'));
      cB.push(new THREE.Color(greens[Math.floor(r() * greens.length)]).multiplyScalar(0.85));
      bushes.setColorAt(nb, dB[nb]);
      nb++;
    }
    bushes.castShadow = this.q.shadows;
    this.scene.add(bushes);
    this.tinted.push({ mesh: bushes, dirty: dB, clean: cB });
  }

  private buildGrass() {
    if (!this.q.grass) return;
    const r = mulberry32(77);
    // mata de 6 hojas curvas
    const blades: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 6; i++) {
      const b = new THREE.PlaneGeometry(0.07, 0.75, 1, 3);
      const p = b.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < p.count; k++) {
        const y = p.getY(k) + 0.375;
        p.setXYZ(k, p.getX(k) * (1 - y / 0.9), y, y * y * 0.35);
      }
      b.rotateY((i / 6) * Math.PI * 2 + r());
      b.translate((r() - 0.5) * 0.25, 0, (r() - 0.5) * 0.25);
      blades.push(b);
    }
    const geo = merge(blades);
    // normales hacia arriba: el pasto se ilumina suave como en los juegos modernos
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    for (let k = 0; k < nrm.count; k++) nrm.setXYZ(k, 0, 1, 0);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    for (let k = 0; k < pos.count; k++) {
      const t = Math.min(1, pos.getY(k) / 0.75);
      const v = 0.45 + 0.65 * t;
      col.set([v, v, v], k * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
    this.addSway(mat, 0.25);
    const n = this.q.grass;
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const dirty: THREE.Color[] = [], clean: THREE.Color[] = [];
    const plant = plantDock();
    let i = 0, tries = 0;
    while (i < n && tries < n * 30) {
      tries++;
      const x = (r() - 0.5) * 680;
      const side = r() < 0.5 ? -1 : 1;
      const z = riverCenter(x) + side * (riverHalfWidth(x) + 5 + Math.pow(r(), 1.6) * 60);
      if (Math.hypot(x - plant.x, z - plant.z) < 20) continue;
      if (fbm(x * 0.06, z * 0.06) < 0.4) continue;
      const sc = 0.8 + r() * 0.9;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
      m.compose(new THREE.Vector3(x, terrainHeight(x, z) - 0.05, z), q, s.set(sc, sc * (0.8 + r() * 0.6), sc));
      mesh.setMatrixAt(i, m);
      dirty.push(new THREE.Color('#9b9058').multiplyScalar(0.85 + r() * 0.3));
      clean.push(new THREE.Color(r() < 0.5 ? '#5f9e35' : '#7cb342').multiplyScalar(0.85 + r() * 0.3));
      mesh.setColorAt(i, dirty[i]);
      i++;
    }
    mesh.count = i;
    mesh.layers.set(1); // no se dibuja en el reflejo del agua (ahorra GPU)
    mesh.receiveShadow = this.q.shadows;
    this.scene.add(mesh);
    this.tinted.push({ mesh, dirty, clean });
  }

  // ------------------------------------------------------------- orilla: juncos, rocas, flores, nenúfares
  private buildShore() {
    const r = mulberry32(99);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const pl = plantDock();

    const reedGeo = new THREE.ConeGeometry(0.05, 1.7, 4);
    reedGeo.translate(0, 0.85, 0);
    const reedMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    this.addSway(reedMat, 0.06);
    const nReeds = this.q.high ? 3200 : 1600;
    const reeds = new THREE.InstancedMesh(reedGeo, reedMat, nReeds);
    const rd: THREE.Color[] = [], rc: THREE.Color[] = [];
    let i = 0;
    while (i < nReeds) {
      const x = (r() - 0.5) * 680;
      const side = r() < 0.5 ? -1 : 1;
      const off = -2.5 + r() * 5.5;
      const z = riverCenter(x) + side * (riverHalfWidth(x) + off);
      if (fbm(x * 0.04, side * 9) < 0.42) continue;
      if (Math.hypot(x - pl.x, z - pl.z) < 18) continue;
      const y = Math.max(terrainHeight(x, z), -0.6);
      for (let k = 0; k < 7 && i < nReeds; k++) {
        p.set(x + (r() - 0.5) * 1.6, y, z + (r() - 0.5) * 1.6);
        q.setFromAxisAngle(new THREE.Vector3(r() - 0.5, 0, r() - 0.5).normalize(), (r() - 0.5) * 0.4);
        s.set(1, 0.7 + r() * 0.9, 1);
        m.compose(p, q, s);
        reeds.setMatrixAt(i, m);
        rd.push(new THREE.Color('#7d7046').multiplyScalar(0.8 + r() * 0.3));
        rc.push(new THREE.Color(r() < 0.5 ? '#5e9a45' : '#8bb150').multiplyScalar(0.8 + r() * 0.3));
        reeds.setColorAt(i, rd[i]);
        i++;
      }
    }
    this.scene.add(reeds);
    this.tinted.push({ mesh: reeds, dirty: rd, clean: rc });

    const rockGeo = new THREE.DodecahedronGeometry(1, 1);
    {
      const pp = rockGeo.attributes.position as THREE.BufferAttribute;
      for (let k = 0; k < pp.count; k++) {
        const j = 0.8 + vnoise(pp.getX(k) * 3 + 5, pp.getZ(k) * 3 + pp.getY(k)) * 0.4;
        pp.setXYZ(k, pp.getX(k) * j, pp.getY(k) * j * 0.7, pp.getZ(k) * j);
      }
      rockGeo.computeVertexNormals();
    }
    const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, flatShading: true }), 320);
    for (let k = 0; k < 320; k++) {
      const x = (r() - 0.5) * 680;
      const side = r() < 0.5 ? -1 : 1;
      const z = riverCenter(x) + side * (riverHalfWidth(x) + 0.5 + r() * 7);
      const sc = 0.3 + r() * 1.1;
      p.set(x, terrainHeight(x, z) + sc * 0.1, z);
      q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
      s.set(sc * (1 + r()), sc, sc * (1 + r() * 0.5));
      m.compose(p, q, s);
      rocks.setMatrixAt(k, m);
      rocks.setColorAt(k, new THREE.Color('#8a8378').multiplyScalar(0.75 + r() * 0.4));
    }
    rocks.castShadow = this.q.shadows;
    rocks.receiveShadow = this.q.shadows;
    this.scene.add(rocks);

    // flores (aparecen con la limpieza)
    const petal = new THREE.CircleGeometry(0.22, 6);
    petal.rotateX(-Math.PI / 2);
    petal.translate(0, 0.55, 0);
    const stem = new THREE.CylinderGeometry(0.015, 0.015, 0.55, 3);
    stem.translate(0, 0.27, 0);
    const flowerGeo = merge([petal, stem]);
    const nF = this.q.high ? 2600 : 1300;
    const flowers = new THREE.InstancedMesh(flowerGeo, new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide }), nF);
    const fm: THREE.Matrix4[] = [], ft: number[] = [];
    const fcols = ['#ffd23f', '#ff6b9a', '#ffffff', '#c084fc', '#ff8c42', '#7dd3fc', '#f43f5e'];
    i = 0;
    while (i < nF) {
      const cx = (r() - 0.5) * 700, cz = (r() - 0.5) * 480;
      const d = bankDistance(cx, cz);
      if (d < 6 || d > 70) continue;
      const col = new THREE.Color(fcols[Math.floor(r() * fcols.length)]);
      const thr = 0.1 + r() * 0.85;
      for (let k = 0; k < 10 && i < nF; k++) {
        const fx = cx + (r() - 0.5) * 5, fz = cz + (r() - 0.5) * 5;
        p.set(fx, terrainHeight(fx, fz), fz);
        q.setFromAxisAngle(up, r() * 6);
        const sc = 0.7 + r() * 0.8;
        fm.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(sc, sc, sc)));
        ft.push(thr + r() * 0.05);
        flowers.setColorAt(i, col);
        flowers.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
        i++;
      }
    }
    flowers.layers.set(1);
    this.scene.add(flowers);
    this.bloomers.push({ mesh: flowers, mats: fm, thresholds: ft });

    const padGeo = new THREE.CircleGeometry(0.8, 12, 0.3, Math.PI * 1.8);
    padGeo.rotateX(-Math.PI / 2);
    const nP = 600;
    const pads = new THREE.InstancedMesh(padGeo, new THREE.MeshStandardMaterial({ color: '#4f9d3a', roughness: 0.5, side: THREE.DoubleSide }), nP);
    const pm: THREE.Matrix4[] = [], pt: number[] = [];
    for (let k = 0; k < nP; k++) {
      const x = (r() - 0.5) * 680;
      const side = r() < 0.5 ? -1 : 1;
      const z = riverCenter(x) + side * (riverHalfWidth(x) - 1.5 - r() * 6);
      p.set(x, 0.05, z);
      q.setFromAxisAngle(up, r() * 6.28);
      const sc = 0.6 + r() * 0.9;
      pm.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(sc, 1, sc)));
      pt.push(0.25 + r() * 0.7);
      pads.setMatrixAt(k, new THREE.Matrix4().makeScale(0, 0, 0));
      pads.setColorAt(k, new THREE.Color('#4f9d3a').multiplyScalar(0.8 + r() * 0.4));
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
    const sm = (color: string, rough = 0.7, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const white = sm('#eceae2', 0.6);
    const green = sm('#2b9a59', 0.55);
    const darkGreen = sm('#1d6343', 0.6);
    const wood = sm('#8d6240', 0.85);
    const metal = sm('#a7b0b5', 0.35, 0.8);
    const solar = sm('#1d3557', 0.15, 0.7);
    const concrete = sm('#b9b5ab', 0.9);

    const slab = new THREE.Mesh(new THREE.BoxGeometry(30, 0.6, 13), concrete);
    slab.position.set(PLANT_X + 3, baseY - 0.25, bankZ - 15.5);
    g.add(slab);
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
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(18.1, 1.2, 11.1), green);
    stripe.position.set(PLANT_X, baseY + 5.2, bankZ - 15);
    g.add(stripe);
    const door = new THREE.Mesh(new THREE.BoxGeometry(6, 4.5, 0.2), sm('#5d6b70', 0.5, 0.5));
    door.position.set(PLANT_X, baseY + 2.25, bankZ - 9.45);
    g.add(door);
    for (let k = 0; k < 9; k++) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(6, 0.06, 0.25), sm('#4a565b', 0.5, 0.5));
      rib.position.set(PLANT_X, baseY + 0.4 + k * 0.5, bankZ - 9.33);
      g.add(rib);
    }
    for (const [dx, h, col] of [[12, 9, '#2b9a59'], [15.5, 7, '#e9a92f'], [12.5, 6, '#3a7bd5']] as const) {
      const silo = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, h, 20), sm(col, 0.45, 0.3));
      silo.position.set(PLANT_X + dx, baseY + h / 2, bankZ - 15 + (dx === 12.5 ? -4.5 : 0));
      g.add(silo);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1, 20), metal);
      cap.position.set(silo.position.x, baseY + h + 0.5, silo.position.z);
      g.add(cap);
    }
    const belt = new THREE.Mesh(new THREE.BoxGeometry(2, 0.4, 13), sm('#3e4a50', 0.6, 0.3));
    belt.position.set(PLANT_X + 5, baseY + 1.6, bankZ - 3);
    belt.rotation.x = -0.12;
    g.add(belt);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(12, 0.35, 7), wood);
    deck.position.set(PLANT_X, 0.55, bankZ + 1.5);
    g.add(deck);
    for (let k = 0; k < 12; k++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 7), sm(k % 2 ? '#94683f' : '#7f5734', 0.9));
      plank.position.set(PLANT_X - 5.5 + k * 1.0, 0.75, bankZ + 1.5);
      g.add(plank);
    }
    for (let i = -1; i <= 1; i += 2)
      for (let j = 0; j < 3; j++) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 2.4, 8), wood);
        post.position.set(PLANT_X + i * 5.6, 0.1, bankZ - 1.2 + j * 2.8);
        g.add(post);
      }
    ['#2b9a59', '#e9a92f', '#3a7bd5', '#d64045'].forEach((c, i) => {
      const b = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.5, 1.4), sm(c, 0.5));
      b.position.set(PLANT_X - 7 + i * 1.7, baseY + 0.75, bankZ - 6.5);
      g.add(b);
    });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.2), new THREE.MeshBasicMaterial({ map: this.signTexture(), transparent: true }));
    sign.position.set(PLANT_X, baseY + 9.8, bankZ - 9.4);
    g.add(sign);
    const signPost = new THREE.Mesh(new THREE.BoxGeometry(10.4, 2.6, 0.2), darkGreen);
    signPost.position.set(PLANT_X, baseY + 9.8, bankZ - 9.55);
    g.add(signPost);

    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = this.q.shadows;
        o.receiveShadow = this.q.shadows;
      }
    });
    this.scene.add(g);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(DOCK_RADIUS - 0.5, DOCK_RADIUS, 64),
      new THREE.MeshBasicMaterial({ color: '#7dffb0', transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(dock.x, 0.15, dock.z);
    ring.renderOrder = 3;
    ring.layers.set(1);
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
    const concrete = new THREE.MeshStandardMaterial({ color: '#d4cfc2', roughness: 0.85 });
    const deckLen = hw * 2 + 40;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(5, 0.9, deckLen), concrete);
    deck.position.set(bx, 9, c);
    g.add(deck);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.3, deckLen), new THREE.MeshStandardMaterial({ color: '#c8323c', roughness: 0.5 }));
    rail.position.set(bx, 9.6, c);
    g.add(rail);
    const cableMat = new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 });
    for (const side of [-1, 1]) {
      const tz = c + side * (hw + 3);
      const ty = terrainHeight(bx, tz);
      for (const dx of [-1.6, 1.6]) {
        const tower = new THREE.Mesh(new THREE.BoxGeometry(0.9, 34 - ty, 1.2), concrete);
        tower.position.set(bx + dx, ty + (34 - ty) / 2, tz);
        tower.rotation.z = -dx * 0.03;
        g.add(tower);
      }
      const beam = new THREE.Mesh(new THREE.BoxGeometry(4, 1, 1.2), concrete);
      beam.position.set(bx, 22, tz);
      g.add(beam);
      const pts: THREE.Vector3[] = [];
      for (let k = 1; k <= 9; k++) {
        for (const dir of [-1, 1]) {
          pts.push(new THREE.Vector3(bx, 33 - k * 0.6, tz));
          pts.push(new THREE.Vector3(bx, 9.4, tz + dir * k * 3.4));
        }
      }
      g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), cableMat));
    }
    g.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = this.q.shadows;
    });
    this.scene.add(g);
  }

  // ------------------------------------------------------------- update
  update(t: number, cleanliness: number, boat: THREE.Vector3, boatSpeedNorm: number) {
    const u = this.waterMat.uniforms;
    u.uTime.value = t;
    u.uClean.value = cleanliness;
    u.uBoat.value.set(boat.x, boatSpeedNorm, boat.z);
    for (const tu of this.timeUniforms) tu.value = t;
    (this.dockRing.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.25 * Math.sin(t * 3);
    this.dockRing.scale.setScalar(1 + 0.04 * Math.sin(t * 3));
    if (Math.abs(cleanliness - this.appliedClean) > 0.004) this.applyCleanliness(cleanliness);
    const ce = Math.pow(cleanliness, 0.75);
    if (Math.abs(ce - this.envClean) > 0.06) this.updateEnv(ce);
  }

  private applyCleanliness(c: number) {
    this.appliedClean = c;
    const ce = Math.pow(c, 0.75);
    this.setSkyParams(this.sky, ce);
    this.clouds.uniforms.uClean.value = ce;
    if (this.envClean < 0) this.updateEnv(ce);
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.copy(this.fogDirty).lerp(this.fogClean, ce);
    fog.density = 0.0052 - 0.0026 * ce;
    this.sun.intensity = 2.3 + 0.9 * ce;
    this.sun.color.set('#ffdcb5').lerp(new THREE.Color('#ffd2a0'), ce);
    this.hemi.intensity = 0.3 + 0.15 * ce;
    this.waterMat.uniforms.uHorizon.value.copy(fog.color);

    const col = this.terrainGeo.attributes.color as THREE.BufferAttribute;
    const arr = col.array as Float32Array;
    for (let i = 0; i < arr.length; i++) arr[i] = this.terrainDirty[i] + (this.terrainClean[i] - this.terrainDirty[i]) * ce;
    col.needsUpdate = true;

    const tmp = new THREE.Color();
    for (const o of this.tinted) {
      for (let i = 0; i < o.dirty.length; i++) o.mesh.setColorAt(i, tmp.copy(o.dirty[i]).lerp(o.clean[i], ce));
      if (o.mesh.instanceColor) o.mesh.instanceColor.needsUpdate = true;
    }
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const b of this.bloomers) {
      for (let i = 0; i < b.mats.length; i++) b.mesh.setMatrixAt(i, c >= b.thresholds[i] ? b.mats[i] : zero);
      b.mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
