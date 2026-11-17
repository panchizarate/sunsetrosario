import * as THREE from 'three';
import {
  TOTAL_KG, UPGRADES, UpgradeId, stats, Stats, MILESTONES, milestoneBonus, plantDock, DOCK_RADIUS,
  riverCenter, RIVER,
} from './config';
import { World } from './world';
import { TrashSystem, Piece } from './trash';
import { Particles, Fish, Birds, Barriers, clampToRiver, BARRIER_XS } from './effects';
import { makeBoat, BoatModel } from './models';
import { Input } from './input';
import { UI } from './ui';
import { audio } from './audio';
import { t, fmt, fmtKg, setLang } from './i18n';
import { SaveData, loadSave, newSave, writeSave, clearSave, loadSettings, writeSettings, Settings } from './save';

interface Boat {
  model: BoatModel;
  pos: THREE.Vector3;
  vel: THREE.Vector2;
  heading: number;
  turnRate: number;
  load: number;
  // ayudantes
  state?: 'seek' | 'return';
  target?: Piece | null;
  retarget?: number;
}

const tmpV = new THREE.Vector3();
const found: Piece[] = [];

export class Game {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  world: World;
  trash: TrashSystem;
  particles: Particles;
  fish: Fish;
  birds: Birds;
  barriers: Barriers;
  input: Input;
  ui: UI;
  save: SaveData;
  settings: Settings;
  st!: Stats;
  player: Boat;
  helpers: Boat[] = [];
  mode: 'title' | 'play' = 'title';
  autopilot = false;
  time = 0;
  private last = performance.now();
  private saveTimer = 0;
  private lockHintAt = 0;
  private fullWarned = false;
  private barrierFx = 0;
  private camPos = new THREE.Vector3(0, 40, 60);
  private camLook = new THREE.Vector3();
  private shake = 0;
  private high: boolean;
  private endShownAt = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.settings = loadSettings();
    if (this.settings.lang) setLang(this.settings.lang);
    const isMobile = matchMedia('(pointer: coarse)').matches;
    this.high = this.settings.high ?? !isMobile;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.high, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.high ? 2 : 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = this.high;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 1400);
    this.world = new World({ high: this.high });
    const scene = this.world.scene;
    this.trash = new TrashSystem(scene, this.high);
    this.particles = new Particles(scene, this.high ? 1400 : 800);
    this.fish = new Fish(scene);
    this.fish.onSplash = (x, z, s) => {
      this.particles.splash(x, z, s);
      const d = tmpV.set(x, 0, z).distanceTo(this.player.pos);
      if (d < 35) audio.fishJump(this.panOf(x));
    };
    this.birds = new Birds(scene);
    this.barriers = new Barriers(scene);

    // estado / guardado
    const params = new URLSearchParams(location.search);
    this.save = loadSave() ?? newSave();
    if (params.has('clean')) this.save.remaining = TOTAL_KG * (1 - Math.min(1, +params.get('clean')!));
    if (params.has('money')) this.save.money = +params.get('money')!;
    if (params.has('levels')) {
      const lv = +params.get('levels')!;
      for (const u of UPGRADES) this.save.levels[u.id] = Math.min(u.max, lv);
    }
    this.st = stats(this.save.levels);

    const plModel = makeBoat('#ffffff', '#ff7b39', 1);
    scene.add(plModel.group);
    const dock = plantDock();
    this.player = {
      model: plModel,
      pos: new THREE.Vector3(this.save.boat.x || dock.x, 0, this.save.boat.z || dock.z + 10),
      vel: new THREE.Vector2(),
      heading: this.save.boat.h ?? Math.PI / 2,
      turnRate: 0,
      load: this.save.boat.load ?? 0,
    };
    clampToRiver(this.player.pos, 2.5);
    this.syncHelpers();

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
    });
    this.ui.settings = this.settings;
    audio.musicVolume = this.settings.music;
    audio.sfxVolume = this.settings.sfx;
    this.ui.setHudVisible(false);

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
      this.save = newSave();
      this.st = stats(this.save.levels);
      this.player.pos.set(dock.x, 0, dock.z + 10);
      this.syncHelpers();
      this.startPlay();
    });

    if (params.has('autoplay')) {
      (this.ui as any).closeTitle?.();
      this.startPlay();
    }
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ flujo
  private startPlay() {
    audio.start();
    audio.setCleanliness(this.cleanliness);
    this.mode = 'play';
    this.ui.setHudVisible(true);
    this.ui.showHint(this.input.isTouch ? t().controlsMobile : t().controlsDesktop, 5000);
    // ganancias offline de las barreras
    const elapsed = (Date.now() - this.save.savedAt) / 1000;
    if (this.st.barrierKgPerSec > 0 && elapsed > 60 && this.save.remaining > 0) {
      const kg = Math.min(this.save.remaining, Math.min(elapsed, 7200) * this.st.barrierKgPerSec * 0.5);
      const money = kg * this.st.pricePerKg;
      this.ui.offline(kg, money, () => {
        this.save.remaining -= kg;
        this.save.money += money;
        audio.deposit(1);
      });
    }
    this.save.savedAt = Date.now();
  }

  get cleanliness() {
    return 1 - Math.max(0, this.save.remaining) / TOTAL_KG;
  }

  private syncHelpers() {
    const scene = this.world.scene;
    const dock = plantDock();
    while (this.helpers.length < this.st.helpers) {
      const m = makeBoat('#e7f6ff', '#2f80ed', 0.72);
      m.netGroup.scale.setScalar(0.9);
      scene.add(m.group);
      this.helpers.push({
        model: m,
        pos: new THREE.Vector3(dock.x + (Math.random() - 0.5) * 6, 0, dock.z + 4),
        vel: new THREE.Vector2(),
        heading: Math.PI / 2,
        turnRate: 0,
        load: 0,
        state: 'seek',
        target: null,
        retarget: 0,
      });
      if (this.mode === 'play') this.particles.splash(dock.x, dock.z + 4, 1.5);
    }
  }

  private buy(id: UpgradeId) {
    const u = UPGRADES.find((x) => x.id === id)!;
    const lv = this.save.levels[id];
    const cost = u.cost(lv);
    if (lv >= u.max || cost > this.save.money) {
      audio.denied();
      return;
    }
    this.save.money -= cost;
    this.save.levels[id]++;
    this.st = stats(this.save.levels);
    audio.buy();
    if (id === 'flota') this.syncHelpers();
    if (id === 'grua') {
      const s = t();
      this.ui.toast(`🏗️ ${s.up.grua[0]} ${this.save.levels.grua}`, s.craneTiers[this.save.levels.grua]);
    }
    if (id === 'barreras' && this.save.levels.barreras === 1) this.ui.toast('🟨 ' + t().up.barreras[0], t().up.barreras[1]);
    this.persist();
  }

  private startReturn() {
    if (this.player.load <= 0) return;
    this.autopilot = true;
  }

  private persist() {
    this.save.boat = { x: this.player.pos.x, z: this.player.pos.z, h: this.player.heading, load: this.player.load };
    writeSave(this.save);
  }

  // ------------------------------------------------------------------ helpers
  private panOf(x: number) {
    return Math.max(-1, Math.min(1, (x - this.player.pos.x) / 30));
  }

  private screenOf(x: number, y: number, z: number) {
    tmpV.set(x, y, z).project(this.camera);
    return { x: (tmpV.x * 0.5 + 0.5) * window.innerWidth, y: (-tmpV.y * 0.5 + 0.5) * window.innerHeight, vis: tmpV.z < 1 };
  }

  /** Punto de navegación siguiendo el cauce (evita cortar por tierra en las curvas). */
  private navTarget(from: THREE.Vector3, tx: number, tz: number) {
    const dx = tx - from.x;
    if (Math.abs(dx) < 18) return { x: tx, z: tz };
    const nx = from.x + Math.sign(dx) * 16;
    return { x: nx, z: riverCenter(nx) * 0.7 + tz * 0.3 };
  }

  private steer(b: Boat, dirX: number, dirZ: number, maxSpeed: number, throttle: number, dt: number) {
    const accel = 2.6;
    const tx = dirX * maxSpeed * throttle, tz = dirZ * maxSpeed * throttle;
    b.vel.x += (tx - b.vel.x) * Math.min(1, dt * accel);
    b.vel.y += (tz - b.vel.y) * Math.min(1, dt * accel);
    b.pos.x += b.vel.x * dt;
    b.pos.z += b.vel.y * dt;
    clampToRiver(b.pos, 2.4);
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
    const wave = Math.sin(this.time * 1.7 + b.pos.x * 0.2) * 0.08 + Math.sin(this.time * 2.3 + b.pos.z * 0.3) * 0.05;
    g.position.set(b.pos.x, wave, b.pos.z);
    g.rotation.set(
      -sp * 0.08 + Math.sin(this.time * 1.4 + b.pos.z) * 0.03,
      b.heading,
      -b.turnRate * 0.12 + Math.sin(this.time * 1.9 + b.pos.x) * 0.035,
      'YXZ',
    );
    b.model.flag.rotation.y = Math.PI / 2 + Math.sin(this.time * 7) * 0.3;
  }

  private netPoint(b: Boat, scale = 1) {
    return { x: b.pos.x + Math.sin(b.heading) * 3.4 * scale, z: b.pos.z + Math.cos(b.heading) * 3.4 * scale };
  }

  /** Zona de recolección: cubre la red y el casco (pasar por encima de la basura también la junta). */
  private pickZone(b: Boat, radius: number, scale = 1) {
    const off = 1.7 * scale;
    return { x: b.pos.x + Math.sin(b.heading) * off, z: b.pos.z + Math.cos(b.heading) * off, r: radius + off };
  }

  // ------------------------------------------------------------------ jugador
  private updatePlayer(dt: number) {
    const p = this.player;
    const st = this.st;
    const dock = plantDock();
    let dx = 0, dz = 0, throttle = 0;

    if (this.mode === 'play' && this.input.active) {
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
    this.steer(p, dx, dz, st.speed, throttle, dt);
    this.placeModel(p, st.speed);
    const speedNorm = p.vel.length() / st.speed;
    audio.setEngine(throttle, speedNorm);

    // estela
    if (speedNorm > 0.15 && Math.random() < speedNorm * 1.2) {
      const bx = p.pos.x - Math.sin(p.heading) * 2.8, bz = p.pos.z - Math.cos(p.heading) * 2.8;
      const side = Math.random() < 0.5 ? -1 : 1;
      const px = Math.cos(p.heading) * side, pz = -Math.sin(p.heading) * side;
      this.particles.foam(bx + px * 0.8, bz + pz * 0.8, px * 1.5 - p.vel.x * 0.1, pz * 1.5 - p.vel.y * 0.1);
    }

    // carga visible en el barco
    const lf = Math.min(1, p.load / st.capacity);
    p.model.load.scale.y = 0.0001 + lf * 0.75;
    p.model.load.visible = lf > 0.01;
    p.model.crane.visible = st.tier >= 1;
    const ns = 0.8 + st.radius / 6;
    p.model.netGroup.scale.set(ns, 1, 1);

    if (this.mode !== 'play') return;

    // recolección
    const np = this.netPoint(p);
    const pz = this.pickZone(p, st.radius);
    this.trash.query(pz.x, pz.z, pz.r, found);
    for (const piece of found) {
      if (this.save.remaining <= 0) break;
      if (piece.type.tier > st.tier) {
        if (this.time - this.lockHintAt > 2.5) {
          this.lockHintAt = this.time;
          const sc = this.screenOf(piece.x, 2, piece.z);
          this.ui.floatText(sc.x, sc.y, `🔒 ${t().needCrane} ${piece.type.tier}`, 'lock');
          audio.denied();
        }
        continue;
      }
      const kg = Math.min(piece.type.kg * st.kgMult, this.save.remaining);
      if (p.load >= st.capacity) continue; // se permite pasarse con la última pieza
      p.load += kg;
      this.save.remaining -= kg;
      this.save.kgTotal += kg;
      this.trash.collect(piece, np.x - Math.sin(p.heading) * 2, np.z - Math.cos(p.heading) * 2);
      this.particles.splash(piece.x, piece.z, piece.type.tier > 0 ? 1.4 + piece.type.tier * 0.3 : 0.5);
      audio.pickup(piece.type.material, this.panOf(piece.x));
      if (piece.type.tier >= 2) this.shake = Math.min(0.6, 0.15 + piece.type.tier * 0.08);
      const sc = this.screenOf(piece.x, 1.5, piece.z);
      this.ui.floatText(sc.x, sc.y, `+${fmt(kg)} kg`, piece.type.tier > 0 ? 'heavy' : 'kg');
    }

    // bodega llena
    const full = p.load >= st.capacity;
    if (full && !this.fullWarned) {
      this.fullWarned = true;
      audio.full();
      this.ui.showHint(t().full, 3500);
    }
    if (!full) this.fullWarned = false;

    // descarga en la planta
    if (p.load > 0 && Math.hypot(p.pos.x - dock.x, p.pos.z - dock.z) < DOCK_RADIUS) {
      const money = p.load * st.pricePerKg;
      this.save.money += money;
      this.save.trips++;
      audio.deposit(Math.min(1, p.load / st.capacity));
      const sc = this.screenOf(dock.x, 3, dock.z);
      this.ui.floatText(sc.x, sc.y - 30, `+$ ${fmt(money)}`, 'money');
      this.ui.coinsTo(sc.x, sc.y, Math.min(16, 4 + Math.round(money / Math.max(1, st.capacity * st.pricePerKg) * 12)));
      this.particles.splash(dock.x, dock.z, 1.2);
      p.load = 0;
      this.autopilot = false;
      this.persist();
    }
  }

  // ------------------------------------------------------------------ ayudantes
  private updateHelpers(dt: number) {
    const st = this.st;
    const dock = plantDock();
    const hSpeed = st.speed * 0.72, hRad = st.radius * 0.7, hCap = Math.max(st.capacity * 0.45, 1);
    for (const h of this.helpers) {
      let dx = 0, dz = 0, throttle = 0;
      if (this.mode !== 'play') {
        this.steer(h, 0, 0, hSpeed, 0, dt);
        this.placeModel(h, hSpeed);
        continue;
      }
      if (h.state === 'return' || (this.save.remaining <= 0 && h.load > 0)) {
        h.state = 'return';
        const nt = this.navTarget(h.pos, dock.x, dock.z);
        dx = nt.x - h.pos.x;
        dz = nt.z - h.pos.z;
        throttle = 1;
        if (Math.hypot(h.pos.x - dock.x, h.pos.z - dock.z) < DOCK_RADIUS) {
          const money = h.load * st.pricePerKg;
          this.save.money += money;
          if (money > 0) {
            const sc = this.screenOf(h.pos.x, 2.5, h.pos.z);
            if (sc.vis) this.ui.floatText(sc.x, sc.y, `+$ ${fmt(money)}`, '');
          }
          h.load = 0;
          h.state = 'seek';
        }
      } else {
        h.retarget! -= dt;
        if (!h.target || h.target.state !== 'float' || h.retarget! <= 0) {
          if (h.target) h.target.claimed = false;
          h.target = this.trash.nearestCollectable(h.pos.x, h.pos.z, st.tier);
          if (h.target) h.target.claimed = true;
          h.retarget = 3;
        }
        if (h.target) {
          const nt = this.navTarget(h.pos, h.target.x, h.target.z);
          dx = nt.x - h.pos.x;
          dz = nt.z - h.pos.z;
          throttle = 1;
        }
        const np = this.netPoint(h, 0.72);
        const hz = this.pickZone(h, hRad, 0.72);
        this.trash.query(hz.x, hz.z, hz.r, found);
        for (const piece of found) {
          if (piece.type.tier > st.tier || this.save.remaining <= 0) continue;
          const kg = Math.min(piece.type.kg * st.kgMult, this.save.remaining);
          if (h.load >= hCap) continue;
          h.load += kg;
          this.save.remaining -= kg;
          this.save.kgTotal += kg;
          piece.claimed = false;
          this.trash.collect(piece, np.x, np.z);
          this.particles.splash(piece.x, piece.z, 0.4);
        }
        if (h.load >= hCap || (h.load > 0 && this.save.remaining <= 0)) {
          h.state = 'return';
          if (h.target) h.target.claimed = false;
          h.target = null;
        }
      }
      const l = Math.hypot(dx, dz) || 1;
      this.steer(h, dx / l, dz / l, hSpeed, throttle, dt);
      this.placeModel(h, hSpeed);
      h.model.load.scale.y = 0.0001 + Math.min(1, h.load / hCap) * 0.75;
      h.model.crane.visible = st.tier >= 1;
      if (h.vel.length() > 2 && Math.random() < 0.3) {
        this.particles.foam(h.pos.x - Math.sin(h.heading) * 2, h.pos.z - Math.cos(h.heading) * 2, 0, 0);
      }
    }
  }

  // ------------------------------------------------------------------ hitos y barreras
  private updateProgress(dt: number) {
    if (this.mode !== 'play') return;
    const st = this.st;
    if (st.barrierKgPerSec > 0 && this.save.remaining > 0) {
      const kg = Math.min(this.save.remaining, st.barrierKgPerSec * dt);
      this.save.remaining -= kg;
      this.save.kgTotal += kg;
      this.save.money += kg * st.pricePerKg;
      // efecto visual: piezas que "caen" en las barreras
      this.barrierFx -= dt;
      if (this.barrierFx <= 0) {
        this.barrierFx = Math.max(0.15, 1.2 / Math.sqrt(st.barrierKgPerSec));
        const n = this.barriers.visibleCount;
        if (n > 0) {
          const bx = BARRIER_XS[Math.floor(Math.random() * n)];
          const cand = this.trash.pieces.find((p) => p.state === 'float' && Math.abs(p.x - bx) < 14 && !p.claimed);
          if (cand) {
            this.trash.sink(cand);
            this.particles.splash(cand.x, cand.z, 0.4);
          }
        }
      }
    }
    if (this.save.remaining < 0.5) this.save.remaining = 0;
    const c = this.cleanliness;
    for (const m of MILESTONES) {
      if (c >= m && !this.save.milestones.includes(m)) {
        this.save.milestones.push(m);
        const bonus = milestoneBonus(m);
        if (m < 1) {
          this.save.money += bonus;
          audio.milestone();
          this.ui.toast(t().milestones[String(m)], `${t().bonus}: +$ ${fmt(bonus)}`);
        }
      }
    }
    if (this.save.remaining <= 0 && !this.save.finished) {
      this.save.finished = true;
      this.endShownAt = this.time;
      audio.victory();
      this.ui.toast(t().milestones['1'], '');
      this.persist();
    }
    if (this.endShownAt > 0 && this.time - this.endShownAt > 4) {
      this.endShownAt = -1;
      this.ui.end(this.save.playTime, this.save.trips, () => {});
    }
  }

  // ------------------------------------------------------------------ cámara
  private updateCamera(dt: number) {
    const portrait = window.innerHeight > window.innerWidth;
    if (this.mode === 'title') {
      const a = this.time * 0.05;
      const dock = plantDock();
      this.camPos.set(dock.x + Math.sin(a) * 70, 34, dock.z + 40 + Math.cos(a) * 30);
      this.camera.position.lerp(this.camPos, Math.min(1, dt * 2));
      this.camLook.set(dock.x + Math.sin(a) * 30, 0, riverCenter(dock.x));
      this.camera.lookAt(this.camLook);
      return;
    }
    const p = this.player;
    const zoom = (1 + (this.st.radius - 2.4) * 0.035 + this.helpers.length * 0.02) * (portrait ? 1.7 : 1);
    const ending = this.save.finished && this.endShownAt > 0 ? 1.6 : 1;
    const lookAhead = new THREE.Vector3(p.vel.x * 0.35, 0, p.vel.y * 0.35);
    const target = new THREE.Vector3(p.pos.x, 0, p.pos.z).add(lookAhead);
    this.camPos.set(target.x, 21 * zoom * ending, target.z + 25 * zoom);
    this.camera.position.lerp(this.camPos, Math.min(1, dt * 3));
    this.camLook.lerp(target, Math.min(1, dt * 5));
    this.camera.lookAt(this.camLook.x, 0, this.camLook.z - 5);
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
    this.particles.resize();
  }

  // ------------------------------------------------------------------ loop
  private noRender = new URLSearchParams(location.search).has('norender');
  private timescale = Math.max(1, Math.min(60, +(new URLSearchParams(location.search).get('timescale') ?? 1)));

  loop(now: number) {
    requestAnimationFrame(this.loop);
    const frameDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    // timescale > 1 solo para pruebas automatizadas
    for (let i = 0; i < this.timescale; i++) this.step(this.noRender ? 0.05 : frameDt);
    if (!this.noRender) this.renderer.render(this.world.scene, this.camera);
  }

  private step(dt: number) {
    this.time += dt;
    if (this.mode === 'play' && !this.save.finished) this.save.playTime += dt;

    this.input.update();
    this.updatePlayer(dt);
    this.updateHelpers(dt);
    this.updateProgress(dt);

    const c = this.cleanliness;
    this.trash.update(dt, this.time, this.save.remaining);
    this.particles.update(dt);
    this.fish.update(dt, c, this.player.pos);
    this.birds.update(this.time, c);
    this.barriers.update(this.time, this.save.levels.barreras);
    this.world.update(this.time, c, this.player.pos, Math.min(1, this.player.vel.length() / this.st.speed));
    this.world.followShadow(this.player.pos.x, this.player.pos.z);
    audio.setCleanliness(c);
    audio.update();
    this.updateCamera(dt);

    this.ui.update(
      this.save.money, this.save.remaining, c, this.player.load, this.st.capacity, this.save.levels,
      this.player.load > 0 && !this.autopilot, dt,
    );

    this.saveTimer += dt;
    if (this.saveTimer > 5 && this.mode === 'play') {
      this.saveTimer = 0;
      this.persist();
    }
  }
}

export { fmtKg, RIVER };
