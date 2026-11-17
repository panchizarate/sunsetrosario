// El Penthouse — configuración: planta, zonas, categorías de objetos, mejoras.

// ---------- Planta (metros) ----------
// Planta baja y=0, entrepiso y=MEZZ (cubre z>0). La parte z<0 es doble altura con ventanales.
export const B = { x0: -20, x1: 20, z0: -12, z1: 12 };
export const MEZZ = 4.5;
export const CEIL = 9;
export const SPAWN = { x: -17.5, y: 0, z: 4.5, yaw: Math.PI * 0.62 };
// escalera de vidrio (en el living): sube de x=-6 (y=0) a x=-15 (y=MEZZ), franja z∈[-2.4,-0.6]
export const STAIRS = { xStart: -6, xEnd: -15, z0: -2.4, z1: -0.6 };
export const LANDING = { x0: -19.6, x1: -15, z0: -2.4, z1: 0 };
export const TERRACE = { x0: 20, x1: 31, z0: -12, z1: 3 };
export const SECRET = { x0: -8.5, x1: -2.5, z0: 12, z1: 17 };

export type ZoneId = 'living' | 'bar' | 'vestidor' | 'juegos' | 'terraza' | 'secreta';
export interface Zone { id: ZoneId; name: string; level: 0 | 1; rect: [number, number, number, number]; neon: string }
export const ZONES: Zone[] = [
  { id: 'living', name: 'Living', level: 0, rect: [-19.6, -0.4, -11.6, 11.6], neon: '#b06bff' },
  { id: 'bar', name: 'Bar & Casino', level: 0, rect: [0.4, 19.6, -11.6, 11.6], neon: '#ffb347' },
  { id: 'vestidor', name: 'Vestidor', level: 1, rect: [-19.6, -0.4, 0.3, 11.6], neon: '#ff4fa3' },
  { id: 'juegos', name: 'Sala de Juegos', level: 1, rect: [0.4, 19.6, 0.3, 11.6], neon: '#2ee6ff' },
  { id: 'terraza', name: 'Terraza', level: 0, rect: [TERRACE.x0 + 0.4, TERRACE.x1 - 0.4, TERRACE.z0 + 0.4, TERRACE.z1 - 0.4], neon: '#7dffb0' },
  { id: 'secreta', name: '???', level: 0, rect: [SECRET.x0 + 0.3, SECRET.x1 - 0.3, SECRET.z0 + 0.3, SECRET.z1 - 0.3], neon: '#ff2a2a' },
];
export const ZONE_ORDER: ZoneId[] = ['living', 'bar', 'vestidor', 'juegos', 'terraza', 'secreta'];

// ---------- Categorías de objetos ----------
// Cada categoría tiene subcategorías (variantes). Cada subcategoría tiene su propia sección en un mueble.
export type ItemKind = 'libro' | 'almohadon' | 'jarron' | 'escultura' | 'vela' | 'botella' | 'copa' | 'prenda' | 'zapatilla' | 'gorra' | 'figura';
export interface Variant { id: string; name: string; color: string; color2?: string }
export interface Category { kind: ItemKind; zone: ZoneId; name: string; perVariant: number; variants: Variant[]; material: 'papel' | 'tela' | 'ceramica' | 'vidrio' | 'cuero' | 'plastico' }

export const CATEGORIES: Category[] = [
  {
    kind: 'libro', zone: 'living', name: 'Libros', perVariant: 64, material: 'papel',
    variants: [
      { id: 'rojo', name: 'Rojos', color: '#c2312f' }, { id: 'naranja', name: 'Naranjas', color: '#e07a2e' },
      { id: 'amarillo', name: 'Amarillos', color: '#e8c33a' }, { id: 'verde', name: 'Verdes', color: '#2f8f5b' },
      { id: 'azul', name: 'Azules', color: '#2d5fb8' }, { id: 'negro', name: 'Negros', color: '#22232a' },
    ],
  },
  {
    kind: 'almohadon', zone: 'living', name: 'Almohadones', perVariant: 12, material: 'tela',
    variants: [
      { id: 'terracota', name: 'Terracota', color: '#b5583c' }, { id: 'salvia', name: 'Salvia', color: '#8fa58a' }, { id: 'arena', name: 'Arena', color: '#d9c7a8' },
    ],
  },
  { kind: 'jarron', zone: 'living', name: 'Jarrones', perVariant: 60, material: 'ceramica', variants: [{ id: 'jarron', name: 'Jarrones', color: '#e9e4da' }] },
  { kind: 'escultura', zone: 'living', name: 'Esculturas', perVariant: 60, material: 'ceramica', variants: [{ id: 'escultura', name: 'Esculturas', color: '#c9a45c' }] },
  { kind: 'vela', zone: 'living', name: 'Velas', perVariant: 60, material: 'ceramica', variants: [{ id: 'vela', name: 'Velas', color: '#f3eadb' }] },
  {
    kind: 'botella', zone: 'bar', name: 'Botellas', perVariant: 60, material: 'vidrio',
    variants: [
      { id: 'vino', name: 'Vinos', color: '#4a0f1a' }, { id: 'whisky', name: 'Whiskys', color: '#b8692a' },
      { id: 'gin', name: 'Gins', color: '#9fd8e8' }, { id: 'champagne', name: 'Champagnes', color: '#2d3b22' }, { id: 'vodka', name: 'Vodkas', color: '#e8eef2' },
    ],
  },
  {
    kind: 'copa', zone: 'bar', name: 'Copas y vasos', perVariant: 50, material: 'vidrio',
    variants: [
      { id: 'copavino', name: 'Copas de vino', color: '#dfeef2' }, { id: 'flauta', name: 'Flautas', color: '#e6f0e0' },
      { id: 'bajo', name: 'Vasos bajos', color: '#e8eef5' }, { id: 'alto', name: 'Vasos altos', color: '#e4ecf2' },
    ],
  },
  {
    kind: 'prenda', zone: 'vestidor', name: 'Ropa', perVariant: 75, material: 'tela',
    variants: [
      { id: 'blanco', name: 'Blancos', color: '#efefea' }, { id: 'beige', name: 'Beige', color: '#cdb38f' },
      { id: 'rosa', name: 'Rosas', color: '#e58fb0' }, { id: 'rojo', name: 'Rojos', color: '#b8262e' },
      { id: 'verde', name: 'Verdes', color: '#3f7a52' }, { id: 'celeste', name: 'Celestes', color: '#7db7e0' },
      { id: 'azul', name: 'Azules', color: '#22356b' }, { id: 'negro', name: 'Negros', color: '#1a1a1e' },
    ],
  },
  {
    kind: 'zapatilla', zone: 'vestidor', name: 'Zapatillas', perVariant: 50, material: 'cuero',
    variants: [
      { id: 'velox', name: 'Velox', color: '#f2f2f2', color2: '#e8452c' }, { id: 'nimbus', name: 'Nimbus', color: '#1d1f24', color2: '#2ee6ff' },
      { id: 'aurea', name: 'Aurea', color: '#f4efe4', color2: '#c9a45c' }, { id: 'kaze', name: 'Kaze', color: '#3a6bd6', color2: '#ffffff' },
      { id: 'brava', name: 'Brava', color: '#d6283a', color2: '#1a1a1a' }, { id: 'mono', name: 'Mono', color: '#8a8f96', color2: '#b6ff3a' },
    ],
  },
  {
    kind: 'gorra', zone: 'vestidor', name: 'Gorras', perVariant: 50, material: 'tela',
    variants: [
      { id: 'negra', name: 'Negras', color: '#1b1b1f' }, { id: 'blanca', name: 'Blancas', color: '#ecebe6' }, { id: 'roja', name: 'Rojas', color: '#c0262f' },
      { id: 'azul', name: 'Azules', color: '#264a9a' }, { id: 'verde', name: 'Verdes', color: '#2f6b48' }, { id: 'rosa', name: 'Rosas', color: '#e48db0' },
    ],
  },
  {
    kind: 'figura', zone: 'juegos', name: 'Figuras', perVariant: 100, material: 'plastico',
    variants: [
      { id: 'robots', name: 'Robots', color: '#9aa6b8' }, { id: 'dinos', name: 'Dinos', color: '#5fae4a' }, { id: 'astro', name: 'Astronautas', color: '#f2f2f2' },
      { id: 'ninjas', name: 'Ninjas', color: '#2b2b33' }, { id: 'monstruos', name: 'Monstruos', color: '#8e44ad' }, { id: 'heroes', name: 'Héroes', color: '#d63a3a' },
      { id: 'gatos', name: 'Gatos', color: '#f0a33a' },
    ],
  },
];
export const TOTAL_ITEMS = CATEGORIES.reduce((a, c) => a + c.perVariant * c.variants.length, 0); // 3.000

// ---------- Mejoras ----------
export type UpgradeId = 'manos' | 'velocidad' | 'agarre' | 'iman' | 'escaner' | 'ayudantes' | 'combo';
export interface UpgradeDef { id: UpgradeId; icon: string; name: string; desc: string; max: number; cost: (l: number) => number }
const geo = (b: number, g: number) => (l: number) => Math.round(b * Math.pow(g, l));
export const UPGRADES: UpgradeDef[] = [
  { id: 'manos', icon: '🤲', name: 'Manos', desc: 'Llevás más objetos a la vez', max: 9, cost: geo(80, 1.85) },
  { id: 'velocidad', icon: '👟', name: 'Velocidad', desc: 'Caminás y corrés más rápido', max: 6, cost: geo(140, 2.0) },
  { id: 'agarre', icon: '✋', name: 'Agarre rápido', desc: 'Juntás varios iguales de un toque', max: 6, cost: geo(220, 2.05) },
  { id: 'iman', icon: '🧲', name: 'Imán', desc: 'Los objetos iguales flotan hacia vos', max: 6, cost: geo(700, 2.0) },
  { id: 'escaner', icon: '📡', name: 'Escáner', desc: 'Resalta a dónde va y los iguales', max: 3, cost: geo(450, 2.8) },
  { id: 'ayudantes', icon: '🤖', name: 'Robots ayudantes', desc: 'Ordenan solos', max: 6, cost: geo(3000, 2.1) },
  { id: 'combo', icon: '🔥', name: 'Combo', desc: 'Las rachas sin errores pagan más', max: 5, cost: geo(500, 2.2) },
];
export type Levels = Record<UpgradeId, number>;
export const emptyLevels = (): Levels => ({ manos: 0, velocidad: 0, agarre: 0, iman: 0, escaner: 0, ayudantes: 0, combo: 0 });

export function stats(l: Levels) {
  return {
    hands: [3, 4, 5, 7, 9, 11, 13, 15, 17, 20][l.manos],
    walk: 3.6 * (1 + 0.1 * l.velocidad),
    run: 6.2 * (1 + 0.1 * l.velocidad),
    grabExtra: [0, 1, 2, 3, 5, 7, 9][l.agarre],
    grabRadius: 1.2 + 0.25 * l.agarre,
    magnet: l.iman > 0 ? 1.5 + 0.6 * l.iman : 0,
    scanner: l.escaner,
    helpers: l.ayudantes,
    helperRate: 0.07 + 0.02 * l.ayudantes, // objetos/s por robot
    comboStep: 0.05 + 0.03 * l.combo,
    comboMax: 1.5 + 0.3 * l.combo,
    reach: 3.4,
  };
}
export type Stats = ReturnType<typeof stats>;
export const ITEM_PAY = 6;
export const SHELF_BONUS = 60;
export const ZONE_BONUS = [500, 1500, 4000, 9000];
export const TOKENS_FOR_SECRET = 3;
