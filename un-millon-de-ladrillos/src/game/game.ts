import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import {
  UPGRADES, UpgradeId, stats, Stats, OBJECTIVES, Objective, ToolId, TOOL_ORDER, DUMPSTER, SPAWN, LOT, BL, BH, T, TOTAL_BRICKS,
} from './config';
import { World, makeQuality, Quality } from './world';
import { BrickSystem, Removal, Collapse, Wall } from './bricks';
import { DebrisSystem, Debris } from './debris';
import { Dust, Chips, Blasts } from './effects';
import { ViewModel } from './tools';
import { Input } from './input';
import { UI } from './ui';
import { audio } from './audio';
import { t, fmt, fmtInt, setLang } from './i18n';
import { SaveData, loadSave, newSave, writeSave, clearSave, loadSettings, writeSettings, Settings } from './save';

const TOOL_UP: Record<ToolId, UpgradeId> = { martillo: 'martillo', maza: 'maza', neumatico: 'neumatico', bola: 'bola', explosivos: 'explosivos' };
const EYE = 1.65;
const RADIUS = 0.32;

interface Npc {
  kind: 'worker' | 'robot';
  group: THREE.Group;
  pos: THREE.Vector3;
  yaw: number;
  load: number;
  target: Debris | null;
  state: 'seek' | 'return' | 'walk' | 'hit';
  wall: Wall | null;
  lx: number;
  front: boolean;
  timer: number;
  misses: number;
  phase: number;
  arm?: THREE.Object3D;
}

interface Charge { mesh: THREE.Mesh; pos: THREE.Vector3 }

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uAmount: { value: 0.35 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uAmount; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = vUv - 0.5;
      float v = 1.0 - dot(d, d) * uAmount * 2.2;
      c.rgb *= v;
      c.rgb = mix(c.rgb, c.rgb * vec3(1.04, 1.0, 0.94), 0.6);      // calidez de atardecer
      c.rgb = (c.rgb - 0.5) * 1.05 + 0.5;                          // contraste
      gl_FragColor = c;
    }`,
};

export class Game {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer | null = null;
  camera: THREE.PerspectiveCamera;
  world: World;
  bricks: BrickSystem;
  debris: DebrisSystem;
  dust: Dust;
  chips: Chips;
  blasts: Blasts;
  vm: ViewModel;
  input: Input;
  ui: UI;
  save: SaveData;
  settings: Settings;
  q: Quality;
  st!: Stats;
  mode: 'title' | 'play' = 'title';
  tool: ToolId = 'martillo';
  time = 0;
  pos = new THREE.Vector3(SPAWN.x, 0, SPAWN.z);
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = true;
  private last = performance.now();
  private cd = 0;
  private pickBudget = 0;
  private stepDist = 0;
  private shake = 0;
  private saveTimer = 0;
  private fullWarned = false;
  private ball: THREE.Mesh;
  private cable: THREE.Line;
  private ballAnim: { t: number; target: THREE.Vector3; hit: boolean } | null = null;
  private ballCd = 0;
  private charges: Charge[] = [];
  private detonating = false;
  private npcs: Npc[] = [];
  private wasLocked = false;
  private endShown = false;
  private aim: ReturnType<BrickSystem['raycast']> = null;
  private lookCache: [number, number] = [0, 0];
  private noRender = new URLSearchParams(location.search).has('norender');
  private timescale = Math.max(1, Math.min(60, +(new URLSearchParams(location.search).get('timescale') ?? 1)));

  constructor(canvas: HTMLCanvasElement) {
    this.settings = loadSettings();
    if (this.settings.lang) setLang(this.settings.lang);
    const params = new URLSearchParams(location.search);
    const isMobile = matchMedia('(pointer: coarse)').matches;
    const qp = params.get('quality');
    this.q = makeQuality(qp !== null ? (+qp as 0 | 1 | 2) : this.settings.quality ?? (isMobile ? 1 : 2));

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.q.post, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.q.pixelRatio));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.72;
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(72, 1, 0.05, 1800);
    this.world = new World(this.renderer, this.q);
    const scene = this.world.scene;
    this.bricks = new BrickSystem(scene, this.q.shadows);
    this.debris = new DebrisSystem(scene, this.q.high, this.q.shadows);
    this.dust = new Dust(scene, this.q.high ? 900 : 500);
    this.chips = new Chips(scene, 600);
    this.blasts = new Blasts(scene);
    this.vm = new ViewModel(scene.environment);

    // bola de demolición colgando de la grúa
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.MeshStandardMaterial({ color: '#2b2d30', roughness: 0.35, metalness: 0.9 }));
    this.ball.castShadow = this.q.shadows;
    this.ball.visible = false;
    scene.add(this.ball);
    this.cable = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x222222 }));
    this.cable.frustumCulled = false;
    this.cable.visible = false;
    scene.add(this.cable);

    this.save = loadSave() ?? newSave();
    if (this.save.walls.length) this.bricks.restore(this.save.walls);
    if (this.save.debris.length) this.debris.restore(this.save.debris);
    this.applyDebug(params);
    this.st = stats(this.save.levels);
    this.pos.set(this.save.player.x, 0, this.save.player.z);
    this.yaw = this.save.player.yaw;

    this.bricks.onCollapse = (c) => this.onCollapse(c);
    this.debris.onImpact = (d, sp) => {
      const dist = d.pos.distanceTo(this.camera.position);
      audio.clack(sp, dist, this.panOf(d.pos));
    };

    this.input = new Input(canvas);
    this.input.sensitivity = this.settings.sens;
    this.input.onKey = (k) => this.onKey(k);

    this.ui = new UI({
      buy: (id) => this.buy(id),
      click: () => audio.click(),
      settingsChanged: (s) => {
        this.settings = s;
        audio.musicVolume = s.music;
        audio.sfxVolume = s.sfx;
        audio.applyVolumes();
        this.input.sensitivity = s.sens;
        writeSettings(s);
      },
      reset: () => { clearSave(); location.reload(); },
      shopToggled: (open) => {
        if (open) document.exitPointerLock?.();
        else this.lock();
      },
      selectTool: (id) => this.selectTool(id),
      fire: (down) => this.input.setFire(down),
      jump: () => this.input.setJump(true),
      detonate: () => this.detonate(),
      start: () => { this.ui.pauseOverlay(false); this.lock(); },
    }, this.input.isTouch);
    this.ui.settings = this.settings;
    audio.musicVolume = this.settings.music;
    audio.sfxVolume = this.settings.sfx;
    this.ui.setHudVisible(false);

    this.setupPost();
    this.syncNpcs();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { this.persist(); audio.suspend(); } else { audio.resume(); this.last = performance.now(); }
    });
    window.addEventListener('pagehide', () => this.persist());

    const hasSave = loadSave() !== null;
    this.ui.showTitle(hasSave, this.input.isTouch, () => this.startPlay(), () => { clearSave(); location.reload(); });
    if (params.has('autoplay')) { (this.ui as any).closeTitle?.(); this.startPlay(); }
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ depuración
  private applyDebug(p: URLSearchParams) {
    if (p.has('money')) this.save.money = +p.get('money')!;
    if (p.has('levels')) {
      const lv = +p.get('levels')!;
      for (const u of UPGRADES) {
        if (!this.save.unlocked.includes(u.id)) this.save.unlocked.push(u.id);
        this.save.levels[u.id] = Math.min(u.max, lv);
      }
    }
    if (p.has('obj')) this.save.objective = +p.get('obj')!;
    if (p.has('px')) this.save.player = { x: +p.get('px')!, z: +(p.get('pz') ?? 0), yaw: +(p.get('yaw') ?? 0) };
  }

  private setupPost() {
    if (!this.q.post) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.q.high ? 4 : 2 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.world.scene, this.camera));
    const vmPass = new RenderPass(this.vm.scene, this.vm.camera);
    vmPass.clear = false;
    vmPass.clearDepth = true;
    this.composer.addPass(vmPass);
    if (this.q.high) this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.18, 0.55, 0.95));
    this.composer.addPass(new OutputPass());
    this.composer.addPass(new ShaderPass(GradeShader));
  }

  // ------------------------------------------------------------------ flujo
  private startPlay() {
    audio.start();
    this.mode = 'play';
    this.ui.setHudVisible(true);
    this.lock();
    this.ui.showHint(this.input.isTouch ? t().controlsMobile : t().controlsDesktop, 6000);
  }

  private lock() {
    if (this.input.isTouch || this.mode !== 'play') return;
    const c = this.renderer.domElement as any;
    try { c.requestPointerLock?.()?.catch?.(() => {}); } catch { /* el visor puede no permitirlo: se mira arrastrando */ }
  }

  private onKey(k: string) {
    if (this.mode !== 'play') return;
    if (k === 'e' || k === 'tab') this.ui.toggleShop();
    if (k === 'escape' && this.ui.shopOpen) this.ui.toggleShop(false);
    if (k === 'q') {
      const tools = this.availableTools();
      this.selectTool(tools[(tools.indexOf(this.tool) + 1) % tools.length]);
    }
    if (k === 'f') this.detonate();
    const n = +k;
    if (n >= 1 && n <= 5) {
      const tools = this.availableTools();
      if (tools[n - 1]) this.selectTool(tools[n - 1]);
    }
  }

  availableTools() {
    return TOOL_ORDER.filter((id) => this.save.unlocked.includes(TOOL_UP[id]) && (id === 'martillo' || this.save.levels[TOOL_UP[id]] > 0));
  }

  selectTool(id: ToolId) {
    if (id === this.tool) return;
    this.tool = id;
    this.vm.select(id);
    audio.click();
    audio.setJack(false);
  }

  private buy(id: UpgradeId) {
    const u = UPGRADES.find((x) => x.id === id)!;
    const lv = this.save.levels[id];
    const cost = u.cost(lv);
    if (!this.save.unlocked.includes(id) || lv >= u.max || cost > this.save.money) { audio.denied(); return; }
    this.save.money -= cost;
    this.save.levels[id]++;
    this.st = stats(this.save.levels);
    audio.buy();
    if (id === 'obreros' || id === 'robots') this.syncNpcs();
    // primera compra de una herramienta: equiparla
    if (lv === 0 && (TOOL_ORDER as string[]).includes(id)) this.selectTool(id as ToolId);
    this.persist();
  }

  private persist() {
    this.save.player = { x: this.pos.x, z: this.pos.z, yaw: this.yaw };
    this.save.walls = this.bricks.serialize();
    this.save.debris = this.debris.serialize();
    writeSave(this.save);
  }

  // ------------------------------------------------------------------ objetivos
  get objective(): Objective | null {
    return OBJECTIVES[this.save.objective] ?? null;
  }
  objectiveProgress(o: Objective): number {
    switch (o.kind) {
      case 'broken': return this.save.broken;
      case 'deposited': return this.save.deposited;
      case 'building': {
        const b = this.bricks.buildings.get(o.building!)!;
        return b.done ? 1 : 1 - b.remaining / b.total;
      }
      case 'all': return TOTAL_BRICKS - this.bricks.remaining;
    }
  }
  private checkObjective() {
    const o = this.objective;
    if (!o || o.kind === 'all' || this.ui.modalOpen) return;
    const done = o.kind === 'building' ? this.bricks.buildings.get(o.building!)!.done : this.objectiveProgress(o) >= o.target;
    if (!done) return;
    this.save.objective++;
    this.save.money += o.reward.money;
    audio.unlock();
    const r = o.reward.unlock;
    if (r) {
      if (!this.save.unlocked.includes(r)) this.save.unlocked.push(r);
      if (this.save.levels[r] === 0) this.save.levels[r] = 1;
      this.st = stats(this.save.levels);
      this.syncNpcs();
      const u = UPGRADES.find((x) => x.id === r)!;
      const [name, desc] = t().up[r];
      document.exitPointerLock?.();
      this.ui.unlockCard(u.icon, name, `${desc}${o.reward.money ? ` · +$ ${fmt(o.reward.money)}` : ''}`, () => {
        if ((TOOL_ORDER as string[]).includes(r)) this.selectTool(r as ToolId);
        this.lock();
      });
    } else {
      this.ui.toast(`🎯 ${this.ui.objectiveText(o)}`, o.reward.money ? `+$ ${fmt(o.reward.money)}` : '');
    }
    this.persist();
  }

  // ------------------------------------------------------------------ utilidades
  private panOf(p: THREE.Vector3) {
    tmpV.copy(p).sub(this.camera.position).normalize();
    tmpV2.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    return Math.max(-1, Math.min(1, tmpV.dot(tmpV2)));
  }
  private camDir(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  /** Colisión de un cuerpo cilíndrico contra paredes (respeta agujeros) y utilería. */
  collide(p: THREE.Vector3, radius: number, feetY = 0) {
    for (const w of this.bricks.walls) {
      if (w.remaining <= 0) continue;
      const b = w.box;
      if (p.x < b.min.x - 1 || p.x > b.max.x + 1 || p.z < b.min.z - 1 || p.z > b.max.z + 1) continue;
      const l = tmpV.copy(p).applyMatrix4(w.inv);
      const W = w.def.cols * BL;
      if (l.x < -radius || l.x > W + radius || Math.abs(l.z) > T / 2 + radius) continue;
      let solid = false;
      for (const hy of [0.25, 0.95, 1.6]) {
        for (const ox of [-radius * 0.7, 0, radius * 0.7]) {
          if (this.bricks.solidAt(w, Math.min(W, Math.max(0, l.x + ox)), feetY + hy)) { solid = true; break; }
        }
        if (solid) break;
      }
      if (!solid) continue;
      // empujar hacia el lado más cercano
      const pz = T / 2 + radius - Math.abs(l.z);
      const px = l.x < 0 ? l.x + radius : l.x > W ? W + radius - l.x : Infinity;
      if (px < pz && (l.x < 0 || l.x > W)) l.x = l.x < 0 ? -radius : W + radius;
      else l.z = (l.z >= 0 ? 1 : -1) * (T / 2 + radius);
      p.copy(l.applyMatrix4(w.mesh.matrixWorld));
    }
    for (const c of this.world.colliders) {
      if (p.x > c.min.x - radius && p.x < c.max.x + radius && p.z > c.min.z - radius && p.z < c.max.z + radius) {
        const dx1 = p.x - (c.min.x - radius), dx2 = c.max.x + radius - p.x, dz1 = p.z - (c.min.z - radius), dz2 = c.max.z + radius - p.z;
        const m = Math.min(dx1, dx2, dz1, dz2);
        if (m === dx1) p.x = c.min.x - radius; else if (m === dx2) p.x = c.max.x + radius; else if (m === dz1) p.z = c.min.z - radius; else p.z = c.max.z + radius;
      }
    }
    p.x = Math.max(LOT.x0 - 12, Math.min(LOT.x1 + 12, p.x));
    p.z = Math.max(LOT.z0 - 12, Math.min(LOT.z1 + 26, p.z));
  }

  // ------------------------------------------------------------------ escombros a partir de una rotura
  private spawnDebris(r: Removal, power: number) {
    if (r.count <= 0 || r.points.length === 0) return;
    const n = r.points.length;
    let left = r.count;
    for (let i = 0; i < n; i++) {
      const worth = i === n - 1 ? left : Math.max(1, Math.floor(r.count / n));
      if (worth <= 0) break;
      left -= worth;
      const p = r.points[i];
      const make = (w: number) => {
        const v = r.normal.clone().multiplyScalar(1 + Math.random() * 2.5 * power);
        v.x += (Math.random() - 0.5) * 2 * power;
        v.z += (Math.random() - 0.5) * 2 * power;
        v.y += Math.random() * 2 * power;
        this.debris.spawn(p, v, w);
      };
      if (worth <= 4) for (let k = 0; k < worth; k++) make(1);
      else make(worth);
      if (left <= 0) break;
    }
    this.save.broken += r.count;
  }

  private onCollapse(c: Collapse) {
    const w = c.wall;
    const W = w.def.cols * BL, H = w.def.rows * BH;
    const y0 = c.fromRow * BH;
    const pieces = Math.max(6, Math.min(260, Math.round(c.count / 90)));
    let left = c.count;
    const center = new THREE.Vector3();
    for (let i = 0; i < pieces; i++) {
      const worth = i === pieces - 1 ? left : Math.floor(c.count / pieces);
      left -= worth;
      const lx = Math.random() * W, ly = y0 + Math.random() * (H - y0);
      const front = Math.random() < 0.5;
      const p = this.bricks.wallPoint(w, lx, ly, front);
      const nrm = new THREE.Vector3(0, 0, front ? 1 : -1).transformDirection(w.mesh.matrixWorld);
      const v = nrm.clone().multiplyScalar(1 + Math.random() * 3);
      v.y = -1 - Math.random() * 2;
      this.debris.spawn(p, v, worth);
      center.add(p);
      if (i % 6 === 0) this.dust.puff(new THREE.Vector3(p.x, Math.min(ly, 2), p.z), 3, 2, 3.5, 5, 0.5);
    }
    center.divideScalar(pieces);
    // polvo en la base
    for (let k = 0; k < 10; k++) {
      const p = this.bricks.wallPoint(w, Math.random() * W, 0.5, Math.random() < 0.5);
      this.dust.puff(p, 2, 3, 5, 6, 0.55);
    }
    this.save.broken += c.count;
    const dist = center.distanceTo(this.camera.position);
    const size = Math.min(1, c.count / 30000);
    audio.collapse(size, dist, this.panOf(center));
    this.shake = Math.max(this.shake, Math.min(1.2, (0.3 + size) * 30 / (10 + dist)));
    if (c.count > 1500 && dist < 90) {
      this.ui.bannerText(t().collapse);
      this.ui.floatText(`+${fmtInt(c.count)} 🧱`, 'big');
    }
    // ¿cayó un edificio entero?
    const b = this.bricks.buildings.get(w.def.building);
    if (b && b.done && !(b as any).announced) {
      (b as any).announced = true;
      this.ui.toast(`🏚️ ${t().obj.building(t().buildings[w.def.building])} ✓`);
    }
  }

  // ------------------------------------------------------------------ herramientas
  private useTool(dt: number) {
    const st = this.st;
    const cam = this.camera.position;
    const dir = this.camDir();
    this.cd -= dt;
    this.ballCd -= dt;
    const fire = this.input.fire && !this.ui.shopOpen && !this.ui.modalOpen;
    audio.setJack(false);
    this.vm.setVibrate(false);

    if (this.tool === 'martillo' || this.tool === 'maza') {
      if (fire && this.cd <= 0) {
        const rate = this.tool === 'martillo' ? st.hammerRate : st.sledgeRate;
        this.cd = 1 / rate;
        this.vm.swing(rate);
        const h = this.bricks.raycast(cam, dir, st.reach);
        if (h) {
          const r = this.tool === 'martillo'
            ? this.bricks.breakHit(h, st.hammerDepth)
            : this.bricks.breakSphere(h.point, st.sledgeRadius, 1, false, 14);
          if (r.count > 0) {
            this.spawnDebris(r, this.tool === 'maza' ? 1.1 : 0.6);
            this.ui.floatText(`+${r.count}`, '', window.innerWidth / 2 + 30, window.innerHeight / 2 - 30);
          }
          this.chips.burst(h.point, h.normal, this.tool === 'maza' ? 22 : 10, this.tool === 'maza' ? 5 : 3.5);
          this.dust.puff(h.point, this.tool === 'maza' ? 4 : 2, 0.6, 0.5, 2.2, 0.45);
          audio.hit(this.tool === 'maza' ? 0.9 : 0.45, this.panOf(h.point));
          this.shake = Math.max(this.shake, this.tool === 'maza' ? 0.12 : 0.04);
        }
      }
    } else if (this.tool === 'neumatico') {
      if (fire) {
        this.vm.setVibrate(true);
        const h = this.bricks.raycast(cam, dir, st.reach);
        audio.setJack(true);
        this.shake = Math.max(this.shake, 0.025);
        if (h && this.cd <= 0) {
          this.cd = 1 / st.jackRate;
          const r = this.bricks.breakSphere(h.point, st.jackRadius, 1, false, 4);
          if (r.count) this.spawnDebris(r, 0.5);
          this.chips.burst(h.point, h.normal, 3, 3);
          if (Math.random() < 0.3) this.dust.puff(h.point, 1, 0.4, 0.4, 1.8, 0.4);
        }
      }
    } else if (this.tool === 'bola') {
      if (this.input.firePressed && this.ballCd <= 0 && !this.ballAnim && !this.ui.shopOpen) {
        const h = this.bricks.raycast(cam, dir, 140);
        this.vm.swing(3);
        if (h) {
          this.ballAnim = { t: 0, target: h.point.clone(), hit: false };
          this.ballCd = st.ballCooldown;
          audio.ballWhoosh();
        } else audio.denied();
      }
    } else if (this.tool === 'explosivos') {
      if (this.input.firePressed && !this.detonating && !this.ui.shopOpen) {
        this.vm.swing(3);
        if (this.charges.length < st.bombCharges) {
          const h = this.bricks.raycast(cam, dir, 6);
          if (h) {
            const m = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.12), new THREE.MeshStandardMaterial({ color: '#c23a22', roughness: 0.6, emissive: '#300000' }));
            m.position.copy(h.point).addScaledVector(h.normal, 0.06);
            m.lookAt(h.point.clone().add(h.normal));
            this.world.scene.add(m);
            this.charges.push({ mesh: m, pos: h.point.clone() });
            audio.chargePlaced();
          } else audio.denied();
        } else audio.denied();
      }
    }
    if (this.input.alt) {
      this.input.alt = false;
      this.detonate();
    }
  }

  private detonate() {
    if (!this.charges.length || this.detonating) return;
    this.detonating = true;
    this.vm.swing(2);
    const list = [...this.charges];
    this.charges = [];
    list.forEach((c, i) => {
      setTimeout(() => {
        audio.beep();
        setTimeout(() => {
          this.world.scene.remove(c.mesh);
          this.explode(c.pos, this.st.bombRadius);
          if (i === list.length - 1) this.detonating = false;
        }, 220);
      }, i * 260);
    });
  }

  private explode(p: THREE.Vector3, radius: number) {
    const r = this.bricks.breakSphere(p, radius, 2, true, 40);
    this.spawnDebris(r, 3.2);
    this.blasts.blast(p, radius);
    this.dust.puff(p, 18, radius * 1.4, radius * 1.1, 6, 0.65);
    this.chips.burst(p, r.normal.lengthSq() ? r.normal : new THREE.Vector3(0, 1, 0), 80, 12);
    const dist = p.distanceTo(this.camera.position);
    audio.explosion(Math.min(1, radius / 5), dist, this.panOf(p));
    this.shake = Math.max(this.shake, Math.min(1.5, 25 / (8 + dist)));
    if (r.count) this.ui.floatText(`+${fmtInt(r.count)} 🧱`, 'big');
  }

  private updateBall(dt: number) {
    const tip = this.world.craneTip;
    if (!this.ballAnim) {
      this.ball.visible = false;
      this.cable.visible = false;
      return;
    }
    const a = this.ballAnim;
    a.t += dt;
    const R = this.st.ballRadius * 0.55;
    this.ball.scale.setScalar(R);
    const down = 0.9, up = 1.4;
    let p: THREE.Vector3;
    if (a.t < down) {
      const k = a.t / down;
      const e = k * k;
      // arco desde arriba de la grúa hasta el blanco
      p = new THREE.Vector3().lerpVectors(tip.clone().add(new THREE.Vector3(0, -8, 0)), a.target, e);
      p.y += Math.sin(k * Math.PI) * 6;
    } else {
      if (!a.hit) {
        a.hit = true;
        const r = this.bricks.breakSphere(a.target, this.st.ballRadius, 2, true, 36);
        this.spawnDebris(r, 2.2);
        this.dust.puff(a.target, 12, this.st.ballRadius * 1.2, this.st.ballRadius, 5, 0.6);
        this.chips.burst(a.target, r.normal, 60, 9);
        const dist = a.target.distanceTo(this.camera.position);
        audio.hit(1, this.panOf(a.target));
        audio.collapse(0.25, dist, this.panOf(a.target));
        this.shake = Math.max(this.shake, Math.min(1, 14 / (6 + dist)));
        if (r.count) this.ui.floatText(`+${fmtInt(r.count)} 🧱`, 'big');
      }
      const k = Math.min(1, (a.t - down) / up);
      p = new THREE.Vector3().lerpVectors(a.target, tip.clone().add(new THREE.Vector3(0, -8, 0)), k * k);
      if (k >= 1) this.ballAnim = null;
    }
    this.ball.position.copy(p);
    this.ball.visible = true;
    const pos = this.cable.geometry.attributes.position as THREE.BufferAttribute;
    pos.setXYZ(0, tip.x, tip.y, tip.z);
    pos.setXYZ(1, p.x, p.y + R, p.z);
    pos.needsUpdate = true;
    this.cable.visible = true;
  }

  // ------------------------------------------------------------------ jugador
  private updatePlayer(dt: number) {
    const [dx, dy] = this.input.consumeLook();
    this.lookCache = [dx, dy];
    if (this.mode === 'play' && !this.ui.shopOpen && !this.ui.modalOpen) {
      this.yaw -= dx * 0.0022;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy * 0.0022));
    }
    const speed = this.st.walk * (this.input.sprint ? 1.45 : 1);
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    const mx = this.mode === 'play' ? this.input.moveX : 0, my = this.mode === 'play' ? this.input.moveY : 0;
    const tvx = (fx * my + rx * mx) * speed, tvz = (fz * my + rz * mx) * speed;
    const acc = this.onGround ? 12 : 3;
    this.vel.x += (tvx - this.vel.x) * Math.min(1, dt * acc);
    this.vel.z += (tvz - this.vel.z) * Math.min(1, dt * acc);
    if (this.input.jump && this.onGround) { this.vel.y = 5.2; this.onGround = false; }
    this.input.jump = false;
    this.vel.y -= 16 * dt;
    this.pos.addScaledVector(this.vel, dt);
    const gy = DebrisSystem.groundY(this.pos.x, this.pos.z);
    if (this.pos.y <= gy) { this.pos.y = gy; this.vel.y = 0; this.onGround = true; }
    this.collide(this.pos, RADIUS, this.pos.y);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && hs > 0.5) {
      this.stepDist += hs * dt;
      if (this.stepDist > (this.input.sprint ? 2.1 : 1.7)) { this.stepDist = 0; audio.footstep(this.input.sprint); }
    }
    const bob = this.onGround ? Math.sin(this.time * 9) * 0.035 * Math.min(1, hs / 4) : 0;
    this.camera.position.set(this.pos.x, this.pos.y + EYE + bob, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.25;
      this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.25;
      this.camera.rotation.z += (Math.random() - 0.5) * this.shake * 0.03;
      this.shake = Math.max(0, this.shake - dt * 2.2);
    }
    this.camera.updateMatrixWorld();
  }

  // ------------------------------------------------------------------ juntar escombros y depositar
  private updateCollect(dt: number) {
    const st = this.st;
    const p = this.pos;
    if (this.save.carried < st.capacity) {
      this.pickBudget = Math.min(st.pickRate * 0.5, this.pickBudget + st.pickRate * dt);
      const camPt = () => this.camera.position.clone().add(new THREE.Vector3(0, -0.9, 0));
      let got = 0;
      this.debris.forEachNear(p.x, p.z, st.pickRadius, (d) => {
        if (this.pickBudget < 1 || this.save.carried >= st.capacity || d.claimed) return;
        if (d.pos.y > 1.2 && !d.sleeping) return;
        const w = this.debris.takeSome(d, st.capacity - this.save.carried, camPt);
        this.save.carried += w;
        this.pickBudget -= 1;
        got += w;
      });
      if (got) audio.pickup(got);
      // aspiradora: arrastra escombros hacia vos
      if (st.vacuumRadius > 0) {
        let moved = 0;
        this.debris.forEachNear(p.x, p.z, st.vacuumRadius, (d, dist) => {
          if (!d.sleeping || d.claimed || moved > 60 || dist < 0.5) return;
          moved++;
          const k = Math.min(1, (7 * dt) / dist);
          this.debris.drag(d, d.pos.x + (p.x - d.pos.x) * k, d.pos.z + (p.z - d.pos.z) * k);
        });
      }
    }
    const full = this.save.carried >= st.capacity;
    if (full && !this.fullWarned) { this.fullWarned = true; audio.full(); this.ui.showHint(t().full, 3500); }
    if (!full) this.fullWarned = false;
    if (this.save.carried > 0 && Math.hypot(p.x - DUMPSTER.x, p.z - DUMPSTER.z) < DUMPSTER.r + 1.5) this.depositFrom(this.save.carried, true);
  }

  private depositFrom(amount: number, isPlayer: boolean) {
    const money = amount * this.st.price;
    this.save.money += money;
    this.save.deposited += amount;
    if (isPlayer) {
      this.save.carried = 0;
      this.save.trips++;
      audio.deposit(Math.min(1, amount / this.st.capacity));
      this.ui.floatText(`+$ ${fmt(money)}`, 'money');
      this.dust.puff(new THREE.Vector3(DUMPSTER.x, 1.6, DUMPSTER.z), 4, 1, 1.2, 2.5, 0.5);
      this.persist();
    }
    this.world.dumpsterFill.scale.y = 0.01 + Math.min(1, (this.save.deposited % 5000) / 5000) * 5.5;
  }

  // ------------------------------------------------------------------ obreros y robots
  private makeNpc(kind: 'worker' | 'robot'): Npc {
    const g = new THREE.Group();
    const sm = (c: string, r = 0.7, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    let arm: THREE.Object3D | undefined;
    if (kind === 'worker') {
      const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.5, 4, 8), sm('#2d3f5c'));
      legs.position.y = 0.45;
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.45, 4, 10), sm('#ff7a1a'));
      body.position.y = 1.1;
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.235, 0.06, 12), sm('#dfe6e9', 0.3, 0.2));
      stripe.position.y = 1.15;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), sm('#c99a74'));
      head.position.y = 1.58;
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), sm('#ffc21a', 0.4));
      helmet.position.y = 1.62;
      const cart = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.7), sm('#6c7a80', 0.5, 0.6));
      cart.position.set(0, 0.45, 0.55);
      g.add(legs, body, stripe, head, helmet, cart);
    } else {
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 0.9), sm('#3a3f44', 0.5, 0.6));
      base.position.y = 0.25;
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.5), sm('#ffc21a', 0.45, 0.3));
      body.position.y = 0.85;
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, 0.02), new THREE.MeshBasicMaterial({ color: '#ff3b2f' }));
      eye.position.set(0, 1.0, 0.26);
      const pivot = new THREE.Group();
      pivot.position.set(0.32, 1.0, 0.1);
      const armM = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.8), sm('#555', 0.4, 0.8));
      armM.position.z = 0.4;
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.14), sm('#222', 0.4, 0.9));
      head.position.z = 0.8;
      pivot.add(armM, head);
      g.add(base, body, eye, pivot);
      arm = pivot;
    }
    g.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = this.q.shadows; });
    this.world.scene.add(g);
    const pos = new THREE.Vector3(DUMPSTER.x - 4 + Math.random() * 3, 0, DUMPSTER.z - 3);
    return { kind, group: g, pos, yaw: 0, load: 0, target: null, state: kind === 'worker' ? 'seek' : 'walk', wall: null, lx: 0, front: true, timer: 0, misses: 0, phase: Math.random() * 10, arm };
  }

  private syncNpcs() {
    const workers = this.npcs.filter((n) => n.kind === 'worker').length;
    const robots = this.npcs.filter((n) => n.kind === 'robot').length;
    for (let i = workers; i < this.st.workers; i++) this.npcs.push(this.makeNpc('worker'));
    for (let i = robots; i < this.st.robots; i++) this.npcs.push(this.makeNpc('robot'));
  }

  private walkTo(n: Npc, tx: number, tz: number, speed: number, dt: number) {
    const dx = tx - n.pos.x, dz = tz - n.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return d;
    const step = Math.min(d, speed * dt);
    n.pos.x += (dx / d) * step;
    n.pos.z += (dz / d) * step;
    const before = n.pos.clone();
    this.collide(n.pos, 0.3, 0);
    // si una pared lo frena, se desliza de costado
    if (n.pos.distanceTo(before) > step * 0.5) {
      n.pos.x += (-dz / d) * step * 0.8;
      n.pos.z += (dx / d) * step * 0.8;
    }
    n.yaw = Math.atan2(dx, dz);
    return d;
  }

  private updateNpcs(dt: number) {
    if (this.mode !== 'play') return;
    for (const n of this.npcs) {
      n.timer -= dt;
      if (n.kind === 'worker') {
        const cap = this.st.workerCapacity;
        if (n.state === 'return') {
          if (this.walkTo(n, DUMPSTER.x, DUMPSTER.z - 2, 3.4, dt) < 1.6) {
            this.depositFrom(n.load, false);
            n.load = 0;
            n.state = 'seek';
          }
        } else {
          if (!n.target || !this.debris.isAlive(n.target) || n.timer <= 0) {
            if (n.target) n.target.claimed = false;
            n.target = this.debris.nearest(n.pos.x, n.pos.z, (d) => d.sleeping);
            if (n.target) n.target.claimed = true;
            n.timer = 6;
          }
          if (n.target) {
            if (this.walkTo(n, n.target.pos.x, n.target.pos.z, 3.4, dt) < 0.9) {
              const d = n.target;
              d.claimed = false;
              n.target = null;
              n.load += this.debris.takeSome(d, cap - n.load, () => n.pos.clone().add(new THREE.Vector3(0, 0.6, 0)));
              if (n.load >= cap) n.state = 'return';
            }
          } else if (n.load > 0) n.state = 'return';
        }
      } else {
        // robot: elige una pared, se para al lado y la martilla
        if (!n.wall || n.wall.remaining <= 0 || n.misses > 6) {
          const walls = this.bricks.walls.filter((w) => w.remaining > 0);
          if (!walls.length) continue;
          walls.sort((a, b) => a.box.distanceToPoint(n.pos) - b.box.distanceToPoint(n.pos));
          n.wall = walls[Math.floor(Math.random() * Math.min(4, walls.length))];
          n.lx = 0.5 + Math.random() * (n.wall.def.cols * BL - 1);
          n.front = Math.random() < 0.5;
          n.misses = 0;
          n.state = 'walk';
        }
        const w = n.wall!;
        const target = this.bricks.wallPoint(w, n.lx, 0, n.front, tmpV2.clone());
        const nrm = new THREE.Vector3(0, 0, n.front ? 1 : -1).transformDirection(w.mesh.matrixWorld);
        target.addScaledVector(nrm, 0.9);
        if (n.state === 'walk') {
          if (this.walkTo(n, target.x, target.z, 2.6, dt) < 0.6) n.state = 'hit';
        } else {
          n.yaw = Math.atan2(-nrm.x, -nrm.z);
          if (n.timer <= 0) {
            n.timer = 0.45;
            const ly = 0.15 + Math.random() * 1.7;
            const lx = n.lx + (Math.random() - 0.5) * 1.4;
            const r = this.bricks.breakNear(w, Math.max(0.05, lx), ly, n.front);
            if (r) {
              this.spawnDebris(r, 0.5);
              n.misses = 0;
              const dist = r.points[0].distanceTo(this.camera.position);
              if (dist < 25) audio.hit(0.3 / (1 + dist * 0.15), this.panOf(r.points[0]));
              if (Math.random() < 0.3) this.dust.puff(r.points[0], 1, 0.4, 0.4, 1.6, 0.35);
            } else {
              n.misses++;
              n.lx = Math.max(0.3, Math.min(w.def.cols * BL - 0.3, n.lx + (Math.random() - 0.5) * 2.5));
              if (n.misses > 3) n.state = 'walk';
            }
          }
        }
        if (n.arm) n.arm.rotation.x = n.state === 'hit' ? -0.6 + Math.abs(Math.sin(this.time * 7 + n.phase)) * 1.2 : 0;
      }
      n.group.position.set(n.pos.x, Math.abs(Math.sin(this.time * 9 + n.phase)) * 0.04, n.pos.z);
      n.group.rotation.y = n.yaw;
    }
  }

  // ------------------------------------------------------------------ final
  private checkEnd() {
    if (this.save.finished || this.mode !== 'play') return;
    if (this.bricks.remaining <= 0 && this.debris.groundWorth <= 0 && this.save.carried <= 0 && this.npcs.every((n) => n.load <= 0)) {
      this.save.finished = true;
      this.save.objective = OBJECTIVES.length;
      audio.victory();
      document.exitPointerLock?.();
      this.ui.end(this.save.playTime, this.save.trips);
      this.persist();
    }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = h > w ? 82 : 72;
    this.camera.updateProjectionMatrix();
    this.vm.resize(w / h);
    if (this.composer) {
      this.composer.setSize(w, h);
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
    }
  }

  // ------------------------------------------------------------------ loop
  loop(now: number) {
    requestAnimationFrame(this.loop);
    const frameDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    for (let i = 0; i < this.timescale; i++) this.step(this.noRender ? 0.05 : frameDt);
    this.bricks.flush();
    if (this.noRender) return;
    if (this.composer) this.composer.render();
    else {
      this.renderer.autoClear = true;
      this.renderer.render(this.world.scene, this.camera);
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.vm.scene, this.vm.camera);
      this.renderer.autoClear = true;
    }
  }

  private step(dt: number) {
    this.time += dt;
    this.input.update();
    if (this.mode === 'title') {
      const a = this.time * 0.05;
      this.camera.position.set(Math.sin(a) * 30 + 6, 6 + Math.sin(a * 0.7) * 1.5, 46 + Math.cos(a) * 4);
      this.camera.lookAt(-14, 18, -20);
      this.camera.updateMatrixWorld();
    } else {
      if (!this.save.finished) this.save.playTime += dt;
      this.updatePlayer(dt);
      this.useTool(dt);
      this.updateCollect(dt);
      this.updateNpcs(dt);
      this.checkObjective();
      this.checkEnd();
      // pausa si se perdió el puntero (Esc) en PC
      if (!this.input.isTouch) {
        if (this.input.locked) this.wasLocked = true;
        const paused = this.wasLocked && !this.input.locked && !this.ui.shopOpen && !this.ui.modalOpen;
        this.ui.pauseOverlay(paused);
      }
    }
    this.updateBall(dt);
    this.debris.update(dt);
    this.dust.update(dt);
    this.chips.update(dt);
    this.blasts.update(dt);
    this.world.update(this.time);
    this.world.followShadow(this.camera.position.x, this.camera.position.z);
    const hs = Math.hypot(this.vel.x, this.vel.z);
    this.vm.visible = this.mode === 'play';
    this.vm.update(dt, hs, this.lookCache, this.time);
    audio.intensity = 1 - this.bricks.remaining / TOTAL_BRICKS;
    audio.update();

    this.aim = this.mode === 'play' ? this.bricks.raycast(this.camera.position, this.camDir(), this.tool === 'bola' ? 140 : this.tool === 'explosivos' ? 6 : this.st.reach) : null;
    const o = this.objective;
    this.ui.update({
      money: this.save.money,
      standing: this.bricks.remaining,
      ground: this.debris.groundWorth,
      carried: this.save.carried,
      cap: this.st.capacity,
      levels: this.save.levels,
      unlocked: this.save.unlocked,
      tool: this.tool,
      objective: o,
      objProgress: o ? this.objectiveProgress(o) : 0,
      charges: this.charges.length,
      cooldown: this.tool === 'bola' ? Math.max(0, this.ballCd / this.st.ballCooldown) : 0,
      aimHit: !!this.aim,
    }, dt);

    this.saveTimer += dt;
    if (this.saveTimer > 8 && this.mode === 'play') { this.saveTimer = 0; this.persist(); }
  }
}
