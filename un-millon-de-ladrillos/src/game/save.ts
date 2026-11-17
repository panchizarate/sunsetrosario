import { emptyLevels, Levels, UPGRADES, UpgradeId, SPAWN } from './config';
import type { Lang } from './i18n';

export interface Settings {
  music: number;
  sfx: number;
  sens: number;
  quality: 0 | 1 | 2 | null;
  lang: Lang | null;
}

export interface SaveData {
  v: 1;
  money: number;
  levels: Levels;
  unlocked: UpgradeId[];
  objective: number;
  broken: number;
  deposited: number;
  carried: number;
  trips: number;
  playTime: number;
  finished: boolean;
  player: { x: number; z: number; yaw: number };
  walls: string[];
  debris: number[];
}

const KEY = 'ladrillos.save.v1';
const SKEY = 'ladrillos.settings.v1';

export function newSave(): SaveData {
  return {
    v: 1,
    money: 0,
    levels: emptyLevels(),
    unlocked: UPGRADES.filter((u) => u.startUnlocked).map((u) => u.id),
    objective: 0,
    broken: 0,
    deposited: 0,
    carried: 0,
    trips: 0,
    playTime: 0,
    finished: false,
    player: { x: SPAWN.x, z: SPAWN.z, yaw: 0 },
    walls: [],
    debris: [],
  };
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d.v !== 1) return null;
    return { ...newSave(), ...d, levels: { ...emptyLevels(), ...d.levels } };
  } catch {
    return null;
  }
}
export function writeSave(d: SaveData) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* sin almacenamiento */ }
}
export function clearSave() {
  try { localStorage.removeItem(KEY); } catch { /* nada */ }
}
export function loadSettings(): Settings {
  const def: Settings = { music: 0.5, sfx: 0.9, sens: 1, quality: null, lang: null };
  try {
    const raw = localStorage.getItem(SKEY);
    return raw ? { ...def, ...JSON.parse(raw) } : def;
  } catch {
    return def;
  }
}
export function writeSettings(s: Settings) {
  try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch { /* nada */ }
}
