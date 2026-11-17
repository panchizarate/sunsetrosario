// Configuración central del juego: economía, tipos de basura y forma del río.
// Todo lo que haya que balancear está acá.

export const TOTAL_KG = 1_000_000;

// ---------- Forma del río (la misma fórmula se usa en el shader del agua) ----------
export const RIVER = {
  xMin: -165,
  xMax: 165,
  flow: 0.55, // m/s hacia +x
};

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

// ---------- Tipos de basura ----------
export type TrashTypeId =
  | 'lata'
  | 'bolsa'
  | 'botella'
  | 'neumatico'
  | 'tambor'
  | 'heladera'
  | 'auto'
  | 'contenedor';

export interface TrashType {
  id: TrashTypeId;
  kg: number;
  tier: number; // nivel de grúa necesario
  weight: number; // probabilidad relativa de aparición
  max: number; // máximo simultáneo en pantalla (desktop)
  radius: number; // tamaño físico aprox. (para recolección)
  material: 'metal' | 'plastico' | 'vidrio' | 'goma' | 'pesado';
}

export const TRASH_TYPES: TrashType[] = [
  { id: 'lata', kg: 2.5, tier: 0, weight: 30, max: 400, radius: 0.35, material: 'metal' },
  { id: 'bolsa', kg: 3.5, tier: 0, weight: 30, max: 400, radius: 0.5, material: 'plastico' },
  { id: 'botella', kg: 5, tier: 0, weight: 30, max: 400, radius: 0.4, material: 'vidrio' },
  { id: 'neumatico', kg: 25, tier: 1, weight: 7, max: 60, radius: 0.9, material: 'goma' },
  { id: 'tambor', kg: 90, tier: 2, weight: 3.5, max: 30, radius: 1.0, material: 'pesado' },
  { id: 'heladera', kg: 320, tier: 3, weight: 1.6, max: 16, radius: 1.3, material: 'pesado' },
  { id: 'auto', kg: 1500, tier: 4, weight: 0.6, max: 7, radius: 2.4, material: 'pesado' },
  { id: 'contenedor', kg: 6000, tier: 5, weight: 0.25, max: 4, radius: 3.2, material: 'pesado' },
];

// ---------- Mejoras ----------
export type UpgradeId =
  | 'red'
  | 'motor'
  | 'bodega'
  | 'grua'
  | 'planta'
  | 'flota'
  | 'barreras'
  | 'rastra';

export interface UpgradeDef {
  id: UpgradeId;
  icon: string;
  max: number;
  cost: (level: number) => number; // costo para pasar de level a level+1
}

const geo = (base: number, g: number) => (l: number) => Math.round(base * Math.pow(g, l));

export const UPGRADES: UpgradeDef[] = [
  { id: 'red', icon: '🕸️', max: 15, cost: geo(12, 1.78) },
  { id: 'motor', icon: '⚙️', max: 15, cost: geo(18, 1.8) },
  { id: 'bodega', icon: '📦', max: 25, cost: geo(15, 1.72) },
  {
    id: 'grua',
    icon: '🏗️',
    max: 5,
    cost: (l) => [300, 4_500, 70_000, 1_500_000, 12_000_000][l] ?? Infinity,
  },
  { id: 'planta', icon: '♻️', max: 20, cost: geo(60, 2.25) },
  { id: 'flota', icon: '🚤', max: 6, cost: geo(2_500, 6.2) },
  { id: 'barreras', icon: '🟨', max: 18, cost: geo(1_500, 2.7) },
  { id: 'rastra', icon: '⚓', max: 15, cost: geo(250, 2.3) },
];

export type Levels = Record<UpgradeId, number>;

export function emptyLevels(): Levels {
  return { red: 0, motor: 0, bodega: 0, grua: 0, planta: 0, flota: 0, barreras: 0, rastra: 0 };
}

// ---------- Estadísticas derivadas ----------
export function stats(l: Levels) {
  return {
    radius: 2.4 + 0.42 * l.red,
    speed: 6.5 + 0.95 * l.motor,
    capacity: Math.round(40 * Math.pow(1.43, l.bodega)),
    tier: l.grua,
    pricePerKg: Math.pow(1.25, l.planta),
    helpers: l.flota,
    barrierKgPerSec: l.barreras === 0 ? 0 : 2 * Math.pow(1.55, l.barreras - 1),
    kgMult: 1 + 0.2 * l.rastra,
  };
}
export type Stats = ReturnType<typeof stats>;

// Hitos de limpieza (fracción limpia) -> cambios en el mundo
export const MILESTONES = [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 1];
export function milestoneBonus(m: number): number {
  return Math.round(40 * Math.pow(10, Math.max(0, MILESTONES.indexOf(m)) * 0.45));
}
