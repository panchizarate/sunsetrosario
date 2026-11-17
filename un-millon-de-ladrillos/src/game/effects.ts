import * as THREE from 'three';
import { SUN_DIR } from './world';

/** Textura de humo/polvo generada en canvas (sin archivos). */
function dustTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const x = c.getContext('2d')!;
  const img = x.createImageData(s, s);
  const rnd = (i: number, j: number) => {
    const v = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  const noise = (u: number, v: number) => {
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    const a = rnd(i, j), b = rnd(i + 1, j), cc = rnd(i, j + 1), d = rnd(i + 1, j + 1);
    const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
    return a + (b - a) * su + (cc - a) * sv + (a - b - cc + d) * su * sv;
  };
  for (let j = 0; j < s; j++)
    for (let i = 0; i < s; i++) {
      const u = i / s - 0.5, v = j / s - 0.5;
      const r = Math.hypot(u, v) * 2;
      const n = noise(i / 14, j / 14) * 0.55 + noise(i / 6, j / 6) * 0.3 + noise(i / 3, j / 3) * 0.15;
      const a = Math.max(0, 1 - r) ** 1.6 * (0.45 + n * 0.85);
      const k = (j * s + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = Math.min(255, a * 255);
    }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ polvo (billboards instanciados)
export class Dust {
  private n: number;
  private geo: THREE.InstancedBufferGeometry;
  private pos: Float32Array;
  private vel: Float32Array;
  private data: Float32Array; // size, alpha, rot, life
  private life: Float32Array;
  private maxLife: Float32Array;
  private grow: Float32Array;
  private cursor = 0;
  private aPos: THREE.InstancedBufferAttribute;
  private aData: THREE.InstancedBufferAttribute;

  constructor(scene: THREE.Scene, count: number) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.data = new Float32Array(count * 4);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);
    this.grow = new Float32Array(count);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.attributes.position);
    this.geo.setAttribute('uv', quad.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3);
    this.aData = new THREE.InstancedBufferAttribute(this.data, 4);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aData.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iPos', this.aPos);
    this.geo.setAttribute('iData', this.aData);
    this.geo.instanceCount = count;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: dustTexture() }, uSun: { value: SUN_DIR.clone() } }]),
      vertexShader: /* glsl */ `
        attribute vec3 iPos; attribute vec4 iData;
        varying vec2 vUv; varying float vA; varying float vLit;
        uniform vec3 uSun;
        #include <fog_pars_vertex>
        void main(){
          vUv = uv; vA = iData.y;
          float c = cos(iData.z), s = sin(iData.z);
          vec2 q = mat2(c, -s, s, c) * position.xy * iData.x;
          vec4 mvPosition = viewMatrix * vec4(iPos, 1.0);
          mvPosition.xy += q;
          // del lado del sol el polvo se ve iluminado
          vec3 toCam = normalize(cameraPosition - iPos);
          vLit = 0.65 + 0.5 * max(dot(-toCam, normalize(uSun)), 0.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex; varying vec2 vUv; varying float vA; varying float vLit;
        #include <fog_pars_fragment>
        void main(){
          vec4 t = texture2D(uTex, vUv);
          float a = t.a * vA;
          if (a < 0.004) discard;
          vec3 col = vec3(0.78, 0.66, 0.54) * vLit;
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(this.geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    scene.add(mesh);
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, size: number, grow: number, life: number, alpha = 0.6) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    this.pos.set([p.x, p.y, p.z], i * 3);
    this.vel.set([v.x, v.y, v.z], i * 3);
    this.data.set([size, 0, Math.random() * 6.28, alpha], i * 4);
    this.life[i] = life;
    this.maxLife[i] = life;
    this.grow[i] = grow;
  }

  puff(p: THREE.Vector3, n: number, spread: number, size: number, life = 2.5, alpha = 0.55) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = Math.random() * spread;
      this.emit(
        new THREE.Vector3(p.x + Math.cos(a) * sp * 0.4, p.y + Math.random() * spread * 0.3, p.z + Math.sin(a) * sp * 0.4),
        new THREE.Vector3(Math.cos(a) * sp, 0.3 + Math.random() * spread * 0.5, Math.sin(a) * sp),
        size * (0.6 + Math.random() * 0.8), size * 0.8, life * (0.7 + Math.random() * 0.6), alpha,
      );
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) { this.data[i * 4 + 1] = 0; continue; }
      this.life[i] -= dt;
      const k = 1 - this.life[i] / this.maxLife[i];
      // viento suave + frenado
      this.vel[i * 3] = this.vel[i * 3] * (1 - dt * 1.2) + 0.5 * dt;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * (1 - dt * 0.8) + 0.12 * dt;
      this.vel[i * 3 + 2] *= 1 - dt * 1.2;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.data[i * 4] += this.grow[i] * dt;
      this.data[i * 4 + 2] += dt * 0.15;
      const fadeIn = Math.min(1, k * 8);
      this.data[i * 4 + 1] = fadeIn * (1 - k) * (1 - k) * this.data[i * 4 + 3];
    }
    this.aPos.needsUpdate = true;
    this.aData.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ astillas (puntos)
export class Chips {
  private n: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private geo: THREE.BufferGeometry;
  private cursor = 0;

  constructor(scene: THREE.Scene, count: number) {
    this.n = count;
    this.pos = new Float32Array(count * 3).fill(-999);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x8a4a33, size: 0.045, sizeAttenuation: true });
    const pts = new THREE.Points(this.geo, mat);
    pts.frustumCulled = false;
    scene.add(pts);
  }

  burst(p: THREE.Vector3, n: THREE.Vector3, count: number, speed = 4) {
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      this.pos.set([p.x, p.y, p.z], i * 3);
      this.vel.set([
        n.x * speed * Math.random() + (Math.random() - 0.5) * speed,
        n.y * speed * Math.random() + Math.random() * speed * 0.8,
        n.z * speed * Math.random() + (Math.random() - 0.5) * speed,
      ], i * 3);
      this.life[i] = 0.6 + Math.random() * 0.6;
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 16 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3] *= 0.5; this.vel[i * 3 + 2] *= 0.5; this.vel[i * 3 + 1] = 0; }
      if (this.life[i] <= 0) this.pos[i * 3 + 1] = -999;
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

// ------------------------------------------------------------------ explosiones: destello + onda
export class Blasts {
  private light = new THREE.PointLight(0xffb070, 0, 60, 1.6);
  private rings: { mesh: THREE.Mesh; t: number }[] = [];
  private flashT = 0;

  constructor(private scene: THREE.Scene) {
    scene.add(this.light);
  }

  blast(p: THREE.Vector3, r: number) {
    this.light.position.copy(p);
    this.light.intensity = 900 * r;
    this.flashT = 0.35;
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, 0.1, p.z);
    this.scene.add(ring);
    this.rings.push({ mesh: ring, t: 0 });
  }

  update(dt: number) {
    if (this.flashT > 0) {
      this.flashT -= dt;
      this.light.intensity *= Math.max(0, 1 - dt * 9);
      if (this.flashT <= 0) this.light.intensity = 0;
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      r.mesh.scale.setScalar(1 + r.t * 28);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.6 - r.t * 1.4);
      if (r.t > 0.5) {
        this.scene.remove(r.mesh);
        r.mesh.geometry.dispose();
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }
  }
}
