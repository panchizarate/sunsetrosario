import * as THREE from 'three';

export const NOISE = /* glsl */ `
float ph21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float pn2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(ph21(i), ph21(i + vec2(1, 0)), f.x), mix(ph21(i + vec2(0, 1)), ph21(i + vec2(1, 1)), f.x), f.y); }
float pfbm(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += pn2(p) * a; p = p * 2.03 + 1.7; a *= 0.5; } return s; }
`;

type Patch = { vs?: string; fsHead?: string; color?: string; rough?: string; normal?: string; emissive?: string };

/** Material estándar con patrón procedural en espacio mundo (vWP) o local (vLP). */
export function proc(params: THREE.MeshStandardMaterialParameters, patch: Patch, physical = false): THREE.MeshStandardMaterial {
  const m = physical ? new THREE.MeshPhysicalMaterial(params as THREE.MeshPhysicalMaterialParameters) : new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.uniforms ?? {});
    sh.vertexShader = 'varying vec3 vWP;\nvarying vec3 vLP;\nvarying vec3 vWN;\n' + sh.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
       vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
       vLP = transformed;
       vWN = normalize(mat3(modelMatrix) * objectNormal);
       ${patch.vs ?? ''}`,
    );
    sh.fragmentShader = 'varying vec3 vWP;\nvarying vec3 vLP;\nvarying vec3 vWN;\n' + NOISE + (patch.fsHead ?? '') + '\nfloat pRough = -1.0;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>\n${patch.color ?? ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${patch.rough ?? ''}\nif (pRough >= 0.0) roughnessFactor = pRough;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${patch.emissive ?? ''}`);
  };
  m.customProgramCacheKey = () => JSON.stringify(patch).slice(0, 200) + (physical ? 'p' : 's');
  return m;
}

// piedra oscura pulida en placas grandes (moteado sutil + juntas finas)
export function marbleDark() {
  return proc({ color: 0xffffff, roughness: 0.14, metalness: 0.0 }, {
    color: `
      vec2 q = vWP.xz;
      vec2 tid = floor(q / vec2(1.2, 2.4));
      float tv = ph21(tid) * 0.25;
      float mott = pfbm(q * 0.8 + tid * 3.1) * 0.6 + pfbm(q * 6.0) * 0.4;
      vec3 base = mix(vec3(0.02, 0.02, 0.024), vec3(0.05, 0.047, 0.052), mott + tv);
      float fleck = step(0.985, ph21(floor(q * 90.0))) * 0.12;
      diffuseColor.rgb = base + fleck;
      vec2 g = abs(fract(q / vec2(1.2, 2.4)) - 0.5);
      float joint = smoothstep(0.497, 0.5, g.x) + smoothstep(0.4985, 0.5, g.y);
      diffuseColor.rgb *= 1.0 - min(joint, 1.0) * 0.7;`,
    rough: `pRough = 0.1 + pfbm(vWP.xz * 1.5) * 0.12;`,
  });
}

export function marbleWhite() {
  return proc({ color: 0xffffff, roughness: 0.15 }, {
    color: `
      vec2 p = (vWP.xz + vWP.yy * 0.7) * 0.6;
      float w = pfbm(p * 1.2 + pfbm(p * 2.3) * 2.5);
      float vein = smoothstep(0.03, 0.0, abs(w - 0.5));
      diffuseColor.rgb = mix(vec3(0.88, 0.87, 0.85), vec3(0.55, 0.53, 0.52), vein * 0.8) * (0.96 + 0.04 * pn2(p * 20.0));`,
  });
}

// roble claro en tablas
export function oakFloor() {
  return proc({ color: 0xffffff, roughness: 0.45 }, {
    color: `
      vec2 q = vWP.xz;
      float row = floor(q.x / 0.24);
      float off = ph21(vec2(row, 1.0)) * 3.0;
      float plank = floor((q.y + off) / 2.2);
      float id = ph21(vec2(row, plank));
      float grain = sin((q.y + off) * 40.0 + pn2(vec2(q.x * 18.0, q.y * 2.0)) * 6.0) * 0.5 + 0.5;
      vec3 c = mix(vec3(0.16, 0.1, 0.06), vec3(0.27, 0.17, 0.1), id) * (0.8 + 0.25 * grain * pn2(q * 3.0));
      float gap = smoothstep(0.005, 0.0, fract(q.x / 0.24) * 0.24) + smoothstep(0.004, 0.0, fract((q.y + off) / 2.2) * 2.2);
      diffuseColor.rgb = c * (1.0 - min(gap, 1.0) * 0.6);`,
    rough: `pRough = 0.28 + pn2(vWP.xz * 8.0) * 0.14;`,
  });
}

// nogal oscuro (paneles, muebles) en coordenadas locales
export function walnut(scale = 1) {
  return proc({ color: 0xffffff, roughness: 0.5 }, {
    color: `
      vec3 q = vLP * ${scale.toFixed(2)};
      float grain = sin((q.y + q.x * 0.15) * 140.0 + pfbm(q.xz * 6.0 + q.y * 2.0) * 5.0) * 0.5 + 0.5;
      diffuseColor.rgb = mix(vec3(0.12, 0.07, 0.045), vec3(0.21, 0.13, 0.08), grain * 0.3 + pfbm(q.xy * vec2(2.0, 12.0)) * 0.7);`,
    rough: `pRough = 0.4 + pn2(vLP.xy * 30.0) * 0.15;`,
  });
}

// microcemento (paredes y techo)
export function microcement(tint = new THREE.Color(0.62, 0.6, 0.58)) {
  const m = proc({ color: 0xffffff, roughness: 0.85 }, {
    fsHead: 'uniform vec3 uTint;',
    color: `diffuseColor.rgb = uTint * (0.88 + 0.16 * pfbm(vWP.xy * 0.7 + vWP.zz * 0.7) + 0.04 * pn2((vWP.xy + vWP.zx) * 18.0));`,
  });
  m.userData.uniforms = { uTint: { value: tint } };
  return m;
}

export function chrome() {
  return new THREE.MeshStandardMaterial({ color: 0xe8ecf0, roughness: 0.12, metalness: 1 });
}
export function brass() {
  return new THREE.MeshStandardMaterial({ color: 0xc9a45c, roughness: 0.28, metalness: 1 });
}
export function blackSteel() {
  return new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.35, metalness: 0.9 });
}

/** Terciopelo: brillo rasante tipo sheen. */
export function velvet(color: string) {
  const m = new THREE.MeshPhysicalMaterial({ color, roughness: 0.85, sheen: 1, sheenRoughness: 0.45, sheenColor: new THREE.Color(color).lerp(new THREE.Color('#ffffff'), 0.35) });
  return m;
}
export function leather(color: string) {
  return proc({ color, roughness: 0.55 }, {
    color: `diffuseColor.rgb *= 0.9 + 0.15 * pn2(vLP.xy * 80.0) * pn2(vLP.zy * 60.0);`,
  });
}

/** Panel de ónix retroiluminado (emisivo con vetas). */
export function onyx(color = new THREE.Color('#ffb15a')) {
  const m = proc({ color: 0x221508, roughness: 0.2, emissive: 0xffffff, emissiveIntensity: 1 }, {
    fsHead: 'uniform vec3 uGlow; uniform float uOn;',
    emissive: `
      vec2 p = vLP.xy * 0.9 + vLP.z;
      float w = pfbm(p * 1.4 + pfbm(p * 2.7) * 2.0);
      float v = smoothstep(0.02, 0.2, abs(w - 0.5));
      totalEmissiveRadiance = uGlow * (0.12 + 0.75 * v * v) * uOn;`,
  });
  m.userData.uniforms = { uGlow: { value: color }, uOn: { value: 0.25 } };
  return m;
}

/** Vidrio de ventanal con gotas de lluvia animadas. */
export function rainGlass(timeU: { value: number }) {
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: timeU, uEnv: { value: null } },
    vertexShader: /* glsl */ `varying vec3 vWP; varying vec3 vN; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; varying vec3 vWP; varying vec3 vN;
      ${NOISE}
      float drops(vec2 uv, float t){
        vec2 g = vec2(uv.x * 9.0, uv.y * 4.0 + t * 1.6);
        vec2 id = floor(g); vec2 f = fract(g) - 0.5;
        float r = ph21(id);
        f.x += (r - 0.5) * 0.6;
        float d = length(f * vec2(1.0, 2.2));
        float trail = smoothstep(0.06, 0.0, abs(f.x)) * smoothstep(0.5, -0.2, f.y) * step(0.7, r);
        return smoothstep(0.12, 0.05, d) * step(0.35, r) + trail * 0.4;
      }
      void main(){
        vec2 uv = vec2(vWP.x + vWP.z, vWP.y) * 0.7;
        float d = drops(uv, uTime) + drops(uv * 1.7 + 3.3, uTime * 1.3) * 0.7;
        vec3 V = normalize(cameraPosition - vWP);
        float fres = pow(1.0 - abs(dot(V, vN)), 4.0);
        vec3 col = mix(vec3(0.05, 0.06, 0.1), vec3(0.6, 0.65, 0.85), fres);
        float a = 0.07 + fres * 0.35 + d * 0.22;
        gl_FragColor = vec4(col + d * vec3(0.5, 0.55, 0.7), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  return m;
}

/** Neón: color emisivo puro (el bloom hace el resto). */
export function neon(color: string, intensity = 3) {
  return new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });
}

/** Textura de texto (carteles, etiquetas). */
export function textTexture(text: string, opts: { w?: number; h?: number; font?: string; color?: string; bg?: string; glow?: string } = {}) {
  const w = opts.w ?? 1024, h = opts.h ?? 256;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  if (opts.bg) { x.fillStyle = opts.bg; x.fillRect(0, 0, w, h); }
  x.font = opts.font ?? `700 ${Math.round(h * 0.5)}px "Space Grotesk", Inter, system-ui, sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  if (opts.glow) { x.shadowColor = opts.glow; x.shadowBlur = h * 0.12; }
  x.fillStyle = opts.color ?? '#ffffff';
  x.fillText(text, w / 2, h / 2 + h * 0.03);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
