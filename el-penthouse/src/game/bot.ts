// Bot de prueba: juega solo para medir ritmo y detectar bloqueos (?bot&timescale=40&norender).
import * as THREE from 'three';
import { MEZZ, UPGRADES } from './config';
import type { Game } from './game';

export function runBot(game: Game) {
  const g = game as any;
  let wait = 0, buyT = 0, last = '', stuck = 0;
  const log: string[] = [];
  const t0 = performance.now();
  const report = (m: string) => { const line = `[${(g.time / 60).toFixed(1)} min] ${m}`; log.push(line); console.log('BOT ' + line); };
  const PRI = ['manos', 'agarre', 'velocidad', 'escaner', 'iman', 'combo', 'ayudantes'];
  g.bot = (dt: number) => {
    let left = dt;
    while (left > 0 && g.bot) {
      const s = Math.min(0.1, left);
      left -= s;
      step(s);
    }
  };
  const moveTo = (p: THREE.Vector3, s: number) => {
    const lvlT = p.y > MEZZ - 1 ? MEZZ : 0;
    if (Math.abs(g.pos.y - lvlT) > 1) { // cambio de piso: tiempo de la escalera
      wait += 6;
      g.pos.set(-10.5, lvlT, -1.5);
      return false;
    }
    const d = new THREE.Vector3(p.x - g.pos.x, 0, p.z - g.pos.z);
    const len = d.length();
    const sp = g.st.run * (g.drinks.get('Negroni') > 0 ? 1.4 : 1) * 0.8; // 0.8: rodeos
    if (len < 1.6) return true;
    d.multiplyScalar(Math.min(1, (sp * s) / len));
    g.pos.add(d);
    g.yaw = Math.atan2(-d.x, -d.z);
    return false;
  };
  const step = (s: number) => {
    if (g.phone) g.answer();
    if (wait > 0) { wait -= s; return; }
    buyT -= s;
    if (buyT <= 0) {
      buyT = 4;
      for (const id of PRI) {
        const u = UPGRADES.find((x) => x.id === id)!;
        if (g.levels[id] < u.max && g.money >= u.cost(g.levels[id])) { g.buy(id); report(`compra ${id} ${g.levels[id]}`); break; }
      }
    }
    const zone = g.currentZone();
    if (zone !== last) { report(`zona actual: ${zone} · $${Math.round(g.money)} · total ganado $${Math.round(g.earned)}`); last = zone; }
    if (zone === 'terraza' || zone === 'secreta') {
      if (!g.tokens.has('arcade')) { wait += 90; g.giveToken('arcade'); report('ficha arcade'); return; }
      if (!g.tokens.has('basquet')) { wait += 120; g.giveToken('basquet'); report('ficha básquet'); return; }
      if (!g.tokens.has('caja')) { wait += 40; g.flags.cctv2 = 1; g.giveToken('caja'); report('ficha caja fuerte'); return; }
      if (!g.flags.secretOpen) { wait += 30; g.secretDoor(); report('puerta secreta abierta'); return; }
      report(`FIN · ${((performance.now() - t0) / 1000).toFixed(0)} s reales · objetos ${g.placed}`);
      (window as any).botDone = log;
      g.bot = null;
      g.paused = true;
      return;
    }
    const groups = g.groups();
    // ¿hay que ir a dejar?
    const full = g.held.length >= g.st.hands;
    const keys = new Set(g.held.map((i: any) => i.kind + i.variant));
    let floorTarget: any = null, bd = Infinity;
    for (const it of g.items.items) {
      if (it.state !== 'floor' || it.zone !== zone) continue;
      let d = it.pos.distanceTo(g.pos) + (Math.abs(it.pos.y - g.pos.y) > 2 ? 20 : 0);
      if (g.held.length && !keys.has(it.kind + it.variant)) d += 6;
      if (d < bd) { bd = d; floorTarget = it; }
    }
    if (groups.length && (full || !floorTarget || bd > 12)) {
      const gr = groups.reduce((a: any, b: any) => (b.count > a.count ? b : a));
      const sec = g.house.sections.find((x: any) => x.kind === gr.kind && x.variant === gr.variant);
      const c = sec.box.getCenter(new THREE.Vector3());
      c.y = sec.box.min.y;
      if (moveTo(c, s)) { g.placeAt(sec); wait += 0.8; stuck = 0; }
      return;
    }
    if (floorTarget) {
      if (moveTo(floorTarget.pos, s)) { g.grab(floorTarget); wait += 0.45; stuck = 0; }
      return;
    }
    stuck += s;
    if (stuck > 30) { report('ATASCADO'); g.bot = null; (window as any).botDone = log; }
  };
}
