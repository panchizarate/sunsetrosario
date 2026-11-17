// Simulación aproximada de un jugador razonable para balancear la duración.
// Ejecutar: npx tsx scripts/sim.ts
import { TOTAL_KG, TRASH_TYPES, UPGRADES, emptyLevels, stats, MILESTONES, milestoneBonus } from '../src/game/config';

const L = emptyLevels();
let money = 0;
let remaining = TOTAL_KG;
let t = 0;
const dt = 1;
const log: string[] = [];
let nextMs = 0;
let firstBuy = -1;

function avgKgAndShare(tier: number) {
  let w = 0, wu = 0, kg = 0;
  for (const tt of TRASH_TYPES) {
    w += tt.weight;
    if (tt.tier <= tier) { wu += tt.weight; kg += tt.weight * tt.kg; }
  }
  return { avgKg: kg / wu, share: wu / w };
}

// estado de un barco (jugador o ayudante)
type Boat = { load: number; returning: number };
const player: Boat = { load: 0, returning: 0 };
const helpers: Boat[] = [];

function boatStep(b: Boat, eff: number) {
  const s = stats(L);
  const frac = remaining / TOTAL_KG;
  const density = 0.12 + 0.88 * Math.pow(frac, 0.7);
  const { avgKg, share } = avgKgAndShare(s.tier);
  const cap = s.capacity * (eff < 1 ? 0.45 : 1);
  if (b.returning > 0) {
    b.returning -= dt;
    if (b.returning <= 0) {
      money += b.load * s.pricePerKg;
      b.load = 0;
    }
    return;
  }
  const picks = Math.min(5, 0.075 * s.radius * s.speed * density * share * 1.4) * eff;
  const kg = picks * avgKg * s.kgMult * dt;
  const got = Math.min(kg, cap - b.load, remaining);
  b.load += got;
  remaining -= got;
  if (b.load >= cap - 0.01 || remaining <= 0) b.returning = 75 / (s.speed * (eff < 1 ? 0.75 : 1)) + 2;
}

while (remaining > 0 && t < 6 * 3600) {
  boatStep(player, 1);
  while (helpers.length < L.flota) helpers.push({ load: 0, returning: 0 });
  for (const h of helpers) boatStep(h, 0.55);
  const s = stats(L);
  const bk = Math.min(s.barrierKgPerSec * dt, remaining);
  remaining -= bk;
  money += bk * s.pricePerKg;
  const frac = 1 - remaining / TOTAL_KG;
  while (nextMs < MILESTONES.length && frac >= MILESTONES[nextMs]) {
    money += milestoneBonus(MILESTONES[nextMs]);
    log.push(`${(t / 60).toFixed(1)} min  hito ${MILESTONES[nextMs] * 100}%`);
    nextMs++;
  }
  // compra: la mejora más barata disponible (jugador "goloso")
  for (;;) {
    let best = null as null | (typeof UPGRADES)[number];
    let bestCost = Infinity;
    for (const u of UPGRADES) {
      if (L[u.id] >= u.max) continue;
      const c = u.cost(L[u.id]);
      if (c < bestCost) { bestCost = c; best = u; }
    }
    if (!best || bestCost > money) break;
    money -= bestCost;
    L[best.id]++;
    if (firstBuy < 0) firstBuy = t;
    if (best.id === 'grua' || best.id === 'flota') log.push(`${(t / 60).toFixed(1)} min  ${best.id} -> ${L[best.id]}`);
  }
  t += dt;
}
console.log(log.join('\n'));
console.log('primera compra a los', firstBuy, 's');
console.log('TOTAL', (t / 60).toFixed(1), 'min', 'niveles', L);
