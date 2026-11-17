import * as THREE from 'three';
import { NOISE } from './materials';

/** Ciudad nocturna, cielo, luna, relámpagos y lluvia. */
export class City {
  group = new THREE.Group();
  flash = { value: 0 };
  private timeU = { value: 0 };
  private rain!: THREE.InstancedMesh;
  private drops: Float32Array;
  private nRain: number;
  private nextBolt = 25;
  onThunder: (strength: number) => void = () => {};

  constructor(scene: THREE.Scene, high: boolean) {
    // cielo
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { uTime: this.timeU, uFlash: this.flash },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: `uniform float uTime, uFlash; varying vec3 vD;
        ${NOISE}
        void main(){
          float h = vD.y;
          vec3 col = mix(vec3(0.16, 0.07, 0.2), vec3(0.015, 0.02, 0.05), smoothstep(-0.05, 0.5, h));
          col += vec3(0.35, 0.12, 0.25) * exp(-max(h, 0.0) * 9.0) * 0.6; // resplandor de la ciudad
          vec2 uv = vD.xz / max(vD.y + 0.15, 0.05);
          float c = pfbm(uv * 0.6 + vec2(uTime * 0.01, 0.0));
          col = mix(col, vec3(0.09, 0.07, 0.12) + uFlash * 0.6, smoothstep(0.45, 0.8, c) * 0.85);
          // luna
          vec3 md = normalize(vec3(-0.5, 0.35, -0.8));
          float m = dot(vD, md);
          col += vec3(0.9, 0.92, 1.0) * smoothstep(0.9993, 0.9996, m) * (1.0 - smoothstep(0.55, 0.75, c) * 0.8);
          col += vec3(0.3, 0.32, 0.45) * pow(max(m, 0.0), 80.0) * 0.4;
          col += vec3(0.6, 0.65, 0.9) * uFlash * smoothstep(0.0, 0.6, h);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    }));
    sky.frustumCulled = false;
    this.group.add(sky);

    // torres con ventanas iluminadas (shader procedural por coordenadas de mundo)
    const winMat = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uFlash: { value: 0 } }]),
      vertexShader: `varying vec3 vWP; varying vec3 vN; varying float vSeed; attribute float aSeed;
        #include <fog_pars_vertex>
        void main(){ vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vWP = w.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vSeed = aSeed; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `varying vec3 vWP; varying vec3 vN; varying float vSeed; uniform float uTime, uFlash;
        #include <fog_pars_fragment>
        ${NOISE}
        void main(){
          vec2 f = abs(vN.x) > 0.5 ? vec2(vWP.z, vWP.y) : vec2(vWP.x, vWP.y);
          vec2 cell = floor(f / vec2(2.6, 3.8));
          vec2 g = fract(f / vec2(2.6, 3.8));
          vec2 fw = fwidth(f);
          float aa = smoothstep(0.25, 0.9, max(fw.x / 2.6, fw.y / 3.8));
          float win = step(0.2, g.x) * step(g.x, 0.8) * step(0.25, g.y) * step(g.y, 0.75);
          float r = ph21(cell + vSeed * 17.0);
          float band = step(0.5, ph21(vec2(floor(f.y / 30.0), vSeed * 9.0)));
          float lit = step(0.84 - band * 0.1, r) * (0.55 + 0.45 * ph21(cell * 3.1)) * (0.85 + 0.15 * sin(uTime * 0.3 + r * 40.0));
          vec3 warm = mix(vec3(1.0, 0.75, 0.45), vec3(0.6, 0.8, 1.0), step(0.85, ph21(cell * 1.7 + vSeed)));
          vec3 glass = mix(vec3(0.012, 0.016, 0.03), vec3(0.03, 0.035, 0.06), step(0.5, fract(f.x / 9.0)));
          vec3 col = glass + win * lit * warm * 1.1;
          col = mix(col, glass + warm * 0.05, aa);
          if (vN.y > 0.5) col = vec3(0.03) + step(0.97, ph21(floor(vWP.xz * 0.3))) * vec3(1.0, 0.2, 0.2);
          col += uFlash * 0.04;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    const n = high ? 420 : 220;
    const towers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), winMat, n);
    const seeds = new Float32Array(n);
    const m = new THREE.Matrix4();
    let rs = 11;
    const r = () => ((rs = (rs * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < n; i++) {
      let x = 0, z = 0;
      do { x = (r() - 0.5) * 1400; z = (r() - 0.5) * 1400; } while (Math.hypot(x - 5, z) < 160);
      const d = Math.hypot(x, z);
      const h = -150 + r() * 150 + (r() < 0.14 ? r() * 140 : 0) + (d > 500 ? 40 : 0);
      const w = 22 + r() * 40, dd = 22 + r() * 40;
      m.compose(new THREE.Vector3(x, -420, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.round(r() * 3) * 0.08), new THREE.Vector3(w, h + 420, dd));
      towers.setMatrixAt(i, m);
      seeds[i] = r();
    }
    towers.geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    (this as any).winMat = winMat;
    this.group.add(towers);
    // calles allá abajo: grilla de luces naranjas y autos
    const streets = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.ShaderMaterial({
      fog: true,
      uniforms: Object.assign(THREE.UniformsUtils.merge([THREE.UniformsLib.fog]), { uTime: this.timeU }),
      vertexShader: `varying vec3 vWP;
        #include <fog_pars_vertex>
        void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWP = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
        }`,
      fragmentShader: `varying vec3 vWP; uniform float uTime;
        #include <fog_pars_fragment>
        void main(){
          vec2 p = vWP.xz / 90.0;
          vec2 g = abs(fract(p) - 0.5);
          float road = smoothstep(0.47, 0.5, max(g.x, g.y));
          float cars = step(0.93, fract((vWP.x + vWP.z) * 0.05 + uTime * 0.4)) * road;
          vec3 col = vec3(0.01, 0.008, 0.015) + road * vec3(0.5, 0.25, 0.08) * 0.6 + cars * vec3(1.0, 0.9, 0.8);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    }));
    streets.rotation.x = -Math.PI / 2;
    streets.position.y = -420;
    this.group.add(streets);
    // carteles de neón en algunas torres
    const neonCols = ['#ff2fa0', '#2ee6ff', '#ffb347', '#7dffb0', '#b06bff'];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + 0.3;
      const d = 110 + r() * 160;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(14 + r() * 12, 4 + r() * 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(neonCols[i % 5]).multiplyScalar(2.2), toneMapped: false }));
      p.position.set(Math.cos(a) * d, -60 + r() * 45, Math.sin(a) * d);
      p.lookAt(0, p.position.y, 0);
      this.group.add(p);
    }
    // luz de luna/ciudad que entra por los ventanales
    // lluvia: estrías finas alrededor de la cámara
    this.nRain = high ? 2600 : 1200;
    const streak = new THREE.PlaneGeometry(0.012, 0.55);
    this.rain = new THREE.InstancedMesh(streak, new THREE.MeshBasicMaterial({ color: 0x8fa3c8, transparent: true, opacity: 0.35, depthWrite: false }), this.nRain);
    this.rain.frustumCulled = false;
    this.drops = new Float32Array(this.nRain * 3);
    for (let i = 0; i < this.nRain; i++) this.drops.set([(r() - 0.5) * 70, r() * 40 - 10, (r() - 0.5) * 70], i * 3);
    this.group.add(this.rain);
    scene.add(this.group);
  }

  update(dt: number, t: number, cam: THREE.Vector3, insideTest: (x: number, z: number) => boolean) {
    this.timeU.value = t;
    const wm = (this as any).winMat as THREE.ShaderMaterial;
    wm.uniforms.uTime.value = t;
    wm.uniforms.uFlash.value = this.flash.value;
    // relámpagos
    this.nextBolt -= dt;
    if (this.nextBolt <= 0) {
      this.nextBolt = 14 + Math.random() * 30;
      const s = 0.5 + Math.random() * 0.5;
      this.flash.value = s;
      setTimeout(() => (this.flash.value = s * 0.6), 90);
      setTimeout(() => (this.flash.value = s), 160);
      setTimeout(() => this.onThunder(s), 600 + Math.random() * 1500);
    }
    this.flash.value = Math.max(0, this.flash.value - dt * 2.5);
    // lluvia (no cae dentro del edificio)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion();
    const camQ = new THREE.Euler(0, Math.atan2(cam.x, cam.z), 0);
    q.setFromEuler(camQ);
    for (let i = 0; i < this.nRain; i++) {
      let x = this.drops[i * 3], y = this.drops[i * 3 + 1], z = this.drops[i * 3 + 2];
      y -= dt * 16;
      if (y < -12) { y = 28; x = (Math.random() - 0.5) * 70; z = (Math.random() - 0.5) * 70; }
      this.drops[i * 3 + 1] = y;
      const wx = cam.x + x, wz = cam.z + z, wy = cam.y + y;
      const hidden = insideTest(wx, wz) && wy < 9.3;
      m.compose(new THREE.Vector3(wx, hidden ? -999 : wy, wz), q, new THREE.Vector3(1, 1, 1));
      this.rain.setMatrixAt(i, m);
    }
    this.rain.instanceMatrix.needsUpdate = true;
  }
}
