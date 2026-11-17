// El Penthouse — núcleo: render, jugador, ordenar, progresión, misterio, actividades y guardado.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';
import { B, MEZZ, SPAWN, STAIRS, LANDING, TERRACE, SECRET, ZONES, ZONE_ORDER, ZoneId, CATEGORIES, UPGRADES, UpgradeId, Levels, emptyLevels, stats, Stats, ITEM_PAY, SHELF_BONUS, ZONE_BONUS, TOKENS_FOR_SECRET } from './config';
import { House, Section } from './house';
import { City } from './city';
import { ItemSystem, Item } from './items';
import { nightEnvironment } from './env';
import { Input } from './input';
import { UI, HeldGroup, fmt, h } from './ui';
import { audio, Mat } from './audio';
import { Bob, Drones, Sparkles, makeBall } from './actors';
import * as A from './activities';

const SAVE_KEY = 'penthouse.save.v1';
const ZONE_PAY: Record<string, number> = { living: 1, bar: 1.6, vestidor: 2.6, juegos: 4 };
const EYE = 1.65;
const R = 0.3;
const SORT_ZONES: ZoneId[] = ['living', 'bar', 'vestidor', 'juegos'];
const NEXT_DOOR: Record<string, string> = { living: 'door-bar', bar: 'gate-stairs', vestidor: 'door-juegos', juegos: 'door-terraza' };

interface Save {
  v: 1; money: number; earned: number; levels: Levels; done: ZoneId[]; tokens: string[]; flags: Record<string, number>;
  items: number[]; held: number[]; player: { x: number; y: number; z: number; yaw: number }; time: number; placed: number; casino: number; dj: number;
}
interface Clue { id: string; pos: THREE.Vector3; mesh: THREE.Object3D; label: string }
type Target =
  | { t: 'sec'; sec: Section; d: number }
  | { t: 'item'; it: Item; d: number }
  | { t: 'station'; id: string; label: string; d: number }
  | { t: 'clue'; c: Clue; d: number }
  | null;

export class Game {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  cam = new THREE.PerspectiveCamera(70, 1, 0.05, 3000);
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  house: House;
  city: City;
  items: ItemSystem;
  input: Input;
  ui = new UI();
  bob: Bob;
  drones: Drones;
  sparkles: Sparkles;
  high: boolean;
  // jugador
  pos = new THREE.Vector3(SPAWN.x, SPAWN.y, SPAWN.z);
  yaw = -Math.PI / 4;
  pitch = -0.05;
  bobT = 0;
  stepT = 0;
  // estado
  money = 0;
  earned = 0;
  levels: Levels = emptyLevels();
  st: Stats = stats(emptyLevels());
  held: Item[] = [];
  active = 0;
  done = new Set<ZoneId>();
  tokens = new Set<string>();
  flags: Record<string, number> = {};
  placed = 0;
  time = 0;
  casino = 0;
  combo = 0;
  comboT = 0;
  zoneCount = new Map<ZoneId, number>();
  zoneTotal = new Map<ZoneId, number>();
  paused = true;
  started = false;
  target: Target = null;
  drinks = new Map<string, number>();
  djMode = 1;
  // misterio
  phone: { lines: [string, string][]; t: number } | null = null;
  powerCut = 0;
  storm = 0;
  clues: Clue[] = [];
  private ghost: THREE.Mesh;
  private viewmodel = new THREE.Group();
  private vmKey = '';
  private vmShake = 0;
  private magnetT = 0;
  private helperT = 0;
  private saveT = 0;
  private storyT = 0;
  private ending = false;
  // básquet
  private basket = false;
  private ball: THREE.Mesh;
  private ballV = new THREE.Vector3();
  private ballLive = 0;
  private charge = -1;
  private hoops = 0;
  private scoredThisThrow = false;
  private secHelper: THREE.LineSegments;
  timeScale = 1;
  noRender = false;
  bot: ((dt: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, opts: { high: boolean }) {
    this.high = opts.high;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.high ? 1.5 : 1.35));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    this.renderer.shadowMap.enabled = this.high;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    if (this.high) RectAreaLightUniformsLib.init();
    const sc = this.scene;
    sc.fog = new THREE.FogExp2(0x1a0f22, 0.0018);
    sc.environment = nightEnvironment(this.renderer);
    sc.environmentIntensity = 1.0;
    sc.add(new THREE.HemisphereLight(0x8a7aff, 0x1a1210, 0.25));
    const moon = new THREE.DirectionalLight(0x9fb4ff, 1.2);
    moon.position.set(-30, 40, -60);
    moon.castShadow = this.high;
    moon.shadow.mapSize.set(2048, 2048);
    Object.assign(moon.shadow.camera, { left: -35, right: 35, top: 35, bottom: -35, near: 1, far: 200 });
    moon.shadow.bias = -0.0005;
    sc.add(moon);
    this.house = new House(sc, this.high, this.high);
    this.city = new City(sc, this.high);
    this.items = new ItemSystem(sc, this.house, this.high);
    this.bob = new Bob(sc);
    this.drones = new Drones(sc);
    this.sparkles = new Sparkles(sc);
    sc.add(this.cam);
    this.cam.add(this.viewmodel);
    this.ball = makeBall();
    this.ball.visible = false;
    sc.add(this.ball);
    this.ghost = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 1.1, 6, 12), new THREE.MeshBasicMaterial({ color: 0x050505 }));
    this.ghost.visible = false;
    sc.add(this.ghost);
    this.secHelper = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0x6ff3ff, transparent: true, opacity: 0.9 }));
    this.secHelper.visible = false;
    sc.add(this.secHelper);
    this.city.onThunder = (s) => { audio.thunder(s * (1 + this.storm)); };
    this.house.setZoneLevel('living', 0.5);
    for (const z of SORT_ZONES) {
      this.zoneTotal.set(z, this.items.items.filter((i) => i.zone === z).length);
      this.zoneCount.set(z, 0);
    }
    // post
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(size.x || 1, size.y || 1, { type: THREE.HalfFloatType, samples: this.high ? 4 : 0 }));
    this.composer.addPass(new RenderPass(sc, this.cam));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.55, 0.6, 0.85);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new ShaderPass({
      uniforms: { tDiffuse: { value: null }, uDanger: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tDiffuse; uniform float uDanger; varying vec2 vUv;
        void main(){ vec4 c = texture2D(tDiffuse, vUv); float v = smoothstep(0.95, 0.3, length(vUv - 0.5));
          c.rgb *= mix(0.55, 1.0, v); c.rgb = mix(c.rgb, c.rgb * vec3(1.15, 0.6, 0.6), uDanger * (1.0 - v)); gl_FragColor = c; }`,
    }));
    this.composer.addPass(new OutputPass());
    this.input = new Input(canvas);
    this.input.onKey = (k) => this.key(k);
    this.input.onWheel = (d) => this.cycle(d);
    this.wireUI();
    addEventListener('resize', () => this.resize());
    this.resize();
    this.load();
    this.refreshHUD();
  }

  // ------------------------------------------------------------------ setup / guardado
  private wireUI() {
    const q = (s: string) => document.querySelector(s) as HTMLElement;
    q('#btn-tablet').onclick = () => this.tablet();
    q('#btn-pause').onclick = () => this.pause();
    q('#held').onclick = (e) => { const el = (e.target as HTMLElement).closest('.hslot') as HTMLElement; if (el) { this.active = +el.dataset.i!; this.refreshHeld(); } };
    if (this.input.isTouch) {
      q('#touch').classList.remove('hidden');
      const act = q('#tb-act');
      act.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.input.setFire(true); });
      act.addEventListener('pointerup', () => this.input.setFire(false));
      act.addEventListener('pointercancel', () => this.input.setFire(false));
      q('#tb-use').onclick = () => this.key('e');
      const run = q('#tb-run');
      run.onclick = () => { this.runToggle = !this.runToggle; run.classList.toggle('on', this.runToggle); };
    }
    this.ui.onSay = (who) => { if (who === 'BOB') { this.bob.talk = 2; audio.bob(); } };
  }
  private runToggle = false;

  resize() {
    const w = innerWidth, hh = innerHeight;
    this.renderer.setSize(w, hh, false);
    this.cam.aspect = w / hh;
    this.cam.fov = w < hh ? 80 : 70;
    this.cam.updateProjectionMatrix();
    const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.composer.setSize(w, hh);
    this.bloom.resolution.set(s.x, s.y);
  }

  private save() {
    if (this.ending) return;
    const s: Save = {
      v: 1, money: this.money, earned: this.earned, levels: this.levels, done: [...this.done], tokens: [...this.tokens], flags: this.flags,
      items: this.items.serialize(), held: this.held.map((i) => i.id), player: { x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw },
      time: this.time, placed: this.placed, casino: this.casino, dj: this.djMode,
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(s)); } catch { /* sin almacenamiento */ }
  }
  static hasSave() { try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; } }
  static wipe() { try { localStorage.removeItem(SAVE_KEY); } catch { /* */ } }
  private load() {
    let s: Save | null = null;
    try { s = JSON.parse(localStorage.getItem(SAVE_KEY) ?? 'null'); } catch { s = null; }
    if (!s || s.v !== 1) return;
    this.money = s.money; this.earned = s.earned; this.levels = { ...emptyLevels(), ...s.levels };
    this.st = stats(this.levels);
    this.done = new Set(s.done); this.tokens = new Set(s.tokens); this.flags = s.flags ?? {};
    this.time = s.time; this.placed = s.placed; this.casino = s.casino ?? 0; this.djMode = s.dj ?? 1;
    this.items.restore(s.items, s.held);
    this.held = s.held.map((id) => this.items.items[id]).filter((it) => it && it.state === 'held');
    for (const it of this.items.items) if (it.state === 'placed') this.zoneCount.set(it.zone, (this.zoneCount.get(it.zone) ?? 0) + 1);
    this.pos.set(s.player.x, s.player.y, s.player.z);
    this.yaw = s.player.yaw;
    for (const z of this.done) { this.house.setZoneLevel(z, 1); const d = NEXT_DOOR[z]; if (d) this.house.openDoor(d); }
    if (this.done.has('juegos')) this.house.setZoneLevel('terraza', 1);
    if (this.flags.secretOpen) { this.house.openDoor('door-secreta'); this.house.setZoneLevel('secreta', 1); }
    for (const d of this.house.doors) if (d.open) { d.t = 1; d.mesh.position.copy(d.base).add(d.slide); d.collider.makeEmpty(); }
    this.drones.setCount(this.st.helpers, this.pos);
    const cz = this.currentZone();
    if (SORT_ZONES.includes(cz)) this.house.setZoneLevel(cz, 0.5);
    this.restoreClues();
    this.storyAfterCut();
  }

  // ------------------------------------------------------------------ arranque
  start() {
    this.started = true;
    this.paused = false;
    audio.start();
    audio.musicVolume = 0.5;
    audio.applyVolumes();
    this.applyDJ();
    if (!this.flags.intro) {
      this.flags.intro = 1;
      this.ui.say('', 'Penthouse de Cristian Rolando · piso 52 · 23:40 · lluvia', 3.5, 'title');
      this.ui.say('BOB', 'Bienvenido, señ... Bienvenido. Soy BOB, el mayordomo de la casa.', 4);
      this.ui.say('BOB', 'El dueño está de viaje. Usted fue contratado para dejar todo en su lugar.', 4.2);
      this.ui.say('BOB', 'Agarre los objetos del piso y llévelos a su estante. Cada cosa tiene un lugar exacto.', 4.6);
      this.ui.say('BOB', 'Cuando termine el living, le abro el bar.', 3.2);
    } else this.ui.say('BOB', 'Bienvenido de vuelta.', 2.5);
  }

  // ------------------------------------------------------------------ entrada
  private key(k: string) {
    if (!this.started) return;
    if (k === 'escape') { if (this.ui.modalOpen) this.ui.closeModal(); else if (this.basket) this.exitBasket(); return; }
    if (this.ui.modalOpen || this.ending) return;
    if (k === 'e' || k === 'f') this.use();
    else if (k === 'q' || k === 'rmb') this.cycle(1);
    else if (k === 't' || k === 'tab') this.tablet();
    else if (k === 'p') this.pause();
    else if (k >= '1' && k <= '9') { const i = +k - 1; if (i < this.groups().length) { this.active = i; this.refreshHeld(); } }
  }
  private cycle(d: number) {
    const n = this.groups().length;
    if (n < 2 || this.ui.modalOpen) return;
    this.active = (this.active + d + n) % n;
    audio.click();
    this.refreshHeld();
  }
  private openModal() {
    if (document.pointerLockElement) document.exitPointerLock();
    this.input.enabled = false;
    this.input.setFire(false);
  }
  private modalClosed() { this.input.enabled = true; }

  pause() {
    if (this.ui.modalOpen) return;
    this.openModal();
    this.paused = true;
    const box = this.ui.modal(`<div class="tab-head"><div><small>PAUSA</small><h2>El Penthouse</h2></div></div>
      <div class="opts">
        <label>Música <input type="range" id="o-mus" min="0" max="1" step="0.05" value="${audio.musicVolume}"></label>
        <label>Efectos <input type="range" id="o-sfx" min="0" max="1" step="0.05" value="${audio.sfxVolume}"></label>
        <label>Sensibilidad <input type="range" id="o-sen" min="0.3" max="2.5" step="0.1" value="${this.input.sensitivity}"></label>
      </div>
      <div class="keys"><span><b>WASD</b> moverse</span><span><b>Shift</b> correr</span><span><b>Clic</b> agarrar / dejar</span><span><b>Q / rueda</b> cambiar objeto</span><span><b>E</b> usar</span><span><b>T</b> tablet</span></div>
      <div class="acts"><button class="primary" id="o-go">Seguir</button><button id="o-reset" class="danger">Borrar partida</button></div>`, 'pause', () => { this.paused = false; this.modalClosed(); audio.resume(); });
    audio.suspend();
    (box.querySelector('#o-mus') as HTMLInputElement).oninput = (e) => { audio.musicVolume = +(e.target as HTMLInputElement).value; audio.applyVolumes(); };
    (box.querySelector('#o-sfx') as HTMLInputElement).oninput = (e) => { audio.sfxVolume = +(e.target as HTMLInputElement).value; audio.applyVolumes(); };
    (box.querySelector('#o-sen') as HTMLInputElement).oninput = (e) => { this.input.sensitivity = +(e.target as HTMLInputElement).value; };
    (box.querySelector('#o-go') as HTMLElement).onclick = () => this.ui.closeModal();
    (box.querySelector('#o-reset') as HTMLElement).onclick = () => { if (confirm('¿Borrar toda la partida?')) { Game.wipe(); this.ending = true; location.reload(); } };
  }

  // ------------------------------------------------------------------ tablet (mejoras, cámaras, pistas)
  tablet(tab: 'mejoras' | 'camaras' = 'mejoras') {
    if (this.ui.modalOpen) return;
    this.openModal();
    const cams = this.cctvList();
    const extra = `<div class="tabs"><button id="tb-cams" ${cams.length ? '' : 'disabled'}>📹 Cámaras (${cams.length})</button>${this.drinkInfo()}</div>`;
    const render = () => {
      const box = this.ui.shop(this.money, this.levels, (id) => { this.buy(id); render(); }, extra);
      (box.querySelector('#tb-cams') as HTMLElement).onclick = () => { this.ui.closeModal(); this.openModal(); this.cctvMenu(); };
    };
    if (tab === 'camaras') this.cctvMenu(); else render();
    this.ui.onClose = () => this.modalClosed();
  }
  private drinkInfo() {
    const a = [...this.drinks].filter(([, t]) => t > 0).map(([id, t]) => `<span class="drink">🍸 ${id} · ${Math.ceil(t)}s</span>`);
    return a.join('');
  }
  private buy(id: UpgradeId) {
    const u = UPGRADES.find((x) => x.id === id)!;
    const l = this.levels[id];
    if (l >= u.max) return;
    const c = u.cost(l);
    if (this.money < c) return;
    this.money -= c;
    this.levels[id]++;
    this.st = stats(this.levels);
    if (id === 'ayudantes') { this.drones.setCount(this.st.helpers, this.pos); if (this.levels.ayudantes === 1) this.ui.say('BOB', 'Drones activados. Ellos ordenan solos, usted relájese.', 3.4); }
    audio.buy();
    this.refreshHUD();
    this.save();
  }

  // ------------------------------------------------------------------ helpers de estado
  private zoneUnlocked(z: ZoneId) {
    if (z === 'living') return true;
    const i = ZONE_ORDER.indexOf(z);
    if (z === 'secreta') return !!this.flags.secretOpen;
    return this.done.has(ZONE_ORDER[i - 1]);
  }
  private currentZone(): ZoneId {
    for (const z of SORT_ZONES) if (!this.done.has(z)) return z;
    return this.flags.secretOpen ? 'secreta' : 'terraza';
  }
  private hereZone(): ZoneId {
    const lvl = this.pos.y > MEZZ - 1 ? 1 : 0;
    for (const z of ZONES) { const [x0, x1, z0, z1] = z.rect; if (z.level === lvl && this.pos.x >= x0 - 0.5 && this.pos.x <= x1 + 0.5 && this.pos.z >= z0 - 0.5 && this.pos.z <= z1 + 0.5) return z.id; }
    if (lvl === 0 && this.pos.z > 0) return this.pos.x < 0 ? 'living' : 'bar';
    return this.currentZone();
  }
  private zoneHUD(z: ZoneId) {
    if (SORT_ZONES.includes(z)) this.ui.setZone(z, this.zoneCount.get(z) ?? 0, this.zoneTotal.get(z) ?? 0);
    else this.ui.setZone(z, this.tokens.size, TOKENS_FOR_SECRET);
  }
  zoneFrac(z: ZoneId) { return (this.zoneCount.get(z) ?? 0) / (this.zoneTotal.get(z) ?? 1); }
  groups(): HeldGroup[] {
    const m = new Map<string, HeldGroup>();
    for (const it of this.held) {
      const key = it.kind + it.variant;
      const g = m.get(key);
      if (g) g.count++; else m.set(key, { key, kind: it.kind, variant: it.variant, count: 1 });
    }
    return [...m.values()];
  }
  get mult() {
    let m = Math.min(this.st.comboMax, 1 + this.combo * this.st.comboStep);
    if ((this.drinks.get('Old Fashioned') ?? 0) > 0) m *= 1.5;
    return m;
  }
  private betLimit() { return Math.max(100, Math.min(25000, Math.round((500 + this.earned * 0.08) / 50) * 50)); }
  private addMoney(n: number) { this.money = Math.max(0, this.money + n); if (n > 0) this.earned += n; this.refreshMoney(); }
  private refreshMoney() { this.ui.setMoney(this.money, this.mult); }
  refreshHUD() {
    this.refreshMoney();
    this.refreshHeld();
    this.ui.setTokens(this.tokens.size);
    const z = this.hereZone();
    this.zoneHUD(z);
  }
  private refreshHeld() {
    const g = this.groups();
    if (this.active >= g.length) this.active = Math.max(0, g.length - 1);
    this.ui.setHeld(g, this.active, this.st.hands, this.held.length);
    this.updateViewmodel();
    this.updateScanner();
  }

  // ------------------------------------------------------------------ objeto en la mano
  private updateViewmodel() {
    const g = this.groups()[this.active];
    const key = this.basket ? 'ball' : g ? g.key + ':' + Math.min(g.count, 4) : '';
    if (key === this.vmKey) return;
    this.vmKey = key;
    this.viewmodel.clear();
    if (this.basket) {
      const b = this.ball.clone();
      b.position.set(0.28, -0.26, -0.55);
      this.viewmodel.add(b);
      return;
    }
    if (!g) return;
    const geo = this.items.geos.get(g.key)!;
    const mat = this.items.displayMats.get(g.key)!;
    geo.computeBoundingSphere();
    const r = geo.boundingSphere!.radius;
    const s = Math.min(1.2, (g.kind === 'prenda' ? 0.13 : 0.065) / r);
    const n = Math.min(g.count, 4);
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const cat = CATEGORIES.find((c) => c.kind === g.kind)!;
    const col = new THREE.Color(cat.variants[g.variant].color);
    for (let i = 0; i < n; i++) {
      const m = new THREE.Matrix4();
      const off = new THREE.Vector3(i * (g.kind === 'libro' ? 0.018 : 0.045) - 0.02, 0, -i * 0.03);
      const rot = g.kind === 'libro' ? new THREE.Euler(0.12, Math.PI / 2 - 0.45 + i * 0.12, 0.04) : new THREE.Euler(0.12, -0.5 + i * 0.25, 0);
      m.compose(off.multiplyScalar(1), new THREE.Quaternion().setFromEuler(rot), new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col);
    }
    mesh.frustumCulled = false;
    const holder = new THREE.Group();
    holder.add(mesh);
    holder.position.set(0.32, g.kind === 'prenda' ? -0.2 : -0.27, -0.62);
    this.viewmodel.add(holder);
  }

  private updateScanner() {
    const g = this.groups()[this.active];
    if (this.st.scanner >= 1 && g) this.items.setHighlight((it) => it.kind === g.kind && it.variant === g.variant);
    else this.items.setHighlight(null);
  }

  // ------------------------------------------------------------------ mirar / apuntar
  private ray() {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.cam.quaternion);
    return new THREE.Ray(this.cam.position.clone(), dir);
  }
  private findTarget(): Target {
    const ray = this.ray();
    const reach = this.st.reach + 0.6;
    let best: Target = null;
    const consider = (t: Target) => { if (t && (!best || t.d < best.d)) best = t; };
    const hit = new THREE.Vector3();
    for (const s of this.house.sections) {
      if (!this.zoneUnlocked(s.zone)) continue;
      if (s.box.containsPoint(ray.origin)) { consider({ t: 'sec', sec: s, d: 0.1 }); continue; }
      if (ray.intersectBox(s.box, hit)) { const d = hit.distanceTo(ray.origin); if (d < reach) consider({ t: 'sec', sec: s, d }); }
    }
    const it = this.items.pick(ray, reach, (z) => this.zoneUnlocked(z));
    if (it) consider({ t: 'item', it, d: it.pos.distanceTo(ray.origin) - 0.3 });
    for (const s of this.stationsAvail()) {
      const d = s.pos.distanceTo(ray.origin);
      if (d < 3.6 && ray.distanceToPoint(s.pos) < 0.7 + d * 0.08) consider({ t: 'station', id: s.id, label: s.label, d: d - 0.5 });
    }
    for (const c of this.clues) {
      const d = c.pos.distanceTo(ray.origin);
      if (d < 3.2 && ray.distanceToPoint(c.pos) < 0.45) consider({ t: 'clue', c, d: d - 1 });
    }
    return best;
  }
  private stationsAvail() {
    const out = this.house.stations.filter((s) => this.zoneUnlocked(s.zone) && !(s.id === 'telefono'));
    if (this.house.doors.find((d) => d.id === 'door-secreta' && !d.open) && this.done.has('living')) out.push({ id: 'puerta', pos: new THREE.Vector3(-5.6, 1.5, B.z1 - 0.2), zone: 'living', label: 'Cuadro' });
    return out;
  }
  private describe(t: Target): [string, '' | 'ok' | 'bad' | 'use'] {
    if (!t) return ['', ''];
    if (t.t === 'sec') {
      const s = t.sec, full = s.filled >= s.slots.length;
      const has = this.held.some((i) => i.kind === s.kind && i.variant === s.variant);
      const wrongKind = !has && this.held.some((i) => i.kind === s.kind);
      const lab = `${s.label} · ${s.filled}/${s.slots.length}`;
      if (full) return [`${s.label} ✓ completo`, ''];
      if (has) return [`Dejar acá · ${lab}`, 'ok'];
      if (wrongKind) return [`No va acá · ${lab}`, 'bad'];
      return [lab, ''];
    }
    if (t.t === 'item') {
      const c = t.it.cat, v = c.variants[t.it.variant];
      const name = c.variants.length > 1 ? `${c.name} · ${v.name}` : c.name;
      return [this.held.length >= this.st.hands ? `Manos llenas (${name})` : name, this.held.length >= this.st.hands ? 'bad' : ''];
    }
    if (t.t === 'station') return [`${this.input.isTouch ? 'USAR' : 'E'} · ${t.label}`, 'use'];
    return [`${this.input.isTouch ? 'USAR' : 'E'} · ${t.c.label}`, 'use'];
  }

  // ------------------------------------------------------------------ acción principal
  private act() {
    const t = this.target;
    if (!t) return;
    if (t.t === 'item') return this.grab(t.it);
    if (t.t === 'sec') return this.placeAt(t.sec);
    this.use();
  }
  private handPos = () => {
    const p = new THREE.Vector3(0.3, -0.3, -0.6);
    return this.cam.localToWorld(p);
  };
  grab(it: Item) {
    const free = this.st.hands - this.held.length;
    if (free <= 0) { this.ui.toast('Tenés las manos llenas · mejorá <b>Manos</b> en la tablet'); audio.wrong(); return; }
    const grabExtra = this.st.grabExtra + ((this.drinks.get('Gin Tonic') ?? 0) > 0 ? 4 : 0);
    const list: Item[] = [it];
    if (grabExtra > 0) {
      const near: Item[] = [];
      this.items.near(it.pos.x, it.pos.z, it.pos.y > 2 ? 1 : 0, this.st.grabRadius, (o) => { if (o !== it && o.kind === it.kind && o.variant === it.variant) near.push(o); });
      near.sort((a, b) => a.pos.distanceTo(it.pos) - b.pos.distanceTo(it.pos));
      list.push(...near.slice(0, grabExtra));
    }
    let k = 0;
    for (const o of list.slice(0, free)) {
      this.items.take(o, this.handPos);
      this.held.push(o);
      k++;
    }
    const key = it.kind + it.variant;
    const gi = this.groups().findIndex((g) => g.key === key);
    if (gi >= 0) this.active = gi;
    audio.pickup(it.cat.material as Mat);
    if (k > 1) this.ui.floatText(`+${k}`, 'grab');
    this.refreshHeld();
    if (!this.flags.firstGrab) { this.flags.firstGrab = 1; this.ui.say('BOB', 'Perfecto. Ahora apunte al estante que corresponde y haga clic para dejarlo.', 3.8); }
  }
  placeAt(sec: Section) {
    const match = this.held.filter((i) => i.kind === sec.kind && i.variant === sec.variant);
    if (!match.length) {
      if (this.held.some((i) => i.kind === sec.kind) || this.held.length) {
        audio.wrong();
        this.combo = 0;
        this.vmShake = 0.4;
        const g = this.groups()[this.active];
        if (g) {
          const target = this.house.sections.find((s) => s.kind === g.kind && s.variant === g.variant)!;
          this.ui.toast(`Eso no va acá · buscá <b>${target.label}</b>`);
        }
        this.refreshMoney();
      }
      return;
    }
    const room = sec.slots.length - sec.filled;
    const go = match.slice(0, room);
    const from = this.handPos();
    go.forEach((it, i) => {
      this.held.splice(this.held.indexOf(it), 1);
      this.items.place(it, sec, from, i * 0.06, () => this.onPlaced(it, sec, false));
    });
    this.refreshHeld();
  }
  private onPlaced(it: Item, sec: Section, helper: boolean) {
    this.placed++;
    this.zoneCount.set(it.zone, (this.zoneCount.get(it.zone) ?? 0) + 1);
    if (!helper) {
      this.combo++;
      this.comboT = 4;
      audio.place(it.cat.material as Mat);
    }
    const pay = ITEM_PAY * (ZONE_PAY[it.zone] ?? 1) * (helper ? 1 : this.mult);
    this.addMoney(pay);
    if (sec.filled >= sec.slots.length && it.slot === sec.slots.length - 1) this.sectionDone(sec);
    if ((this.zoneCount.get(it.zone) ?? 0) >= (this.zoneTotal.get(it.zone) ?? 1) && !this.done.has(it.zone)) this.zoneDone(it.zone);
    const z = this.hereZone();
    this.zoneHUD(z);
  }
  private sectionDone(sec: Section) {
    audio.shelfDone();
    const zc = ZONES.find((z) => z.id === sec.zone)!.neon;
    this.sparkles.burst(sec.box, zc, 160);
    const bonus = Math.round(SHELF_BONUS * (ZONE_PAY[sec.zone] ?? 1));
    this.addMoney(bonus);
    this.ui.banner(sec.label, `Completo · +${fmt(bonus)}`, zc);
  }
  private zoneDone(z: ZoneId) {
    this.done.add(z);
    const idx = SORT_ZONES.indexOf(z);
    const bonus = ZONE_BONUS[idx] ?? 0;
    this.addMoney(bonus);
    audio.zoneDone();
    this.house.setZoneLevel(z, 1);
    const door = NEXT_DOOR[z];
    if (door) setTimeout(() => this.house.openDoor(door), 1800);
    const nz = SORT_ZONES[idx + 1];
    if (nz) this.house.setZoneLevel(nz, 0.5);
    audio.intensity = Math.min(1, (this.done.size) / 4);
    const zz = ZONES.find((x) => x.id === z)!;
    this.ui.banner(`${zz.name} impecable`, `Zona completa · +${fmt(bonus)}`, zz.neon);
    this.ui.flash(zz.neon, 900);
    for (const s of this.house.sections.filter((s) => s.zone === z)) this.sparkles.burst(s.box, zz.neon, 60);
    this.story(`done:${z}`);
    this.save();
  }

  // ------------------------------------------------------------------ usar (E)
  private use() {
    if (this.phone) return this.answer();
    if (this.basket) return this.exitBasket();
    const t = this.target;
    if (!t) return;
    if (t.t === 'clue') return this.readClue(t.c);
    if (t.t !== 'station') return;
    const ctx: A.Ctx = {
      ui: this.ui, money: () => this.money,
      add: (n, cas) => { this.addMoney(n); if (cas) this.casino += n; },
      betLimit: () => this.betLimit(),
      token: (id) => this.giveToken(id), hasToken: (id) => this.tokens.has(id),
      drink: (id, name) => { this.drinks.set(name, 120); void id; this.refreshMoney(); },
      dj: (m) => { this.djMode = m; this.applyDJ(); }, djMode: () => this.djMode,
    };
    const open = (f: (c: A.Ctx) => void) => { this.openModal(); f(ctx); this.ui.onClose = () => { this.modalClosed(); this.refreshHUD(); this.save(); }; };
    switch (t.id) {
      case 'ruleta': return open(A.ruleta);
      case 'blackjack': return open(A.blackjack);
      case 'tragamonedas': return open(A.slots);
      case 'arcade': return open(A.arcade);
      case 'dj': return open(A.dj);
      case 'tragos': return open(A.tragos);
      case 'basquet': return this.enterBasket();
      case 'cajafuerte': return this.safe();
      case 'puerta': return this.secretDoor();
      case 'espejo': return this.mirrorEnding();
    }
  }
  private applyDJ() {
    const bpm = [84, 84, 100, 122][this.djMode];
    (audio as any).bpm = bpm;
    audio.djMode = this.djMode;
    audio.musicVolume = this.djMode === 0 ? 0 : 0.5;
    audio.applyVolumes();
  }
  private giveToken(id: string) {
    if (this.tokens.has(id)) return;
    this.tokens.add(id);
    audio.win(true);
    this.ui.setTokens(this.tokens.size);
    this.ui.banner('Ficha dorada', `${this.tokens.size}/${TOKENS_FOR_SECRET}`, '#ffd23a');
    if (this.tokens.size >= TOKENS_FOR_SECRET) setTimeout(() => this.ui.say('', 'Tres fichas. Detrás del cuadro del living hay una ranura con tres huecos...', 4.5, 'thought'), 1500);
    this.save();
  }

  // ------------------------------------------------------------------ básquet
  private enterBasket() {
    this.basket = true;
    this.vmKey = '';
    this.updateViewmodel();
    this.ui.toast(`Mantené ${this.input.isTouch ? '✋' : 'clic'} para cargar, soltá para tirar · ${this.input.isTouch ? 'USAR' : 'E'} para salir`, 3500);
  }
  private exitBasket() { this.basket = false; this.vmKey = ''; this.ball.visible = false; this.updateViewmodel(); }
  private updateBasket(dt: number) {
    const fire = this.input.fire;
    if (fire && this.charge < 0 && this.ballLive <= 0) this.charge = 0;
    if (this.charge >= 0) {
      this.charge = Math.min(1, this.charge + dt * 0.9);
      this.viewmodel.position.z = this.charge * 0.08;
      this.ui.aim(`Fuerza ${'▮'.repeat(Math.round(this.charge * 10))}${'▯'.repeat(10 - Math.round(this.charge * 10))}`, 'use');
      if (!fire) {
        const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.cam.quaternion);
        this.ball.position.copy(this.handPos());
        this.ballV.copy(dir).multiplyScalar(5 + this.charge * 7).add(new THREE.Vector3(0, 2.2, 0));
        this.ball.visible = true;
        this.ballLive = 3;
        this.charge = -1;
        this.scoredThisThrow = false;
        this.viewmodel.visible = false;
        this.viewmodel.position.z = 0;
      }
    } else if (this.ballLive <= 0) this.ui.aim(`Encestes: ${this.hoops}${this.tokens.has('basquet') ? '' : '/5'}`, 'use');
    if (this.ballLive > 0) {
      this.ballLive -= dt;
      const p = this.ball.position, prevY = p.y;
      this.ballV.y -= 9.8 * dt;
      p.addScaledVector(this.ballV, dt);
      if (p.y < 0.12) { p.y = 0.12; this.ballV.y = Math.abs(this.ballV.y) * 0.62; this.ballV.x *= 0.8; this.ballV.z *= 0.8; if (Math.abs(this.ballV.y) > 0.8) audio.bounce(Math.abs(this.ballV.y)); }
      const bx = TERRACE.x1 - 0.45;
      if (p.x > bx - 0.12 && p.y > 2.85 && p.y < 3.95 && Math.abs(p.z + 6) < 0.9 && this.ballV.x > 0) { p.x = bx - 0.12; this.ballV.x *= -0.6; audio.bounce(3); }
      if (p.x > TERRACE.x1 - 0.1) { p.x = TERRACE.x1 - 0.1; this.ballV.x *= -0.5; }
      const hp = this.house.hoop;
      const hd = Math.hypot(p.x - hp.x, p.z - hp.z);
      if (Math.abs(hd - 0.23) < 0.1 && Math.abs(p.y - hp.y) < 0.1) { this.ballV.x += (p.x - hp.x) * 3; this.ballV.z += (p.z - hp.z) * 3; this.ballV.y *= 0.7; audio.bounce(2); }
      if (!this.scoredThisThrow && prevY > hp.y && p.y <= hp.y && hd < 0.2) {
        this.scoredThisThrow = true;
        this.hoops++;
        audio.swish();
        this.ui.floatText('¡ADENTRO!', 'grab');
        this.addMoney(25);
        if (this.hoops >= 5 && !this.tokens.has('basquet')) this.giveToken('basquet');
      }
      this.ball.rotation.x += dt * 6;
      if (this.ballLive <= 0) { this.ball.visible = false; this.viewmodel.visible = true; }
    }
    if (this.pos.distanceTo(new THREE.Vector3(TERRACE.x1 - 4, 0, -6)) > 7) this.exitBasket();
  }

  // ------------------------------------------------------------------ movimiento y colisiones
  private blocked(x: number, z: number, y: number, fromX: number, fromZ: number): boolean {
    // regiones caminables
    const inB = x > B.x0 + R && x < B.x1 - R && z > B.z0 + R && z < B.z1 - R;
    const inT = x > TERRACE.x0 - 0.5 && x < TERRACE.x1 - R && z > TERRACE.z0 + R && z < TERRACE.z1 - R;
    const inS = x > SECRET.x0 + R && x < SECRET.x1 - R && z > SECRET.z0 - 0.5 && z < SECRET.z1 - R;
    const doorT = x >= B.x1 - R - 0.1 && x <= TERRACE.x0 + 0.6 && z > -8.2 + R && z < -4.8 - R;
    const doorS = z >= B.z1 - R - 0.1 && z <= SECRET.z0 + 0.6 && x > -6.6 + R && x < -4.6 - R;
    if (!(inB || inT || inS || doorT || doorS)) return true;
    if ((inT || doorT) && y > 1) return true;
    for (const c of this.house.colliders) {
      const b = c.box;
      if (b.isEmpty()) continue;
      if (y + 1.75 < b.min.y || y + 0.4 > b.max.y) continue;
      if (x + R > b.min.x && x - R < b.max.x && z + R > b.min.z && z - R < b.max.z) return true;
    }
    // escalera: solo se entra por abajo o por el descanso, y no se pasa por debajo
    const inStrip = (px: number, pz: number) => pz > STAIRS.z0 - R && pz < STAIRS.z1 + R && px < STAIRS.xStart && px > STAIRS.xEnd;
    if (inStrip(x, z)) {
      const ramp = (MEZZ * (STAIRS.xStart - x)) / (STAIRS.xStart - STAIRS.xEnd);
      if (y < ramp - 0.5 && ramp - y < 2.0) return true;
      if (!inStrip(fromX, fromZ) && Math.abs(y - ramp) < 0.6 && fromX < STAIRS.xStart - 0.05 && fromX > STAIRS.xEnd + 0.05) return true;
      if (Math.abs(y - ramp) < 0.6 && (z < STAIRS.z0 + R - 0.05 || z > STAIRS.z1 - R + 0.05) && x > STAIRS.xEnd + 0.1) return true;
    }
    // no caerse nunca (bordes del entrepiso y la escalera)
    const g = this.house.groundAt(x, z, y);
    if (y - g > 0.45) return true;
    void LANDING;
    return false;
  }
  private move(dt: number) {
    const [dx, dy] = this.input.consumeLook();
    this.yaw -= dx * 0.0024;
    this.pitch = Math.max(-1.45, Math.min(1.4, this.pitch - dy * 0.0024));
    const run = this.input.sprint || this.runToggle;
    let sp = run ? this.st.run : this.st.walk;
    if ((this.drinks.get('Negroni') ?? 0) > 0) sp *= 1.4;
    const f = this.input.moveY, s = this.input.moveX;
    const vx = (-Math.sin(this.yaw) * f + Math.cos(this.yaw) * s) * sp * dt;
    const vz = (-Math.cos(this.yaw) * f - Math.sin(this.yaw) * s) * sp * dt;
    const steps = Math.ceil(Math.hypot(vx, vz) / 0.12) || 1;
    for (let i = 0; i < steps; i++) {
      const nx = this.pos.x + vx / steps, nz = this.pos.z + vz / steps;
      if (!this.blocked(nx, nz, this.pos.y, this.pos.x, this.pos.z)) { this.pos.x = nx; this.pos.z = nz; }
      else if (!this.blocked(nx, this.pos.z, this.pos.y, this.pos.x, this.pos.z)) this.pos.x = nx;
      else if (!this.blocked(this.pos.x, nz, this.pos.y, this.pos.x, this.pos.z)) this.pos.z = nz;
      const g = this.house.groundAt(this.pos.x, this.pos.z, this.pos.y);
      this.pos.y += (g - this.pos.y) * Math.min(1, dt * 18 / steps + 0.3);
    }
    const moving = Math.hypot(f, s) > 0.1;
    if (moving) {
      this.bobT += dt * (run ? 11 : 8);
      this.stepT -= dt * (run ? 1.5 : 1);
      if (this.stepT <= 0) { this.stepT = 0.42; audio.footstep(this.pos.x > 0 && this.pos.y < 1); }
    }
    const bob = moving ? Math.sin(this.bobT) * 0.035 : 0;
    this.cam.position.set(this.pos.x, this.pos.y + EYE + bob, this.pos.z);
    this.cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    // balanceo del objeto en la mano
    this.vmShake = Math.max(0, this.vmShake - dt);
    this.viewmodel.position.x = Math.sin(this.vmShake * 40) * this.vmShake * 0.08;
    this.viewmodel.position.y = moving ? Math.abs(Math.cos(this.bobT)) * 0.012 : 0;
  }

  // ------------------------------------------------------------------ automatismos (imán, drones)
  private autos(dt: number) {
    this.magnetT -= dt;
    const mag = Math.max(this.st.magnet, (this.drinks.get('Mojito') ?? 0) > 0 ? Math.max(3, this.st.magnet * 2) : 0);
    if (mag > 0 && this.magnetT <= 0 && this.held.length && this.held.length < this.st.hands) {
      this.magnetT = 0.18;
      const keys = new Set(this.held.map((i) => i.kind + i.variant));
      let n = 0;
      this.items.near(this.pos.x, this.pos.z, this.pos.y > 2 ? 1 : 0, mag, (it) => {
        if (n >= 2 || this.held.length >= this.st.hands || !keys.has(it.kind + it.variant) || !this.zoneUnlocked(it.zone)) return;
        this.items.take(it, this.handPos);
        this.held.push(it);
        n++;
      });
      if (n) { audio.pickup(this.held[this.held.length - 1].cat.material as Mat); this.refreshHeld(); }
    }
    if (this.st.helpers > 0) {
      this.helperT -= dt * this.st.helpers * this.st.helperRate;
      while (this.helperT <= 0) {
        this.helperT += 1;
        const z = this.currentZone();
        if (!SORT_ZONES.includes(z)) break;
        const cand = this.items.items.find((i) => i.zone === z && i.state === 'floor');
        if (!cand) break;
        const sec = this.house.sections.find((s) => s.kind === cand.kind && s.variant === cand.variant && s.filled < s.slots.length);
        if (!sec) break;
        const d = this.drones.list.find((x) => x.busy <= 0) ?? this.drones.list[0];
        if (d) { d.busy = 1.2; d.target.copy(cand.pos).add(new THREE.Vector3(0, 0.6, 0)); setTimeout(() => d.target.copy(sec.box.getCenter(new THREE.Vector3())), 500); }
        this.items.placeFromFloor(cand, sec, () => this.onPlaced(cand, sec, true));
      }
    }
  }

  // ------------------------------------------------------------------ MISTERIO
  private story(ev: string) {
    const once = (id: string) => { if (this.flags[id]) return false; this.flags[id] = 1; return true; };
    const say = (who: string, t: string, d = 3.8, c = '') => this.ui.say(who, t, d, c);
    if (ev === 'tick') {
      const L = this.zoneFrac('living'), Ba = this.zoneFrac('bar'), V = this.zoneFrac('vestidor'), J = this.zoneFrac('juegos');
      if (L > 0.3 && once('call1')) this.call([['', '(estática)'], ['VOZ', 'No subas al segundo piso.'], ['', '(cortan)']]);
      if (L > 0.6 && once('cut1')) this.cut(4);
      if (Ba > 0.35 && once('cut2')) this.cut(5);
      if (Ba > 0.7 && once('call2')) this.call([['', '(respiración)'], ['VOZ', 'Te estoy mirando.'], ['VOZ', 'Siempre te estoy mirando.']]);
      if (V > 0.25 && once('talle')) { say('', 'Qué raro... toda esta ropa es exactamente de mi talle.', 4, 'thought'); setTimeout(() => say('BOB', 'Al señor le queda... digo, al dueño le queda pintada.', 3.6), 4200); }
      if (V > 0.5 && once('pasaporte')) { this.addClue('pasaporte'); say('', 'Hay un pasaporte tirado al lado del espejo.', 3.4, 'thought'); }
      if (V > 0.8 && once('call3')) this.call([['', '(estática)'], ['VOZ', '¿Todavía no te diste cuenta?'], ['', 'La voz... se parece mucho a la tuya.']]);
      if (J > 0.3 && once('cctv1')) { this.cctvNotify(); }
      if (J > 0.6 && once('cut3')) this.cut(7);
      return;
    }
    if (ev === 'done:living') { say('BOB', 'Impecable. Le abro el bar. El casino es con la plata de la casa, juegue tranquilo.', 4.4); }
    if (ev === 'done:bar') { say('BOB', 'Ya puede subir. El vestidor y la galería de zapatillas están arriba.', 4); say('BOB', 'Aunque... alguien le dijo que no subiera, ¿no?', 3.4); }
    if (ev === 'done:vestidor') { say('BOB', 'La sala de juegos está abierta. Era la favorita de usted... del señor Rolando.', 4.2); }
    if (ev === 'done:juegos') {
      this.storm = 1;
      this.house.setZoneLevel('terraza', 1);
      say('BOB', 'La terraza está abierta. Hay una caja fuerte. Nadie sabe el código.', 4);
      setTimeout(() => this.call([['', '(truenos)'], ['VOZ', 'Vos sabés el código.'], ['VOZ', 'Siempre lo supiste.']]), 7000);
    }
  }
  private call(lines: [string, string][]) {
    this.phone = { lines, t: 0 };
    audio.setRinging(true);
    this.ui.toast(`📞 Número desconocido · <b>${this.input.isTouch ? 'USAR' : 'E'}</b> para atender`, 6000);
  }
  private answer() {
    if (!this.phone) return;
    audio.setRinging(false);
    for (const [who, t] of this.phone.lines) this.ui.say(who, t, 3, who === 'VOZ' ? 'voice' : 'thought');
    audio.voice();
    setTimeout(() => audio.voice(), 3000);
    this.phone = null;
    this.ui.toast('', 1);
  }
  private cut(sec: number) {
    this.powerCut = sec;
    audio.powerDown();
    this.ui.flash('#000', 400);
  }

  // pistas físicas
  private clueDefs: Record<string, { pos: THREE.Vector3; label: string; make: () => THREE.Object3D }> = {
    foto: { pos: new THREE.Vector3(8.6, 1.24, 7.4), label: 'Foto', make: () => this.frame(0.32, 0.24) },
    pasaporte: { pos: new THREE.Vector3(-15.4, MEZZ + 0.05, 1.0), label: 'Pasaporte', make: () => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.012, 0.18), new THREE.MeshStandardMaterial({ color: 0x5a0f1c, roughness: 0.6 })); return m; } },
  };
  private frame(w: number, hh: number) {
    const g = new THREE.Group();
    const f = new THREE.Mesh(new THREE.BoxGeometry(w, hh, 0.02), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.6 }));
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.85, hh * 0.85), new THREE.MeshStandardMaterial({ color: 0xffffff, map: new THREE.CanvasTexture(this.photoCanvas()), emissive: 0x332211, roughness: 0.4 }));
    p.position.z = 0.011;
    g.add(f, p);
    g.rotation.x = -1.2;
    return g;
  }
  private addClue(id: string) {
    if (this.clues.find((c) => c.id === id)) return;
    const d = this.clueDefs[id];
    const mesh = d.make();
    mesh.position.copy(d.pos);
    const glow = new THREE.PointLight(0xffd9a0, 1.2, 1.6, 2);
    glow.position.y = 0.3;
    mesh.add(glow);
    this.scene.add(mesh);
    this.clues.push({ id, pos: d.pos.clone(), mesh, label: d.label });
    this.flags['clue_' + id] = 1;
  }
  private restoreClues() { for (const id of Object.keys(this.clueDefs)) if (this.flags['clue_' + id]) this.addClue(id); }
  private photoCanvas(blur = true) {
    const c = document.createElement('canvas');
    c.width = 480; c.height = 360;
    const x = c.getContext('2d')!;
    const g = x.createLinearGradient(0, 0, 0, 360);
    g.addColorStop(0, '#2a1838'); g.addColorStop(1, '#0d0a12');
    x.fillStyle = g; x.fillRect(0, 0, 480, 360);
    for (let i = 0; i < 30; i++) { x.fillStyle = `hsla(${Math.random() * 360},80%,60%,0.5)`; x.beginPath(); x.arc(Math.random() * 480, Math.random() * 120, 3 + Math.random() * 5, 0, 7); x.fill(); }
    const people = [[90, 0.9], [170, 1], [250, 1.08], [330, 0.95], [400, 0.88]];
    people.forEach(([px, s], i) => {
      x.fillStyle = ['#3a2a4a', '#1d1d24', '#c9a45c', '#4a1a22', '#22324a'][i];
      x.beginPath(); x.roundRect(px - 34 * s, 360 - 190 * s, 68 * s, 200 * s, 26 * s); x.fill();
      x.save();
      if (blur) x.filter = 'blur(9px)';
      x.fillStyle = '#d9b49a';
      x.beginPath(); x.arc(px, 360 - 215 * s, 30 * s, 0, 7); x.fill();
      x.restore();
    });
    x.fillStyle = 'rgba(255,255,255,0.85)'; x.font = '600 16px Inter, sans-serif';
    x.fillText('C.R. · 40 · 02/11', 16, 340);
    return c;
  }
  private readClue(c: Clue) {
    this.openModal();
    let html = '';
    if (c.id === 'foto') {
      const url = this.photoCanvas().toDataURL();
      html = `<div class="cas-head"><small>PISTA</small><h2>Foto de cumpleaños</h2></div><img class="photo" src="${url}"><p class="lead">"C.R. · 40". Todos los invitados tienen la cara borrosa. El del medio, el dueño, también. Como si alguien hubiera querido que no se lo reconozca.</p>`;
    } else if (c.id === 'pasaporte') {
      html = `<div class="cas-head"><small>PISTA</small><h2>Pasaporte</h2></div>
        <div class="passport"><div class="pp-photo"></div><div><small>APELLIDO / SURNAME</small><b>ROLANDO</b><small>NOMBRE / NAME</small><b>CRISTIAN</b><small>ESTATURA</small><b>1,78 m</b><small>FECHA DE NAC.</small><b>02 NOV</b></div></div>
        <p class="lead">La foto está rayada. Mide lo mismo que vos. Y el cumpleaños... es hoy.</p>`;
    }
    this.ui.modal(html, 'clue', () => this.modalClosed());
    audio.click();
  }

  // cámaras de seguridad (render real de la escena)
  private cctvList() {
    const out: { id: string; name: string; time: string }[] = [];
    if (this.flags.cctv1) out.push({ id: 'c1', name: 'CAM 03 · LIVING', time: '02/11 03:12' });
    if (this.flags.cctv2) out.push({ id: 'c2', name: 'CAM 07 · ???', time: '02/11 03:40' });
    return out;
  }
  private cctvNotify() {
    this.flags.cctv1 = 1;
    this.ui.toast('📹 Nueva grabación en la <b>tablet</b>', 4500);
    this.ui.say('BOB', 'Se recuperó una grabación de seguridad. Está en su tablet.', 3.4);
    this.bob.glitch = 1;
  }
  private cctvMenu() {
    const list = this.cctvList();
    const box = this.ui.modal(`<div class="tab-head"><div><small>TABLET</small><h2>Cámaras</h2></div></div>
      <div class="cams">${list.map((c) => `<button data-c="${c.id}"><b>${c.name}</b><small>${c.time}</small></button>`).join('')}</div><div id="cview"></div>`, 'tablet', () => this.modalClosed());
    box.querySelectorAll<HTMLButtonElement>('.cams button').forEach((b) => (b.onclick = () => this.cctvShow(b.dataset.c!, box.querySelector('#cview')!)));
  }
  private cctvShow(id: string, el: Element) {
    const shots: Record<string, { cam: [number, number, number, number, number, number]; ghost: [number, number, number]; text: string }> = {
      c1: { cam: [-1.2, 7.5, -11, -10, 0.5, 2], ghost: [-12, 0.85, -1.5], text: 'Alguien entra al living desde el ascensor. Camina directo al cuadro del fondo, sin dudar, como si conociera la casa de memoria.' },
      c2: { cam: [-3, 3.2, 12.6, -6, 0.6, 16], ghost: [-3.6, 0.85, 14.2], text: 'Cámara dentro de la habitación detrás del cuadro. Una persona se para frente al espejo. Lleva la misma ropa que tenés puesta vos.' },
    };
    const s = shots[id];
    const c = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 400);
    c.position.set(s.cam[0], s.cam[1], s.cam[2]);
    c.lookAt(s.cam[3], s.cam[4], s.cam[5]);
    this.ghost.position.set(...s.ghost);
    this.ghost.visible = true;
    this.viewmodel.visible = false;
    const pw = this.house.power;
    this.house.power = Math.max(pw, 0.6);
    const W = 640, H = 360;
    const rt = new THREE.WebGLRenderTarget(W, H);
    this.renderer.setRenderTarget(rt);
    this.renderer.render(this.scene, c);
    const px = new Uint8Array(W * H * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    this.renderer.setRenderTarget(null);
    rt.dispose();
    this.ghost.visible = false;
    this.viewmodel.visible = true;
    this.house.power = pw;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const x = cv.getContext('2d')!;
    const img = x.createImageData(W, H);
    for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
      const i = ((H - 1 - yy) * W + xx) * 4, o = (yy * W + xx) * 4;
      const l = Math.min(255, (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) * 2.2 + Math.random() * 30 + ((yy % 3) === 0 ? -12 : 0));
      img.data[o] = l * 0.75; img.data[o + 1] = l; img.data[o + 2] = l * 0.8; img.data[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    x.fillStyle = '#ff3b3b'; x.beginPath(); x.arc(24, 24, 7, 0, 7); x.fill();
    x.fillStyle = '#e8ffe8'; x.font = '600 18px monospace';
    x.fillText(`REC  ${id === 'c1' ? 'CAM 03' : 'CAM 07'}  02/11  ${id === 'c1' ? '03:12:44' : '03:40:09'}`, 40, 30);
    el.innerHTML = `<img class="cctv" src="${cv.toDataURL()}"><p class="lead">${s.text}</p>`;
    audio.glitch();
  }

  // caja fuerte, puerta secreta y final
  private safe() {
    this.openModal();
    const box = this.ui.modal(`<div class="cas-head"><small>TERRAZA</small><h2>Caja fuerte</h2></div><div class="keypad"><div class="kd" id="kd">----</div>${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, ''].map((k) => `<button ${k === '' ? 'disabled' : ''}>${k}</button>`).join('')}</div><p class="lead" id="kl"></p>`, 'safe', () => this.modalClosed());
    if (this.tokens.has('caja')) { box.querySelector('#kd')!.textContent = 'ABIERTA'; box.querySelector('#kl')!.textContent = 'Ya está vacía.'; return; }
    const code = '0211';
    let i = 0;
    const kd = box.querySelector('#kd')!;
    const step = () => {
      i++;
      kd.textContent = code.slice(0, i) + '-'.repeat(4 - i);
      audio.tick();
      if (i < 4) setTimeout(step, 520);
      else setTimeout(() => {
        kd.textContent = 'ABIERTA';
        kd.classList.add('ok');
        audio.win(true);
        box.querySelector('#kl')!.innerHTML = 'Tus dedos marcaron <b>0-2-1-1</b> solos, sin pensarlo. Adentro hay una ficha dorada y un pendrive con una grabación.';
        this.flags.cctv2 = 1;
        this.giveToken('caja');
        setTimeout(() => this.ui.say('', '0211... 2 de noviembre. El cumpleaños del pasaporte.', 4, 'thought'), 800);
      }, 500);
    };
    setTimeout(step, 700);
  }
  private secretDoor() {
    if (this.tokens.size < TOKENS_FOR_SECRET) {
      this.ui.toast(`Detrás del cuadro hay una ranura con tres huecos · fichas ${this.tokens.size}/${TOKENS_FOR_SECRET}`, 3500);
      if (!this.flags.slotHint) { this.flags.slotHint = 1; this.ui.say('BOB', 'Hay fichas doradas en el arcade, en la terraza y... en algún otro lado.', 4); }
      return;
    }
    this.flags.secretOpen = 1;
    this.house.openDoor('door-secreta');
    this.house.setZoneLevel('secreta', 1);
    audio.powerUp();
    audio.suspense = 1;
    this.ui.say('', 'Las tres fichas entran. El cuadro se desliza.', 3, 'thought');
    this.bob.glitch = 2;
    setTimeout(() => this.ui.say('BOB', 'Señor... por favor, no se asuste.', 3.2), 3000);
    this.save();
  }
  private mirrorEnding() {
    if (this.ending) return;
    this.ending = true;
    this.openModal();
    audio.suspense = 1;
    audio.heartbeat();
    const L: [string, string][] = [
      ['', 'El espejo está empañado. Pasás la mano.'],
      ['', 'Del otro lado está la cara que viste borrosa en todas las fotos.'],
      ['', 'La tuya.'],
      ['BOB', 'Bienvenido de vuelta, señor Rolando.'],
      ['BOB', 'Hace tres semanas tuvo un accidente en esta terraza. Perdió la memoria.'],
      ['BOB', 'Antes, por las dudas, me dejó instrucciones grabadas.'],
      ['VOZ', '"Si me olvido de quién soy, haceme ordenar la casa. Cada cosa en su lugar me va a devolver el mío."'],
      ['BOB', 'Las llamadas eran suyas. La voz también. "No subas al segundo piso" fue idea suya: dijo que nunca hizo caso.'],
      ['', 'Vos sos Cristian Rolando.'],
    ];
    const back = h(`<div class="ending"><div class="end-line" id="el"></div><div class="end-who" id="ew"></div></div>`);
    document.getElementById('ui')!.appendChild(back);
    this.ui.closeModal();
    let i = 0;
    const next = () => {
      if (i >= L.length) return this.credits(back);
      const [who, t] = L[i++];
      (back.querySelector('#ew') as HTMLElement).textContent = who;
      const el = back.querySelector('#el') as HTMLElement;
      el.classList.remove('on'); void el.offsetWidth;
      el.textContent = t;
      el.classList.add('on');
      el.classList.toggle('big', i === L.length);
      if (who === 'BOB') audio.bob(4); else if (who === 'VOZ') audio.voice(); else audio.heartbeat();
      setTimeout(next, i === L.length ? 4500 : 3600 + t.length * 25);
    };
    setTimeout(next, 600);
  }
  private credits(back: HTMLElement) {
    audio.suspense = 0;
    audio.intensity = 1;
    const mm = Math.floor(this.time / 60);
    back.innerHTML = `<div class="credits"><small>FIN</small><h1>EL PENTHOUSE</h1>
      <div class="cstats"><div><b>${this.placed.toLocaleString('es-AR')}</b><span>objetos en su lugar</span></div><div><b>${Math.floor(mm / 60)}h ${mm % 60}m</b><span>tiempo</span></div><div><b>${fmt(this.earned)}</b><span>ganados</span></div><div><b>${fmt(this.casino)}</b><span>balance del casino</span></div></div>
      <p>Gracias por ordenar la casa de Cristian Rolando.<br>O la tuya.</p>
      <button class="primary" id="cont">Seguir en el penthouse</button></div>`;
    (back.querySelector('#cont') as HTMLElement).onclick = () => { back.remove(); this.ending = false; this.flags.finished = 1; this.modalClosed(); this.save(); };
  }

  // ------------------------------------------------------------------ loop
  update(dtReal: number) {
    const dt = Math.min(0.05, dtReal) * this.timeScale;
    if (!this.started || this.paused) { if (!this.noRender) this.composer.render(); return; }
    this.time += dt;
    this.input.update();
    const blockedInput = this.ui.modalOpen || this.ending;
    if (this.bot) this.bot(dt);
    else if (!blockedInput) this.move(dt);
    else this.input.consumeLook();
    if (this.bot) { this.cam.position.set(this.pos.x, this.pos.y + EYE, this.pos.z); this.cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ'); }
    this.cam.updateMatrixWorld();
    // apuntar
    if (!blockedInput && !this.basket) {
      this.target = this.findTarget();
      const [txt, k] = this.describe(this.target);
      this.ui.aim(txt, k);
      if (this.input.firePressed) this.act();
      const useBtn = document.getElementById('tb-use');
      if (useBtn) useBtn.classList.toggle('hidden', !(this.phone || (this.target && (this.target.t === 'station' || this.target.t === 'clue'))));
      // escáner nivel 2: marca el estante del objeto activo
      const g = this.groups()[this.active];
      if (this.st.scanner >= 2 && g) {
        const s = this.house.sections.find((x) => x.kind === g.kind && x.variant === g.variant)!;
        const c = s.box.getCenter(new THREE.Vector3()), sz = s.box.getSize(new THREE.Vector3());
        this.secHelper.position.copy(c);
        this.secHelper.scale.copy(sz).addScalar(0.05);
        (this.secHelper.material as THREE.LineBasicMaterial).opacity = 0.5 + 0.4 * Math.sin(this.time * 6);
        this.secHelper.visible = true;
      } else this.secHelper.visible = false;
    } else if (this.basket && !blockedInput) this.updateBasket(dt);
    // combo
    if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) { this.combo = 0; this.refreshMoney(); } }
    for (const [k, t] of this.drinks) { if (t > 0) this.drinks.set(k, t - dt); }
    this.autos(dt);
    // misterio
    this.storyT -= dt;
    if (this.storyT <= 0) {
      this.storyT = 1;
      this.story('tick');
      const z = this.hereZone();
      this.zoneHUD(z);
    }
    if (this.powerCut > 0) {
      this.powerCut -= dt;
      this.house.power = 0.04 + (Math.random() < 0.02 ? 0.4 : 0);
      this.ui.setDanger(0.5);
      audio.suspense = 1;
      if (Math.random() < dt * 0.6) audio.heartbeat();
      if (this.powerCut <= 0) {
        this.house.power = 1;
        this.ui.setDanger(0);
        audio.suspense = this.flags.secretOpen ? 1 : 0;
        audio.powerUp();
        this.storyAfterCut();
      }
    }
    if (this.storm > 0 && Math.random() < dt * 0.04) (this.city as any).nextBolt = 0;
    // mundo
    this.house.update(dt, this.time);
    this.items.update(dt, this.time);
    this.city.update(dt, this.time, this.cam.position, (x, z) => x > B.x0 && x < B.x1 && z > B.z0 && z < B.z1);
    this.bob.update(dt, this.pos, this.yaw, this.pos.y + EYE);
    this.drones.update(dt, this.time, this.pos);
    this.sparkles.update(dt);
    audio.outside = this.pos.x > B.x1 ? 1 : 0;
    audio.update();
    this.ui.update(dt);
    this.saveT -= dt;
    if (this.saveT <= 0) { this.saveT = 10; this.save(); }
    if (!this.noRender) this.composer.render();
  }
  private storyAfterCut() {
    // la acción que corresponde al corte que terminó
    const order: [string, () => void][] = [
      ['cut1', () => this.ui.say('BOB', 'Disculpe. Un corte de luz. Pasa seguido con tormenta... creo.', 3.6)],
      ['cut2', () => { this.addClue('foto'); this.ui.say('', 'Cuando volvió la luz, había una foto sobre la barra. Antes no estaba.', 4, 'thought'); }],
      ['cut3', () => { const d = this.house.doors.find((x) => x.id === 'door-secreta')!; if (!d.open) { d.t = 0.08; d.mesh.position.copy(d.base).addScaledVector(d.slide, 0.08); } this.house.setZoneLevel('secreta', 0.6); this.ui.say('', 'El cuadro del living quedó corrido. Sale luz roja de atrás.', 4, 'thought'); this.bob.glitch = 3; audio.glitch(); setTimeout(() => this.ui.say('BOB', 'Señor, no hay... ERROR... no tengo registro de visitas esta noche.', 4), 2500); }],
    ];
    for (const [id, f] of order) if (this.flags[id] === 1) { this.flags[id] = 2; f(); }
  }
}
