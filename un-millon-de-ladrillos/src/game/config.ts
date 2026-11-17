// Configuración central: el predio, los edificios, las herramientas y la economía.

// ---------- Ladrillo ----------
export const BL = 0.24; // largo de ladrillo + junta (m)
export const BH = 0.08; // alto de hilada + junta (m)
export const LAYERS = 2; // ladrillos de espesor por pared
export const T = BL; // espesor de pared (2 ladrillos de 0,12 m)
export const TOTAL_BRICKS = 1_000_000;

// ---------- Edificios ----------
export interface Opening { c0: number; c1: number; r0: number; r1: number } // celdas [c0,c1) x [r0,r1)
export interface WallDef {
  id: number;
  building: string;
  // origen = esquina inferior izquierda del frente; local x a lo ancho, y arriba, +z hacia afuera
  ox: number;
  oz: number;
  rotY: number;
  cols: number;
  rows: number;
  openings: Opening[];
  damage?: number; // ladrillos de la capa frontal que arrancan caídos
}

export interface BuildingDef {
  id: string;
  x: number;
  z: number;
  sx: number; // ancho en ladrillos (eje x)
  sz: number; // fondo en ladrillos (eje z)
  rows: number;
  windows?: { w: number; h: number; every: number; floor: number; sill: number; margin: number };
  door?: { w: number; h: number };
}

export const BUILDINGS: BuildingDef[] = [
  { id: 'garita', x: 4, z: 30, sx: 20, sz: 15, rows: 35, door: { w: 4, h: 26 }, windows: { w: 4, h: 10, every: 10, floor: 35, sill: 12, margin: 3 } },
  { id: 'galpon', x: 25, z: 14, sx: 60, sz: 40, rows: 70, door: { w: 16, h: 55 }, windows: { w: 6, h: 12, every: 14, floor: 70, sill: 48, margin: 6 } },
  { id: 'chimenea', x: 37, z: -4, sx: 10, sz: 10, rows: 420 },
  { id: 'nave', x: -24, z: 8, sx: 120, sz: 60, rows: 260, door: { w: 20, h: 70 }, windows: { w: 8, h: 30, every: 16, floor: 100, sill: 30, margin: 10 } },
  { id: 'fabrica', x: 12, z: -16, sx: 150, sz: 80, rows: 180, door: { w: 18, h: 60 }, windows: { w: 7, h: 25, every: 13, floor: 75, sill: 25, margin: 8 } },
  { id: 'torre', x: -24, z: -28, sx: 100, sz: 100, rows: 800, door: { w: 10, h: 32 }, windows: { w: 6, h: 18, every: 12, floor: 35, sill: 12, margin: 7 } },
];

export const LOT = { x0: -52, x1: 52, z0: -56, z1: 48, rows: 40 };
export const SPAWN = { x: 0, z: 42 };
export const DUMPSTER = { x: 11, z: 41, r: 3.2 };

function buildingWalls(b: BuildingDef, start: number): WallDef[] {
  const dx = b.sx * BL, dz = b.sz * BL;
  const side = b.sz - 2; // las laterales van entre frente y fondo
  const out: WallDef[] = [];
  const mk = (ox: number, oz: number, rotY: number, cols: number, front: boolean): WallDef => {
    const openings: Opening[] = [];
    const w = b.windows;
    if (w) {
      for (let f = 0; f * w.floor + w.sill + w.h <= b.rows - 4; f++) {
        for (let c = w.margin; c + w.w <= cols - w.margin; c += w.every) {
          openings.push({ c0: c, c1: c + w.w, r0: f * w.floor + w.sill, r1: f * w.floor + w.sill + w.h });
        }
      }
    }
    if (front && b.door) {
      const c0 = Math.floor((cols - b.door.w) / 2);
      // la puerta reemplaza las ventanas que la pisan
      for (let i = openings.length - 1; i >= 0; i--) {
        const o = openings[i];
        if (o.r0 < b.door.h && o.c1 > c0 - 2 && o.c0 < c0 + b.door.w + 2) openings.splice(i, 1);
      }
      openings.push({ c0, c1: c0 + b.door.w, r0: 0, r1: b.door.h });
    }
    return { id: start + out.length, building: b.id, ox, oz, rotY, cols, rows: b.rows, openings };
  };
  out.push(mk(b.x - dx / 2, b.z + dz / 2 - T / 2, 0, b.sx, true)); // frente (+z)
  out.push(mk(b.x + dx / 2, b.z - dz / 2 + T / 2, Math.PI, b.sx, false)); // fondo
  out.push(mk(b.x + dx / 2 - T / 2, b.z + (side * BL) / 2, Math.PI / 2, side, false)); // derecha (+x)
  out.push(mk(b.x - dx / 2 + T / 2, b.z - (side * BL) / 2, -Math.PI / 2, side, false)); // izquierda
  return out;
}

/** Ladrillos de una pared (las hiladas impares tienen una celda más: dos medios ladrillos). */
export function wallBrickCount(w: WallDef): number {
  let n = 0;
  for (let r = 0; r < w.rows; r++) {
    const cells = w.cols + (r & 1);
    for (let c = 0; c < cells; c++) if (!isOpening(w, c, r)) n += LAYERS;
  }
  return n;
}

export function isOpening(w: WallDef, c: number, r: number): boolean {
  const cc = c + ((r & 1) ? -0.5 : 0) + 0.5; // centro de la celda en unidades de ladrillo
  for (const o of w.openings) if (cc >= o.c0 && cc < o.c1 && r >= o.r0 && r < o.r1) return true;
  return false;
}

function perimeterWalls(start: number, gateCols: number): WallDef[] {
  const { x0, x1, z0, z1, rows } = LOT;
  const wx = Math.round((x1 - x0) / BL), wz = Math.round((z1 - z0) / BL) - 2;
  const W = wx * BL, D = (wz + 2) * BL;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const walls: WallDef[] = [];
  // el muro mira hacia adentro del predio (frente = lado interior)
  const g0 = Math.floor((wx - gateCols) / 2);
  walls.push({ id: start, building: 'muro', ox: cx + W / 2, oz: cz + D / 2 - T / 2, rotY: Math.PI, cols: wx, rows, openings: [{ c0: g0, c1: g0 + gateCols, r0: 0, r1: rows }] });
  walls.push({ id: start + 1, building: 'muro', ox: cx - W / 2, oz: cz - D / 2 + T / 2, rotY: 0, cols: wx, rows, openings: [] });
  walls.push({ id: start + 2, building: 'muro', ox: cx + W / 2 - T / 2, oz: cz - (wz * BL) / 2, rotY: -Math.PI / 2, cols: wz, rows, openings: [] });
  walls.push({ id: start + 3, building: 'muro', ox: cx - W / 2 + T / 2, oz: cz + (wz * BL) / 2, rotY: Math.PI / 2, cols: wz, rows, openings: [] });
  return walls;
}

/**
 * Todas las paredes. Se elige el portón más ancho que deja al menos 1.000.000 de ladrillos,
 * y el sobrante se aplica como ladrillos ya caídos del muro viejo (daño inicial), así el total es EXACTO.
 */
export function buildWalls(): WallDef[] {
  const walls: WallDef[] = [];
  for (const b of BUILDINGS) walls.push(...buildingWalls(b, walls.length));
  const inBuildings = walls.reduce((a, w) => a + wallBrickCount(w), 0);
  let chosen: WallDef[] | null = null;
  let surplus = 0;
  for (let gate = 3000; gate >= 10; gate--) {
    const per = perimeterWalls(walls.length, gate);
    const n = inBuildings + per.reduce((a, w) => a + wallBrickCount(w), 0);
    if (n >= TOTAL_BRICKS) {
      chosen = per;
      surplus = n - TOTAL_BRICKS;
      break;
    }
  }
  if (!chosen) throw new Error('no alcanzan los ladrillos para llegar al millón');
  chosen[1].damage = surplus; // ladrillos sueltos (capa frontal) ya caídos en el muro del fondo
  return [...walls, ...chosen];
}

// ---------- Herramientas ----------
export type ToolId = 'martillo' | 'maza' | 'neumatico' | 'bola' | 'explosivos';
export const TOOL_ORDER: ToolId[] = ['martillo', 'maza', 'neumatico', 'bola', 'explosivos'];

export type UpgradeId =
  | 'martillo' | 'maza' | 'neumatico' | 'bola' | 'explosivos'
  | 'pala' | 'carretilla' | 'aspiradora' | 'precio' | 'obreros' | 'robots' | 'botas';

export interface UpgradeDef { id: UpgradeId; icon: string; max: number; startUnlocked: boolean; cost: (l: number) => number }
const geo = (base: number, g: number) => (l: number) => Math.round(base * Math.pow(g, l));

export const UPGRADES: UpgradeDef[] = [
  { id: 'martillo', icon: '🔨', max: 10, startUnlocked: true, cost: geo(15, 1.9) },
  { id: 'pala', icon: '🪏', max: 10, startUnlocked: true, cost: geo(20, 1.95) },
  { id: 'carretilla', icon: '🛒', max: 20, startUnlocked: true, cost: geo(25, 1.8) },
  { id: 'precio', icon: '💰', max: 20, startUnlocked: true, cost: geo(60, 2.15) },
  { id: 'botas', icon: '🥾', max: 8, startUnlocked: true, cost: geo(40, 2.2) },
  { id: 'maza', icon: '⚒️', max: 10, startUnlocked: false, cost: geo(150, 2.0) },
  { id: 'aspiradora', icon: '🌀', max: 10, startUnlocked: false, cost: geo(400, 2.0) },
  { id: 'neumatico', icon: '🛠️', max: 10, startUnlocked: false, cost: geo(1_500, 2.0) },
  { id: 'obreros', icon: '👷', max: 8, startUnlocked: false, cost: geo(3_000, 2.4) },
  { id: 'bola', icon: '🏗️', max: 10, startUnlocked: false, cost: geo(12_000, 2.1) },
  { id: 'robots', icon: '🤖', max: 8, startUnlocked: false, cost: geo(25_000, 2.3) },
  { id: 'explosivos', icon: '💥', max: 10, startUnlocked: false, cost: geo(60_000, 2.1) },
];

export type Levels = Record<UpgradeId, number>;
export function emptyLevels(): Levels {
  const l = {} as Levels;
  for (const u of UPGRADES) l[u.id] = u.startUnlocked && u.id === 'martillo' ? 1 : 0;
  return l;
}

export function stats(l: Levels) {
  return {
    // golpes
    hammerRate: 2.2 + 0.35 * l.martillo,
    hammerDepth: l.martillo >= 6 ? 2 : 1,
    sledgeRadius: 0.32 + 0.07 * l.maza,
    sledgeRate: 1.2 + 0.12 * l.maza,
    jackRadius: 0.2 + 0.035 * l.neumatico,
    jackRate: 10 + 1.2 * l.neumatico,
    ballRadius: 1.4 + 0.3 * l.bola,
    ballCooldown: Math.max(1.2, 4 - 0.25 * l.bola),
    bombRadius: 2.2 + 0.35 * l.explosivos,
    bombCharges: 1 + Math.floor(l.explosivos / 2),
    reach: 3.2,
    // escombros
    pickRadius: 1.4 + 0.3 * l.pala,
    pickRate: 6 + 2.5 * l.pala,
    capacity: Math.round(60 * Math.pow(1.38, l.carretilla)),
    vacuumRadius: l.aspiradora > 0 ? 4 + 0.8 * l.aspiradora : 0,
    price: 0.5 * Math.pow(1.2, l.precio),
    walk: 4.4 * (1 + 0.08 * l.botas),
    // automatización
    workers: l.obreros,
    workerCapacity: 150 + 40 * l.obreros,
    robots: l.robots,
  };
}
export type Stats = ReturnType<typeof stats>;

// ---------- Objetivos ----------
export type ObjectiveKind = 'broken' | 'deposited' | 'building' | 'all';
export interface Objective {
  kind: ObjectiveKind;
  target: number;
  building?: string;
  reward: { unlock?: UpgradeId; money: number };
}

export const OBJECTIVES: Objective[] = [
  { kind: 'broken', target: 30, reward: { money: 15 } },
  { kind: 'deposited', target: 120, reward: { unlock: 'maza', money: 40 } },
  { kind: 'building', building: 'garita', target: 1, reward: { unlock: 'aspiradora', money: 200 } },
  { kind: 'broken', target: 15_000, reward: { unlock: 'neumatico', money: 800 } },
  { kind: 'building', building: 'galpon', target: 1, reward: { unlock: 'obreros', money: 2_000 } },
  { kind: 'building', building: 'chimenea', target: 1, reward: { unlock: 'bola', money: 6_000 } },
  { kind: 'broken', target: 200_000, reward: { unlock: 'robots', money: 15_000 } },
  { kind: 'building', building: 'nave', target: 1, reward: { unlock: 'explosivos', money: 40_000 } },
  { kind: 'building', building: 'fabrica', target: 1, reward: { money: 80_000 } },
  { kind: 'building', building: 'torre', target: 1, reward: { money: 200_000 } },
  { kind: 'all', target: TOTAL_BRICKS, reward: { money: 0 } },
];

/** Un edificio se considera derribado cuando le queda menos de este porcentaje: el resto se desmorona solo. */
export const CRUMBLE_AT = 0.03;
