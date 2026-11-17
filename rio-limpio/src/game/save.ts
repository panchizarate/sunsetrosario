import { emptyLevels, Levels, TOTAL_KG } from './config';
import type { Lang } from './i18n';

export interface Settings {
  music: number;
  sfx: number;
  high: boolean | null; // null = automático
  lang: Lang | null;
}

export interface SaveData {
  v: 1;
  money: number;
  remaining: number;
  levels: Levels;
  milestones: number[];
  trips: number;
  kgTotal: number;
  playTime: number;
  finished: boolean;
  boat: { x: number; z: number; h: number; load?: number };
  savedAt: number;
}

const KEY = 'rioLimpio.save.v1';
const SKEY = 'rioLimpio.settings.v1';

export function newSave(): SaveData {
  return {
    v: 1,
    money: 0,
    remaining: TOTAL_KG,
    levels: emptyLevels(),
    milestones: [],
    trips: 0,
    kgTotal: 0,
    playTime: 0,
    finished: false,
    boat: { x: -18, z: 0, h: Math.PI / 2 },
    savedAt: Date.now(),
  };
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d.v !== 1) return null;
    d.levels = { ...emptyLevels(), ...d.levels };
    return d;
  } catch {
    return null;
  }
}

export function writeSave(d: SaveData) {
  try {
    d.savedAt = Date.now();
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
  const def: Settings = { music: 0.6, sfx: 0.9, high: null, lang: null };
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
