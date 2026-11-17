import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import {
  TOTAL_KG, TOTAL_ITEMS, UPGRADES, UpgradeId, stats, Stats, OBJECTIVES, NATURE, plantDock, DOCK_RADIUS,
  riverCenter, TRASH_TYPES, VehicleId, Objective, LIFT_TIME,
} from './config';
import { World, makeQuality, Quality } from './world';
import { TrashSystem, Piece } from './trash';
import { Particles, Fish, Birds, clampToRiver } from './effects';
import { makeVehicle, BoatModel, makeDrone, DroneModel } from './models';
import { Input } from './input';
import { UI, TRASH_ICON } from './ui';
import { audio } from './audio';
import { t, fmt, setLang } from './i18n';
import { SaveData, loadSave, newSave, writeSave, clearSave, loadSettings, writeSettings, Settings, encodeIds, decodeIds } from './save';

interface Boat {
  model: BoatModel;
  pos: THREE.Vector3;
  vel: THREE.Vector2;
  heading: number;
  turnRate: number;
  load: number;
  value: number; // kg ponderados por material (lo que se cobra)
  state?: 'seek' | 'return';
  target?: Piece | null;
  retarget?: number;
  pickCd: number; // espera hasta poder subir el próximo objeto
  lift: number; // segundos de izado restantes (bote quieto)
}

interface Drone {
  model: DroneModel;
  pos: THREE.Vector3;
  load: number;
  value: number;
  state: 'seek' | 'return';
  target: Piece | null;
  retarget: number;
  phase: number;
}

const VEHICLE_ICON: Record<VehicleId, string> = { remo: '🛶', lancha: '🚤', barcaza: '🛳️' };
const tmpV = new THREE.Vector3();

export class Game {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer | null = null;
  camera: THREE.PerspectiveCamera;
  world: World;
  trash: TrashSystem;
  particles: Particles;
  fish: Fish;
  birds: Birds;
  input: Input;
  ui: UI;
  save: SaveData;
  settings: Settings;
  q: Quality;
  st!: Stats;
  player: Boat;
  helpers: Boat[] = [];
  drones: Drone[] = [];
  mode: 'title' | 'play' = 'title';
  autopilot = false;
  time = 0;
  private last = performance.now();
  private saveTimer = 0;
  private hintAt = 0;
  private fullWarned = false;
  private pulled = new Set<Piece>();
  private camPos = new THREE.Vector3(0, 40, 60);
  private camLook = new THREE.Vector3();
  private shake = 0;
  private endShownAt = -1;
  private modalOpen = false;
  private noRender = new URLSearchParams(location.search).has('norender');
  private timescale = Math.max(1, Math.min(60, +(new URLSearchParams(location.search).get('timescale') ?? 1)));

  constructor(canvas: HTMLCanvasElement) {
    this.settings = loadSettings();
    if (this.settings.lang) setLang(this.settings.lang);
    const isMobile = matchMedia('(pointer: coarse)').matches;
    const qp = new URLSearchParams(location.search).get('quality');
    this.q = makeQuality(qp !== null ? (+qp as 0 | 1 | 2) : this.settings.quality ?? (isMobile ? 1 : 2));

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !this.q.post && this.q.level > 0, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.q.level === 2 ? 2 : this.q.level === 1 ? 1.5 : 1));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.62;
    this.renderer.shadowMap.enabled = this.q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1600);
    this.camera.layers.enable(1);
    this.world = new World(this.renderer, this.q);
    const scene = this.world.scene;

    // estado / guardado
    const params = new URLSearchParams(location.search);
    this.save = loadSave() ?? newSave();
    this.trash = new TrashSystem(scene, this.q.high, decodeIds(this.save.collected));
    this.applyDebugParams(params);
    this.st = stats(this.save.levels, this.save.vehicle);

    this.particles = new Particles(scene, this.q.high ? 1600 : 900);
    this.fish = new Fish(scene);
    this.fish.onSplash = (x, z, s) => {
      this.particles.splash(x, z, s);
      if (tmpV.set(x, 0, z).distanceTo(this.player.pos) < 35) audio.fishJump(this.panOf(x));
    };
    this.birds = new Birds(scene);

    const dock = plantDock();
    this.player = {
      model: this.makePlayerModel(this.save.vehicle),
      pos: new THREE.Vector3(this.save.boat.x || dock.x, 0, this.save.boat.z || dock.z + 10),
      vel: new THREE.Vector2(),
      heading: this.save.boat.h ?? Math.PI / 2,
      turnRate: 0,
      load: this.save.boat.load ?? 0,
      value: this.save.boat.value ?? 0,
      pickCd: 0,
      lift: 0,
    };
    clampToRiver(this.player.pos, 2.5);
    audio.vehicle = this.save.vehicle;
    this.syncFleet();

    this.input = new Input(canvas);
    this.input.onKey = (k) => {
      if (this.mode !== 'play') return;
      if (k === 'e' || k === 'tab') this.ui.toggleShop();
      if (k === 'r') this.startReturn();
      if (k === 'escape' && this.ui.shopOpen) this.ui.toggleShop(false);
    };

    this.ui = new UI({
      buy: (id) => this.buy(id),
      returnToPlant: () => this.startReturn(),
      click: () => audio.click(),
      settingsChanged: (s) => {
        this.settings = s;
        audio.musicVolume = s.music;
        audio.sfxVolume = s.sfx;
        audio.applyVolumes();
        writeSettings(s);
      },
      reset: () => {
        clearSave();
        location.reload();
      },
      shopToggled: (open) => {
        this.input.enabled = !open || window.innerWidth > 640;
      },
      riverInfo: () =>
        TRASH_TYPES.map((tt) => ({ id: tt.id, left: this.trash.remainingByType.get(tt.id) ?? 0, total: tt.count, kg: tt.kg })),
    });
    this.ui.settings = this.settings;
    audio.musicVolume = this.settings.music;
    audio.sfxVolume = this.settings.sfx;
    this.ui.setHudVisible(false);

    this.setupPost();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.persist();
        audio.suspend();
      } else {
        audio.resume();
        this.last = performance.now();
      }
    });
    window.addEventListener('pagehide', () => this.persist());

    const hasSave = loadSave() !== null;
    this.ui.showTitle(hasSave, this.input.isTouch, () => this.startPlay(), () => {
      clearSave();
      location.reload();
    });

    if (params.has('autoplay')) {
      (this.ui as any).closeTitle?.();
      this.startPlay();
    }
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ depuración / capturas
  private applyDebugParams(params: URLSearchParams) {
    if (params.has('clean')) {
      const target = Math.min(1, +params.get('clean')!);
      // sacar objetos (primero los livianos, como en una partida real) hasta llegar a la fracción pedida
      const pieces: Piece[] = [];
      for (const tt of TRASH_TYPES) this.trash.forEachNear(0, 0, 999, (p) => p.type === tt && pieces.push(p));
      pieces.sort((a, b) => a.type.tier - b.type.tier || Math.random() - 0.5);
      const items = Math.round(TOTAL_ITEMS * target);
      for (let i = 0; i < items && i < pieces.length; i++) {
        const p = pieces[i];
        this.save.itemsTotal++;
        this.save.kgTotal += p.type.kg;
        this.save.byType[p.type.id] = (this.save.byType[p.type.id] ?? 0) + 1;
        this.trash.collect(p, p.x, -5, p.z);
      }
    }
    if (params.has('money')) this.save.money = +params.get('money')!;
    if (params.has('levels')) {
      const lv = +params.get('levels')!;
      for (const u of UPGRADES) {
        if (!this.save.unlocked.includes(u.id)) this.save.unlocked.push(u.id);
        this.save.levels[u.id] = Math.min(u.max, lv);
      }
    }
    if (params.has('vehicle')) this.save.vehicle = params.get('vehicle') as VehicleId;
    if (params.has('obj')) this.save.objective = +params.get('obj')!;
  }

  private setupPost() {
    if (!this.q.post) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.world.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.5, 0.92));
    this.composer.addPass(new OutputPass());
  }

  // ------------------------------------------------------------------ flujo
  private startPlay() {
    audio.start();
    audio.setCleanliness(this.visualClean);
    this.mode = 'play';
    this.ui.setHudVisible(true);
    this.ui.showHint(this.input.isTouch ? t().controlsMobile : t().controlsDesktop, 5000);
  }

  /** Limpieza "visual": mezcla cantidad de objetos y kilos (la basura liviana es la que más se ve). */
  get visualClean() {
    return 0.55 * (1 - this.trash.remainingItems / TOTAL_ITEMS) + 0.45 * (1 - this.trash.remainingKg / TOTAL_KG);
  }

  private makePlayerModel(kind: VehicleId) {
    const m = makeVehicle(kind, '#ffffff', '#ff7b39', 1);
    this.world.scene.add(m.group);
    return m;
  }

  private setVehicle(kind: VehicleId) {
    this.world.scene.remove(this.player.model.group);
    this.player.model = this.makePlayerModel(kind);
    this.save.vehicle = kind;
    audio.vehicle = kind;
    this.st = stats(this.save.levels, kind);
    this.particles.splash(this.player.pos.x, this.player.pos.z, 2.5);
  }

  private syncFleet() {
    const scene = this.world.scene;
    const dock = plantDock();
    while (this.helpers.length < this.st.helpers) {
      const m = makeVehicle('lancha', '#e7f6ff', '#2f80ed', 0.78);
      m.netGroup.visible = true;
      scene.add(m.group);
      this.helpers.push({
        model: m,
        pos: new THREE.Vector3(dock.x + (Math.random() - 0.5) * 6, 0, dock.z + 4),
        vel: new THREE.Vector2(), heading: Math.PI / 2, turnRate: 0, load: 0, value: 0,
        state: 'seek', target: null, retarget: 0, pickCd: 0, lift: 0,
      });
      if (this.mode === 'play') this.particles.splash(dock.x, dock.z + 4, 1.5);
    }
    while (this.drones.length < this.st.drones) {
      const m = makeDrone();
      scene.add(m.group);
      this.drones.push({
        model: m, pos: new THREE.Vector3(dock.x, 6, dock.z - 6), load: 0, value: 0,
        state: 'seek', target: null, retarget: 0, phase: Math.random() * 10,
      });
    }
  }

  private buy(id: UpgradeId) {
    const u = UPGRADES.find((x) => x.id === id)!;
    const lv = this.save.levels[id];
    const cost = u.cost(lv);
    if (!this.save.unlocked.includes(id) || lv >= u.max || cost > this.save.money) {
      audio.denied();
      return;
    }
    this.save.money -= cost;
    this.save.levels[id]++;
    this.st = stats(this.save.levels, this.save.vehicle);
    audio.buy();
    if (id === 'flota' || id === 'drones') this.syncFleet();
    if (id === 'grua') this.ui.toast(`🏗️ ${t().up.grua[0]} ${this.save.levels.grua}`, t().craneTiers[this.save.levels.grua]);
    this.persist();
  }

  private startReturn() {
    if (this.player.load <= 0) return;
    this.autopilot = true;
  }

  private persist() {
    this.save.boat = { x: this.player.pos.x, z: this.player.pos.z, h: this.player.heading, load: this.player.load, value: this.player.value };
    this.save.collected = encodeIds(this.trash.collectedIds(), this.trash.totalIds);
    writeSave(this.save);
  }

  // ------------------------------------------------------------------ objetivos
  get objective(): Objective | null {
    return OBJECTIVES[this.save.objective] ?? null;
  }

  objectiveProgress(o: Objective): number {
    switch (o.kind) {
      case 'items': return this.save.itemsTotal;
      case 'kg': return this.save.kgTotal;
      case 'type': return this.save.byType[o.type!] ?? 0;
      case 'all': return TOTAL_KG - this.trash.remainingKg;
    }
  }

  private checkObjective() {
    const o = this.objective;
    if (!o || this.modalOpen || o.kind === 'all') return;
    if (this.objectiveProgress(o) < o.target) return;
    this.save.objective++;
    const r = o.reward;
    this.save.money += r.money;
    const s = t();
    let icon = '🎉', name = '', desc = '', kind: 'tool' | 'vehicle' = 'tool';
    if (r.unlock) {
      if (!this.save.unlocked.includes(r.unlock)) this.save.unlocked.push(r.unlock);
      this.save.levels[r.unlock] = Math.max(this.save.levels[r.unlock], r.level ?? 1);
      icon = UPGRADES.find((u) => u.id === r.unlock)!.icon;
      [name, desc] = s.up[r.unlock];
      this.st = stats(this.save.levels, this.save.vehicle);
      this.syncFleet();
    }
    if (r.gift) {
      const u = UPGRADES.find((x) => x.id === r.gift)!;
      this.save.levels[r.gift] = Math.min(u.max, this.save.levels[r.gift] + (r.giftLevels ?? 1));
      this.st = stats(this.save.levels, this.save.vehicle);
      icon = '🎁';
      name = s.gifts[r.gift] ?? `${s.up[r.gift][0]} +${r.giftLevels ?? 1}`;
      desc = `${s.up[r.gift][0]} +${r.giftLevels ?? 1} ${s.level.toLowerCase()}`;
    }
    if (r.crane) {
      if (!this.save.unlocked.includes('grua')) this.save.unlocked.push('grua');
      this.save.levels.grua = Math.max(this.save.levels.grua, r.crane);
      this.st = stats(this.save.levels, this.save.vehicle);
      if (!name) {
        icon = '🏗️';
        name = `${s.up.grua[0]}: ${s.craneTiers[r.crane]}`;
        desc = s.up.grua[1];
      } else {
        desc += ` · 🏗️ ${s.craneTiers[r.crane]}`;
      }
    }
    if (r.vehicle) {
      this.setVehicle(r.vehicle);
      icon = VEHICLE_ICON[r.vehicle];
      const craneTxt = r.crane ? ` · 🏗️ ${s.craneTiers[r.crane]}` : '';
      [name, desc] = s.vehicles[r.vehicle];
      desc += craneTxt;
      kind = 'vehicle';
    }
    audio.unlock();
    this.persist();
    if (name) {
      this.modalOpen = true;
      this.ui.unlockCard(icon, kind, name, desc + (r.money ? ` · +$ ${fmt(r.money)}` : ''), () => {
        this.modalOpen = false;
      });
    } else {
      this.ui.toast(`🎯 ${this.ui.objectiveText(o)}`, `+$ ${fmt(r.money)}`);
    }
  }

  // ------------------------------------------------------------------ utilidades
  private panOf(x: number) {
    return Math.max(-1, Math.min(1, (x - this.player.pos.x) / 30));
  }

  private screenOf(x: number, y: number, z: number) {
    tmpV.set(x, y, z).project(this.camera);
    return { x: (tmpV.x * 0.5 + 0.5) * window.innerWidth, y: (-tmpV.y * 0.5 + 0.5) * window.innerHeight, vis: tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1 };
  }

  /** Punto de navegación siguiendo el cauce (evita cortar por tierra en las curvas). */
  private navTarget(from: THREE.Vector3, tx: number, tz: number) {
    const dx = tx - from.x;
    if (Math.abs(dx) < 18) return { x: tx, z: tz };
    const nx = from.x + Math.sign(dx) * 16;
    return { x: nx, z: riverCenter(nx) * 0.7 + tz * 0.3 };
  }

  private steer(b: Boat, dirX: number, dirZ: number, maxSpeed: number, throttle: number, dt: number, margin = 2.4) {
    const accel = 2.6;
    const tx = dirX * maxSpeed * throttle, tz = dirZ * maxSpeed * throttle;
    b.vel.x += (tx - b.vel.x) * Math.min(1, dt * accel);
    b.vel.y += (tz - b.vel.y) * Math.min(1, dt * accel);
    b.pos.x += b.vel.x * dt;
    b.pos.z += b.vel.y * dt;
    clampToRiver(b.pos, margin);
    const sp = b.vel.length();
    if (sp > 0.3) {
      const target = Math.atan2(b.vel.x, b.vel.y);
      let d = target - b.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const turn = d * Math.min(1, dt * 5);
      b.heading = Math.atan2(Math.sin(b.heading + turn), Math.cos(b.heading + turn));
      b.turnRate += (turn / Math.max(dt, 1e-3) - b.turnRate) * Math.min(1, dt * 6);
    } else b.turnRate *= 1 - Math.min(1, dt * 4);
  }

  private placeModel(b: Boat, maxSpeed: number) {
    const g = b.model.group;
    const sp = b.vel.length() / Math.max(1, maxSpeed);
    const big = b.model.kind === 'barcaza' ? 0.4 : 1;
    const wave = (Math.sin(this.time * 1.7 + b.pos.x * 0.2) * 0.08 + Math.sin(this.time * 2.3 + b.pos.z * 0.3) * 0.05) * big;
    g.position.set(b.pos.x, wave, b.pos.z);
    g.rotation.set(
      (-sp * 0.08 + Math.sin(this.time * 1.4 + b.pos.z) * 0.03) * big,
      b.heading,
      (-b.turnRate * 0.12 + Math.sin(this.time * 1.9 + b.pos.x) * 0.035) * big,
      'YXZ',
    );
    b.model.flag.rotation.y = Math.PI / 2 + Math.sin(this.time * 7) * 0.3;
    if (b.model.oars) {
      const ph = this.time * (2 + sp * 5);
      b.model.oars.children.forEach((pv, i) => {
        const s = i === 0 ? -1 : 1;
        pv.rotation.y = s * Math.sin(ph) * 0.7 * Math.min(1, sp * 3 + 0.15);
        pv.rotation.z = s * (0.15 + 0.2 * Math.cos(ph)) * Math.min(1, sp * 3 + 0.15);
      });
    }
  }

  /** Zona de recolección: cubre el frente y el casco (pasar por encima de la basura también la junta). */
  private pickZone(b: Boat, radius: number) {
    const off = b.model.length * 0.33 * b.model.group.scale.x;
    return { x: b.pos.x + Math.sin(b.heading) * off, z: b.pos.z + Math.cos(b.heading) * off, r: radius + off };
  }

  /** Solo la grúa limita qué se puede levantar (la bodega puede pasarse con la última pieza). */
  private canTake(p: Piece, tier: number, _cap?: number) {
    return p.type.tier <= tier;
  }

  // ------------------------------------------------------------------ jugador
  private updatePlayer(dt: number) {
    const p = this.player;
    const st = this.st;
    const dock = plantDock();
    let dx = 0, dz = 0, throttle = 0;

    p.pickCd -= dt;
    if (p.lift > 0) {
      // izando con la grúa: el bote queda anclado
      p.lift -= dt;
    } else if (this.mode === 'play' && this.input.active) {
      this.autopilot = false;
      dx = this.input.x;
      dz = -this.input.y;
      throttle = Math.min(1, Math.hypot(dx, dz));
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
    } else if (this.autopilot) {
      const nt = this.navTarget(p.pos, dock.x, dock.z);
      dx = nt.x - p.pos.x;
      dz = nt.z - p.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      throttle = Math.min(1, l / 4 + 0.3);
    }
    const margin = this.save.vehicle === 'barcaza' ? 5 : 2.4;
    this.steer(p, dx, dz, st.speed, throttle, dt, margin);
    this.placeModel(p, st.speed);
    const speedNorm = p.vel.length() / st.speed;
    audio.setEngine(throttle, speedNorm);

    if (speedNorm > 0.15 && Math.random() < speedNorm * 1.3) {
      const back = p.model.length * 0.5 * p.model.group.scale.x;
      const bx = p.pos.x - Math.sin(p.heading) * back, bz = p.pos.z - Math.cos(p.heading) * back;
      const side = Math.random() < 0.5 ? -1 : 1;
      const px = Math.cos(p.heading) * side, pz = -Math.sin(p.heading) * side;
      this.particles.foam(bx + px * 0.8, bz + pz * 0.8, px * 1.5 - p.vel.x * 0.1, pz * 1.5 - p.vel.y * 0.1);
    }

    const lf = Math.min(1, p.load / st.capacity);
    p.model.load.scale.y = 0.0001 + lf * 0.75;
    p.model.load.visible = lf > 0.01;
    p.model.crane.visible = st.tier >= 1;
    p.model.netGroup.visible = this.save.levels.red > 0;
    p.model.netGroup.scale.set((0.8 + st.radius / 6) * (p.model.kind === 'barcaza' ? 1.6 : 1), 1, 1);
    const fieldR = Math.max(st.magnetRadius, st.suctionRadius);
    p.model.field.visible = fieldR > 0 && this.mode === 'play';
    if (fieldR > 0) {
      const sc = fieldR / p.model.group.scale.x;
      p.model.field.scale.setScalar(sc * (1 + 0.03 * Math.sin(this.time * 4)));
      (p.model.field.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.08 * Math.sin(this.time * 3);
    }

    if (this.mode !== 'play') return;
    const full = p.load >= st.capacity;

    // imán / aspiradora: atraen objetos (se ven moverse; nada desaparece)
    for (const piece of this.pulled) {
      if (!this.trash.isAlive(piece)) this.pulled.delete(piece);
    }
    if (fieldR > 0 && !full) {
      this.trash.forEachNear(p.pos.x, p.pos.z, fieldR, (piece, d) => {
        if (piece.pulled || piece.claimed || this.pulled.size > 40) return;
        const ok = (piece.type.magnetic && d < st.magnetRadius) || (piece.type.suckable && d < st.suctionRadius);
        if (!ok || !this.canTake(piece, st.tier, st.capacity)) return;
        piece.pulled = true;
        this.pulled.add(piece);
        audio.pull(piece.type.magnetic && !piece.type.suckable);
      });
    }
    for (const piece of this.pulled) {
      if (full || piece.claimed) {
        piece.pulled = false;
        this.pulled.delete(piece);
        continue;
      }
      const ddx = p.pos.x - piece.x, ddz = p.pos.z - piece.z;
      const d = Math.hypot(ddx, ddz) || 1;
      if (d > fieldR + 4) {
        piece.pulled = false;
        this.pulled.delete(piece);
        continue;
      }
      const sp = (st.pullSpeed / (1 + piece.type.tier * 0.35)) * dt * (1 + (fieldR - d) / fieldR);
      this.trash.move(piece, piece.x + (ddx / d) * Math.min(sp, d), piece.z + (ddz / d) * Math.min(sp, d));
    }

    // recolección
    const pz = this.pickZone(p, st.radius);
    let best: Piece | null = null;
    this.trash.forEachNear(pz.x, pz.z, pz.r, (piece) => {
      if (piece.type.tier > st.tier) {
        this.lockHint(piece, `🔒 ${t().needCrane}: ${t().craneTiers[piece.type.tier]}`);
        return;
      }
      // la grúa prioriza lo más pesado que esté al alcance
      if (!best || piece.type.tier > best.type.tier) best = piece;
    });
    if (best && p.load < st.capacity && p.pickCd <= 0 && p.lift <= 0) {
      this.take(p, best, true);
      p.pickCd = 1 / st.pickRate;
    }

    if (full && !this.fullWarned) {
      this.fullWarned = true;
      audio.full();
      this.ui.showHint(t().full, 3500);
    }
    if (!full) this.fullWarned = false;

    if (p.load > 0 && Math.hypot(p.pos.x - dock.x, p.pos.z - dock.z) < DOCK_RADIUS + (this.save.vehicle === 'barcaza' ? 4 : 0)) {
      const money = p.value * st.pricePerKg;
      this.save.money += money;
      this.save.trips++;
      audio.deposit(Math.min(1, p.load / st.capacity));
      const sc = this.screenOf(dock.x, 3, dock.z);
      this.ui.floatText(sc.x, sc.y - 30, `+$ ${fmt(money)}`, 'money');
      this.ui.coinsTo(sc.x, sc.y, Math.min(16, 4 + Math.round(p.load / Math.max(1, st.capacity) * 12)));
      this.particles.splash(dock.x, dock.z, 1.2);
      p.load = 0;
      p.value = 0;
      this.autopilot = false;
      this.persist();
    }
  }

  private lockHint(piece: Piece, text: string) {
    if (this.time - this.hintAt < 2.5) return;
    this.hintAt = this.time;
    const sc = this.screenOf(piece.x, 2, piece.z);
    this.ui.floatText(sc.x, sc.y, text, 'lock');
    audio.denied();
  }

  /** Saca una pieza del río y la suma a la carga de un barco (jugador o ayudante). */
  private take(b: Boat, piece: Piece, isPlayer: boolean) {
    const kg = piece.type.kg;
    b.load += kg;
    b.value += kg * piece.type.value;
    this.save.itemsTotal++;
    this.save.kgTotal += kg;
    this.save.byType[piece.type.id] = (this.save.byType[piece.type.id] ?? 0) + 1;
    piece.pulled = false;
    this.pulled.delete(piece);
    const lift = LIFT_TIME[piece.type.tier] ?? 0;
    if (lift > 1) {
      b.lift = lift;
      b.vel.set(0, 0);
    }
    this.trash.collect(piece, b.pos.x, 1.2, b.pos.z, lift > 1 ? lift : undefined);
    this.particles.splash(piece.x, piece.z, piece.type.tier > 0 ? 1.2 + piece.type.tier * 0.35 : 0.45);
    if (isPlayer) {
      audio.pickup(piece.type.material, this.panOf(piece.x));
      if (piece.type.tier >= 3) this.shake = Math.min(0.8, 0.15 + piece.type.tier * 0.1);
      const sc = this.screenOf(piece.x, 1.5, piece.z);
      this.ui.floatText(sc.x, sc.y, `${TRASH_ICON[piece.type.id]} +${fmt(kg)} kg`, piece.type.tier > 0 ? 'heavy' : 'kg');
    }
  }

  // ------------------------------------------------------------------ ayudantes (lanchas)
  private updateHelpers(dt: number) {
    const st = this.st;
    const dock = plantDock();
    const hSpeed = 6.5 * (1 + 0.07 * this.save.levels.motor);
    const hRad = Math.max(2.4, st.radius * 0.8);
    const hCap = Math.max(40, Math.round(st.capacity * 0.2));
    for (const h of this.helpers) {
      let dx = 0, dz = 0, throttle = 0;
      h.pickCd -= dt;
      if (this.mode !== 'play' || h.lift > 0) {
        h.lift -= dt;
        this.steer(h, 0, 0, hSpeed, 0, dt);
        this.placeModel(h, hSpeed);
        continue;
      }
      if (h.state === 'return' || (this.trash.remainingItems <= 0 && h.load > 0)) {
        h.state = 'return';
        const nt = this.navTarget(h.pos, dock.x, dock.z);
        dx = nt.x - h.pos.x;
        dz = nt.z - h.pos.z;
        throttle = 1;
        if (Math.hypot(h.pos.x - dock.x, h.pos.z - dock.z) < DOCK_RADIUS) {
          const money = h.value * st.pricePerKg;
          this.save.money += money;
          if (money > 0) {
            const sc = this.screenOf(h.pos.x, 2.5, h.pos.z);
            if (sc.vis) this.ui.floatText(sc.x, sc.y, `+$ ${fmt(money)}`, '');
          }
          h.load = 0;
          h.value = 0;
          h.state = 'seek';
        }
      } else {
        h.retarget! -= dt;
        if (!h.target || !this.trash.isAlive(h.target) || h.target.pulled || h.retarget! <= 0) {
          if (h.target) h.target.claimed = false;
          h.target = this.trash.nearestCollectable(h.pos.x, h.pos.z, (pc) => this.canTake(pc, st.tier, hCap));
          if (h.target) h.target.claimed = true;
          h.retarget = 4;
        }
        if (h.target) {
          const nt = this.navTarget(h.pos, h.target.x, h.target.z);
          dx = nt.x - h.pos.x;
          dz = nt.z - h.pos.z;
          throttle = 1;
        } else if (h.load > 0) h.state = 'return';
        const pz = this.pickZone(h, hRad);
        let hb: Piece | null = null;
        if (h.load < hCap && h.pickCd <= 0) {
          this.trash.forEachNear(pz.x, pz.z, pz.r, (piece) => {
            if (piece.pulled || !this.canTake(piece, st.tier, hCap)) return;
            if (piece.claimed && piece !== h.target) return;
            if (!hb || piece.type.tier > hb.type.tier) hb = piece;
          });
        }
        if (hb) {
          (hb as Piece).claimed = false;
          this.take(h, hb, false);
          h.pickCd = 1 / 1.6;
        }
        if (h.load >= hCap) {
          h.state = 'return';
          if (h.target) h.target.claimed = false;
          h.target = null;
        }
      }
      const l = Math.hypot(dx, dz) || 1;
      this.steer(h, dx / l, dz / l, hSpeed, throttle, dt);
      this.placeModel(h, hSpeed);
      h.model.load.scale.y = 0.0001 + Math.min(1, h.load / hCap) * 0.75;
      h.model.load.visible = h.load > 0;
      h.model.crane.visible = st.tier >= 1;
      if (h.vel.length() > 2 && Math.random() < 0.3) this.particles.foam(h.pos.x - Math.sin(h.heading) * 2, h.pos.z - Math.cos(h.heading) * 2, 0, 0);
    }
  }

  // ------------------------------------------------------------------ drones
  private updateDrones(dt: number) {
    const st = this.st;
    const dock = plantDock();
    const speed = 8;
    for (const d of this.drones) {
      const m = d.model;
      for (const r of m.rotors) r.rotation.y += dt * 40;
      m.cargo.visible = d.load > 0;
      if (this.mode !== 'play') {
        m.group.position.copy(d.pos);
        continue;
      }
      let tx = d.pos.x, tz = d.pos.z, ty = 7;
      if (d.state === 'seek') {
        d.retarget -= dt;
        if (!d.target || !this.trash.isAlive(d.target) || d.target.pulled || d.retarget <= 0) {
          if (d.target) d.target.claimed = false;
          d.target = this.trash.nearestCollectable(d.pos.x, d.pos.z, (pc) => pc.type.tier === 0 && d.load + pc.type.kg <= st.droneCapacity);
          if (d.target) d.target.claimed = true;
          d.retarget = 5;
        }
        if (d.target) {
          tx = d.target.x;
          tz = d.target.z;
          const hd = Math.hypot(tx - d.pos.x, tz - d.pos.z);
          ty = hd < 4 ? 1.3 : 7;
          if (hd < 1.2 && d.pos.y < 2) {
            const p = d.target;
            d.target = null;
            p.claimed = false;
            const kg = p.type.kg;
            d.load += kg;
            d.value += kg * p.type.value;
            this.save.itemsTotal++;
            this.save.kgTotal += kg;
            this.save.byType[p.type.id] = (this.save.byType[p.type.id] ?? 0) + 1;
            this.trash.collect(p, d.pos.x, d.pos.y - 0.4, d.pos.z);
            this.particles.splash(p.x, p.z, 0.35);
            if (d.load + 2 > st.droneCapacity) d.state = 'return';
          }
        } else if (d.load > 0) d.state = 'return';
      } else {
        tx = dock.x;
        tz = dock.z - 9;
        const hd = Math.hypot(tx - d.pos.x, tz - d.pos.z);
        ty = hd < 3 ? 3 : 8;
        if (hd < 1.5) {
          this.save.money += d.value * st.pricePerKg;
          d.load = 0;
          d.value = 0;
          d.state = 'seek';
        }
      }
      const dx = tx - d.pos.x, dz = tz - d.pos.z;
      const hd = Math.hypot(dx, dz);
      const step = Math.min(hd, speed * dt);
      if (hd > 0.01) {
        d.pos.x += (dx / hd) * step;
        d.pos.z += (dz / hd) * step;
        m.group.rotation.y += (Math.atan2(dx, dz) - m.group.rotation.y) * Math.min(1, dt * 4);
      }
      d.pos.y += (ty - d.pos.y) * Math.min(1, dt * 3);
      m.group.position.set(d.pos.x, d.pos.y + Math.sin(this.time * 3 + d.phase) * 0.1, d.pos.z);
      m.group.rotation.x = Math.min(0.3, step / dt / speed * 0.25);
    }
  }

  // ------------------------------------------------------------------ hitos de naturaleza y final
  private updateProgress() {
    if (this.mode !== 'play') return;
    this.checkObjective();
    const c = this.visualClean;
    for (const m of NATURE) {
      if (c >= m && !this.save.nature.includes(m)) {
        this.save.nature.push(m);
        audio.milestone();
        this.ui.toast(`🌿 ${t().nature[String(m)]}`, '');
      }
    }
    if (this.trash.remainingItems <= 0 && !this.save.finished && this.player.load <= 0) {
      this.save.finished = true;
      this.save.objective = OBJECTIVES.length;
      this.endShownAt = this.time;
      audio.victory();
      this.persist();
    }
    if (this.endShownAt > 0 && this.time - this.endShownAt > 3) {
      this.endShownAt = -1;
      this.ui.end(this.save.playTime, this.save.trips, () => {});
    }
  }

  // ------------------------------------------------------------------ cámara
  private updateCamera(dt: number) {
    const portrait = window.innerHeight > window.innerWidth;
    if (this.mode === 'title') {
      const a = this.time * 0.04;
      const x0 = plantDock().x + 34 + Math.sin(a) * 10;
      this.camPos.set(x0, 7 + Math.sin(a * 0.7) * 1.5, riverCenter(x0) + 12);
      this.camera.position.lerp(this.camPos, Math.min(1, dt * 2));
      this.camLook.set(x0 - 90, 5, riverCenter(x0 - 90) - 8);
      this.camera.lookAt(this.camLook);
      return;
    }
    const p = this.player;
    const vScale = this.save.vehicle === 'barcaza' ? 1.35 : this.save.vehicle === 'remo' ? 0.85 : 1;
    const zoom = (1 + (Math.max(this.st.radius, this.st.magnetRadius * 0.5) - 2.4) * 0.03) * vScale * (portrait ? 1.6 : 1);
    const lookAhead = new THREE.Vector3(p.vel.x * 0.35, 0, p.vel.y * 0.35);
    const target = new THREE.Vector3(p.pos.x, 0, p.pos.z).add(lookAhead);
    this.camPos.set(target.x, 17 * zoom, target.z + 24 * zoom);
    this.camera.position.lerp(this.camPos, Math.min(1, dt * 3));
    this.camLook.lerp(target, Math.min(1, dt * 5));
    this.camera.lookAt(this.camLook.x, 0, this.camLook.z - 6);
    if (this.shake > 0) {
      this.camera.position.x += (Math.random() - 0.5) * this.shake;
      this.camera.position.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 1.5);
    }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = h > w ? 62 : 50;
    this.camera.updateProjectionMatrix();
    this.particles?.resize();
    if (this.composer) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.composer.setSize(w, h);
      this.composer.setPixelRatio(size.x / w);
    }
  }

  // ------------------------------------------------------------------ loop
  loop(now: number) {
    requestAnimationFrame(this.loop);
    const frameDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    // timescale > 1 solo para pruebas automatizadas
    for (let i = 0; i < this.timescale; i++) this.step(this.noRender ? 0.05 : frameDt);
    if (this.noRender) return;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.world.scene, this.camera);
  }

  private step(dt: number) {
    this.time += dt;
    if (this.mode === 'play' && !this.save.finished) this.save.playTime += dt;

    this.input.update();
    this.updatePlayer(dt);
    this.updateHelpers(dt);
    this.updateDrones(dt);
    this.updateProgress();

    const c = this.visualClean;
    this.trash.update(dt, this.time);
    this.particles.update(dt);
    this.fish.update(dt, c, this.player.pos);
    this.birds.update(this.time, c);
    this.world.update(this.time, c, this.player.pos, Math.min(1, this.player.vel.length() / this.st.speed));
    this.world.followShadow(this.player.pos.x, this.player.pos.z);
    audio.setCleanliness(c);
    audio.update();
    this.updateCamera(dt);

    const o = this.objective;
    this.ui.update({
      money: this.save.money,
      remainingKg: this.trash.remainingKg,
      remainingItems: this.trash.remainingItems,
      load: this.player.load,
      cap: this.st.capacity,
      levels: this.save.levels,
      unlocked: this.save.unlocked,
      vehicle: this.save.vehicle,
      canReturn: this.player.load > 0 && !this.autopilot,
      objective: o,
      objProgress: o ? this.objectiveProgress(o) : 0,
      clean: c,
    }, dt);

    this.saveTimer += dt;
    if (this.saveTimer > 5 && this.mode === 'play') {
      this.saveTimer = 0;
      this.persist();
    }
  }
}
