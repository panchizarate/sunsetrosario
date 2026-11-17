import { emptyLevels, Levels, UPGRADES, UpgradeId, VehicleId } from './config';
import type { Lang } from './i18n';

export interface Settings {
  music: number;
  sfx: number;
  quality: 0 | 1 | 2 | null; // null = automático
  lang: Lang | null;
}

export interface SaveData {
  v: 2;
  money: number;
  levels: Levels;
  unlocked: UpgradeId[];
  vehicle: VehicleId;
  objective: number; // índice del objetivo actual
  collected: string; // bitset (base64) de ids de basura ya juntados
  itemsTotal: number;
  kgTotal: number;
  byType: Record<string, number>;
  nature: number[];
  trips: number;
  playTime: number;
  finished: boolean;
  boat: { x: number; z: number; h: number; load: number; value: number };
}

const KEY = 'rioLimpio.save.v2';
const SKEY = 'rioLimpio.settings.v2';

export function newSave(): SaveData {
  return {
    v: 2,
    money: 0,
    levels: emptyLevels(),
    unlocked: UPGRADES.filter((u) => u.startUnlocked).map((u) => u.id),
    vehicle: 'remo',
    objective: 0,
    collected: '',
    itemsTotal: 0,
    kgTotal: 0,
    byType: {},
    nature: [],
    trips: 0,
    playTime: 0,
    finished: false,
    boat: { x: -18, z: 0, h: Math.PI / 2, load: 0, value: 0 },
  };
}

export function encodeIds(ids: number[], total: number): string {
  const bytes = new Uint8Array(Math.ceil(total / 8));
  for (const id of ids) bytes[id >> 3] |= 1 << (id & 7);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
export function decodeIds(s: string): Set<number> {
  const out = new Set<number>();
  if (!s) return out;
  try {
    const bin = atob(s);
    for (let i = 0; i < bin.length; i++) {
      const b = bin.charCodeAt(i);
      for (let k = 0; k < 8; k++) if (b & (1 << k)) out.add(i * 8 + k);
    }
  } catch {
    /* guardado corrupto: se ignora */
  }
  return out;
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d.v !== 2) return null;
    return { ...newSave(), ...d, levels: { ...emptyLevels(), ...d.levels } };
  } catch {
    return null;
  }
}

export function writeSave(d: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* almacenamiento no disponible: se juega sin guardar */
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nada */
  }
}

export function loadSettings(): Settings {
  const def: Settings = { music: 0.6, sfx: 0.9, quality: null, lang: null };
  try {
    const raw = localStorage.getItem(SKEY);
    return raw ? { ...def, ...JSON.parse(raw) } : def;
  } catch {
    return def;
  }
}

export function writeSettings(s: Settings) {
  try {
    localStorage.setItem(SKEY, JSON.stringify(s));
  } catch {
    /* nada */
  }
}
