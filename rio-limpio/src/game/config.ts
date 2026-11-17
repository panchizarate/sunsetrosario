// Configuración central: inventario de basura, herramientas, vehículos y objetivos.
// Todo lo que haya que balancear está acá.

// ---------- Forma del río (la misma fórmula se usa en el shader del agua) ----------
export const RIVER = { xMin: -165, xMax: 165 };

export function riverCenter(x: number): number {
  return 14 * Math.sin(x * 0.018) + 6 * Math.sin(x * 0.047 + 1.3);
}
export function riverHalfWidth(x: number): number {
  return 34 + 7 * Math.sin(x * 0.031 + 0.5);
}
/** Distancia con signo a la orilla: negativa dentro del agua, positiva en tierra. */
export function bankDistance(x: number, z: number): number {
  return Math.abs(z - riverCenter(x)) - riverHalfWidth(x);
}

// ---------- Planta de reciclaje ----------
export const PLANT_X = -18;
export function plantDock(): { x: number; z: number } {
  const x = PLANT_X;
  return { x, z: riverCenter(x) - riverHalfWidth(x) + 7 };
}
export const DOCK_RADIUS = 7.5;

// ---------- Inventario de basura ----------
// El río tiene una cantidad FIJA de objetos, todos visibles desde el inicio.
// La suma de (kg × cantidad) es exactamente TOTAL_KG.
export type TrashTypeId =
  | 'lata' | 'bolsa' | 'botella' | 'neumatico' | 'tambor' | 'heladera' | 'auto' | 'contenedor' | 'barco';

export type Material = 'metal' | 'plastico' | 'vidrio' | 'goma' | 'pesado';

export interface TrashType {
  id: TrashTypeId;
  kg: number;
  count: number;
  tier: number; // nivel de grúa necesario (0 = a mano)
  radius: number; // tamaño físico aprox.
  material: Material;
  value: number; // multiplicador de pago por kg
  magnetic: boolean; // lo atrae el imán
  suckable: boolean; // lo atrae la aspiradora
  far: number; // 0..1 preferencia por estar lejos de la planta
}

export const TRASH_TYPES: TrashType[] = [
  { id: 'lata', kg: 2, count: 1200, tier: 0, radius: 0.35, material: 'metal', value: 2.0, magnetic: true, suckable: true, far: 0 },
  { id: 'bolsa', kg: 3, count: 1200, tier: 0, radius: 0.5, material: 'plastico', value: 1.4, magnetic: false, suckable: true, far: 0 },
  { id: 'botella', kg: 4, count: 1200, tier: 0, radius: 0.4, material: 'vidrio', value: 1.6, magnetic: false, suckable: true, far: 0 },
  { id: 'neumatico', kg: 40, count: 300, tier: 1, radius: 0.9, material: 'goma', value: 1.2, magnetic: false, suckable: false, far: 0.2 },
  { id: 'tambor', kg: 150, count: 160, tier: 2, radius: 1.0, material: 'metal', value: 1.0, magnetic: true, suckable: false, far: 0.35 },
  { id: 'heladera', kg: 400, count: 90, tier: 3, radius: 1.3, material: 'pesado', value: 0.9, magnetic: true, suckable: false, far: 0.5 },
  { id: 'auto', kg: 2500, count: 80, tier: 4, radius: 2.4, material: 'pesado', value: 0.8, magnetic: true, suckable: false, far: 0.65 },
  { id: 'contenedor', kg: 10000, count: 40, tier: 5, radius: 3.4, material: 'pesado', value: 0.7, magnetic: true, suckable: false, far: 0.8 },
  // los 4 barcos hundidos completan el millón exacto
  { id: 'barco', kg: 79_300, count: 4, tier: 6, radius: 7, material: 'pesado', value: 0.6, magnetic: false, suckable: false, far: 1 },
];

export const TOTAL_KG = TRASH_TYPES.reduce((a, t) => a + t.kg * t.count, 0); // = 1.000.000
export const TOTAL_ITEMS = TRASH_TYPES.reduce((a, t) => a + t.count, 0);
export const typeById = (id: TrashTypeId) => TRASH_TYPES.find((t) => t.id === id)!;

// ---------- Vehículos ----------
export type VehicleId = 'remo' | 'lancha' | 'barcaza';
export const VEHICLES: Record<VehicleId, { speed: number; capacity: number }> = {
  remo: { speed: 4.6, capacity: 20 },
  lancha: { speed: 8, capacity: 90 },
  barcaza: { speed: 7, capacity: 3000 },
};

// ---------- Mejoras / herramientas ----------
export type UpgradeId =
  | 'mano' | 'motor' | 'bodega' | 'planta' | 'red' | 'grua' | 'iman' | 'aspiradora' | 'flota' | 'drones';

export interface UpgradeDef {
  id: UpgradeId;
  icon: string;
  max: number;
  startUnlocked: boolean;
  cost: (level: number) => number; // costo para pasar de level a level+1
}

const geo = (base: number, g: number) => (l: number) => Math.round(base * Math.pow(g, l));

export const UPGRADES: UpgradeDef[] = [
  { id: 'mano', icon: '✋', max: 5, startUnlocked: true, cost: geo(15, 2.1) },
  { id: 'motor', icon: '⚙️', max: 12, startUnlocked: true, cost: geo(40, 2.15) },
  { id: 'bodega', icon: '📦', max: 25, startUnlocked: true, cost: geo(40, 1.95) },
  { id: 'planta', icon: '♻️', max: 20, startUnlocked: true, cost: geo(150, 2.35) },
  { id: 'red', icon: '🕸️', max: 12, startUnlocked: false, cost: geo(120, 2.2) },
  // la grúa NO se compra: sube con los objetivos (así nunca te quedás trabado sin poder avanzar)
  { id: 'grua', icon: '🏗️', max: 6, startUnlocked: false, cost: () => Infinity },
  { id: 'iman', icon: '🧲', max: 10, startUnlocked: false, cost: geo(4_000, 2.3) },
  { id: 'aspiradora', icon: '🌀', max: 10, startUnlocked: false, cost: geo(7_000, 2.3) },
  { id: 'flota', icon: '🚤', max: 6, startUnlocked: false, cost: geo(20_000, 3.0) },
  { id: 'drones', icon: '🛸', max: 8, startUnlocked: false, cost: geo(40_000, 2.5) },
];

export type Levels = Record<UpgradeId, number>;
export function emptyLevels(): Levels {
  return { mano: 0, motor: 0, bodega: 0, planta: 0, red: 0, grua: 0, iman: 0, aspiradora: 0, flota: 0, drones: 0 };
}

// ---------- Objetivos (en orden). Cada uno regala algo nuevo. ----------
export type ObjectiveKind = 'items' | 'kg' | 'type' | 'all';
export interface Objective {
  kind: ObjectiveKind;
  target: number;
  type?: TrashTypeId;
  reward: { unlock?: UpgradeId; vehicle?: VehicleId; level?: number; crane?: number; gift?: UpgradeId; giftLevels?: number; money: number };
}

export const OBJECTIVES: Objective[] = [
  { kind: 'items', target: 25, reward: { unlock: 'red', level: 1, money: 30 } },
  { kind: 'kg', target: 400, reward: { vehicle: 'lancha', money: 80 } },
  { kind: 'items', target: 600, reward: { unlock: 'grua', crane: 1, money: 300 } },
  { kind: 'type', type: 'neumatico', target: 30, reward: { unlock: 'iman', level: 1, crane: 2, money: 800 } },
  { kind: 'items', target: 1_200, reward: { gift: 'motor', giftLevels: 2, money: 1_000 } },
  { kind: 'kg', target: 20_000, reward: { unlock: 'flota', level: 1, money: 1_500 } },
  { kind: 'type', type: 'tambor', target: 70, reward: { unlock: 'aspiradora', level: 1, crane: 3, money: 3_000 } },
  { kind: 'type', type: 'heladera', target: 45, reward: { unlock: 'drones', level: 1, crane: 4, money: 8_000 } },
  { kind: 'type', type: 'auto', target: 30, reward: { vehicle: 'barcaza', crane: 5, money: 25_000 } },
  { kind: 'type', type: 'contenedor', target: 40, reward: { crane: 6, money: 150_000 } },
  { kind: 'all', target: TOTAL_KG, reward: { money: 0 } },
];

// ---------- Estadísticas derivadas ----------
export function stats(l: Levels, vehicle: VehicleId) {
  const v = VEHICLES[vehicle];
  const hand = 1.3 + 0.18 * l.mano;
  const net = l.red > 0 ? 2.4 + 0.22 * (l.red - 1) : 0;
  return {
    radius: Math.max(hand, net),
    // objetos por segundo que entran al bote (uno detrás de otro)
    pickRate: l.red > 0 ? 2.4 + 0.3 * (l.red - 1) : 1.5 + 0.2 * l.mano,
    speed: v.speed * (1 + 0.06 * l.motor),
    capacity: Math.round(v.capacity * Math.pow(1.25, l.bodega)),
    tier: l.grua,
    pricePerKg: Math.pow(1.15, l.planta),
    magnetRadius: l.iman > 0 ? 6 + 1.0 * (l.iman - 1) : 0,
    suctionRadius: l.aspiradora > 0 ? 5 + 0.9 * (l.aspiradora - 1) : 0,
    pullSpeed: 4 + 0.4 * Math.max(l.iman, l.aspiradora),
    helpers: l.flota,
    drones: l.drones,
    droneCapacity: 10,
  };
}
export type Stats = ReturnType<typeof stats>;

/** Hitos de "naturaleza" (según limpieza visual): solo cambian el mundo y dan un premio chico. */
export const NATURE = [0.1, 0.25, 0.5, 0.75, 0.9];

/** Segundos que tarda la grúa en izar cada clase de basura (el bote queda quieto mientras tanto). */
export const LIFT_TIME = [0, 0.7, 1.4, 2.4, 4, 7, 18];
