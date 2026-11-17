import type { UpgradeId, TrashTypeId, VehicleId } from './config';

const es = {
  title: 'Río Limpio',
  subtitle: 'Un millón de kilos de basura. Un río que quiere volver a vivir.',
  play: 'Jugar',
  continue: 'Continuar',
  newGame: 'Nueva partida',
  trashLeft: 'Basura en el río',
  items: 'objetos',
  clean: 'limpio',
  load: 'Carga',
  upgrades: 'Mejoras',
  settings: 'Ajustes',
  returnToPlant: 'Volver a la planta',
  full: '¡Bodega llena! Volvé a la planta',
  needCrane: 'Necesitás Grúa',
  needCapacity: 'Bodega chica: necesitás',
  level: 'Nivel',
  max: 'MÁX',
  music: 'Música',
  sfx: 'Sonido',
  quality: 'Gráficos',
  qualities: ['Bajos', 'Medios', 'Altos'],
  auto: 'Auto',
  language: 'Idioma',
  reset: 'Borrar progreso',
  resetConfirm: '¿Seguro? Se pierde todo el progreso.',
  yes: 'Sí, borrar',
  cancel: 'Cancelar',
  close: 'Cerrar',
  controlsDesktop: 'Mover: WASD / flechas · Mejoras: E · Volver: R',
  controlsMobile: 'Arrastrá en la pantalla para mover el bote',
  endTitle: '¡El río está vivo!',
  endText: 'Sacaste un millón de kilos de basura. Los peces, las ranas y los pájaros volvieron.',
  time: 'Tiempo',
  trips: 'Viajes',
  keepPlaying: 'Seguir navegando',
  reloadNeeded: 'Se aplica al recargar',
  objective: 'Objetivo',
  reward: 'Premio',
  newTool: '¡Nueva herramienta!',
  newVehicle: '¡Nuevo vehículo!',
  locked: 'Se desbloquea con un objetivo',
  craneByGoal: 'Sube con objetivos',
  gifts: { motor: 'Hélice turbo' } as Partial<Record<UpgradeId, string>>,
  riverTitle: 'Lo que queda en el río',
  remaining: 'quedan',
  ok: 'Genial',
  obj: {
    items: (n: string) => `Juntá ${n} objetos`,
    kg: (n: string) => `Sacá ${n} kg del río`,
    type: (n: string, what: string) => `Sacá ${n} ${what}`,
    all: () => 'Limpiá todo el río',
  },
  nature: {
    '0.1': 'Volvieron los peces',
    '0.25': 'Aparecen nenúfares y ranas',
    '0.5': 'Las aves regresan al río',
    '0.75': 'Las orillas se llenan de flores',
    '0.9': 'El agua está casi cristalina',
  } as Record<string, string>,
  bonus: 'Premio',
  up: {
    mano: ['Manos', 'Alcance al juntar a mano'],
    motor: ['Motor', 'Velocidad del vehículo'],
    bodega: ['Bodega', 'Capacidad de carga'],
    planta: ['Planta', 'Pago por kilo reciclado'],
    red: ['Red de pesca', 'Barre un área mucho más grande'],
    grua: ['Grúa', 'Levanta basura pesada'],
    iman: ['Imán gigante', 'Atrae latas, tambores, heladeras, autos y contenedores'],
    aspiradora: ['Aspiradora', 'Succiona bolsas, botellas y latas a distancia'],
    flota: ['Flota', 'Lanchas ayudantes automáticas'],
    drones: ['Drones', 'Vuelan, juntan basura liviana y la llevan a la planta'],
  } as Record<UpgradeId, [string, string]>,
  vehicles: {
    remo: ['Bote a remo', 'Lento y chico, pero honesto'],
    lancha: ['Lancha a motor', 'Mucho más rápida y con bodega más grande'],
    barcaza: ['Barcaza industrial', 'Bodega enorme: puede llevar contenedores y barcos hundidos'],
  } as Record<VehicleId, [string, string]>,
  trash: {
    lata: ['lata', 'latas'],
    bolsa: ['bolsa', 'bolsas'],
    botella: ['botella', 'botellas'],
    neumatico: ['neumático', 'neumáticos'],
    tambor: ['tambor', 'tambores'],
    heladera: ['heladera', 'heladeras'],
    auto: ['auto', 'autos'],
    contenedor: ['contenedor', 'contenedores'],
    barco: ['barco hundido', 'barcos hundidos'],
  } as Record<TrashTypeId, [string, string]>,
  craneTiers: ['A mano', 'Neumáticos', 'Tambores', 'Heladeras', 'Autos', 'Contenedores', 'Barcos hundidos'],
};

const en: typeof es = {
  title: 'Clean River',
  subtitle: 'One million kilos of trash. A river that wants to live again.',
  play: 'Play',
  continue: 'Continue',
  newGame: 'New game',
  trashLeft: 'Trash in the river',
  items: 'items',
  clean: 'clean',
  load: 'Load',
  upgrades: 'Upgrades',
  settings: 'Settings',
  returnToPlant: 'Return to plant',
  full: 'Hold full! Head back to the plant',
  needCrane: 'Requires Crane',
  needCapacity: 'Hold too small: you need',
  level: 'Level',
  max: 'MAX',
  music: 'Music',
  sfx: 'Sound',
  quality: 'Graphics',
  qualities: ['Low', 'Medium', 'High'],
  auto: 'Auto',
  language: 'Language',
  reset: 'Reset progress',
  resetConfirm: 'Are you sure? All progress will be lost.',
  yes: 'Yes, delete',
  cancel: 'Cancel',
  close: 'Close',
  controlsDesktop: 'Move: WASD / arrows · Upgrades: E · Return: R',
  controlsMobile: 'Drag anywhere to steer the boat',
  endTitle: 'The river is alive!',
  endText: 'You removed one million kilos of trash. The fish, frogs and birds are back.',
  time: 'Time',
  trips: 'Trips',
  keepPlaying: 'Keep sailing',
  reloadNeeded: 'Applies after reload',
  objective: 'Goal',
  reward: 'Reward',
  newTool: 'New tool!',
  newVehicle: 'New vehicle!',
  locked: 'Unlocked by a goal',
  craneByGoal: 'Upgrades with goals',
  gifts: { motor: 'Turbo propeller' },
  riverTitle: 'What is left in the river',
  remaining: 'left',
  ok: 'Great',
  obj: {
    items: (n: string) => `Collect ${n} items`,
    kg: (n: string) => `Remove ${n} kg from the river`,
    type: (n: string, what: string) => `Remove ${n} ${what}`,
    all: () => 'Clean the whole river',
  },
  nature: {
    '0.1': 'The fish are back',
    '0.25': 'Lily pads and frogs appear',
    '0.5': 'The birds return to the river',
    '0.75': 'The banks bloom with flowers',
    '0.9': 'The water is almost crystal clear',
  },
  bonus: 'Bonus',
  up: {
    mano: ['Hands', 'Reach when picking by hand'],
    motor: ['Engine', 'Vehicle speed'],
    bodega: ['Hold', 'Cargo capacity'],
    planta: ['Plant', 'Pay per recycled kilo'],
    red: ['Fishing net', 'Sweeps a much bigger area'],
    grua: ['Crane', 'Lifts heavy trash'],
    iman: ['Giant magnet', 'Pulls cans, barrels, fridges, cars and containers'],
    aspiradora: ['Vacuum', 'Sucks in bags, bottles and cans from afar'],
    flota: ['Fleet', 'Automatic helper boats'],
    drones: ['Drones', 'Fly, grab light trash and carry it to the plant'],
  },
  vehicles: {
    remo: ['Rowboat', 'Slow and small, but honest'],
    lancha: ['Motorboat', 'Much faster, with a bigger hold'],
    barcaza: ['Industrial barge', 'Huge hold: carries containers and sunken boats'],
  },
  trash: {
    lata: ['can', 'cans'],
    bolsa: ['bag', 'bags'],
    botella: ['bottle', 'bottles'],
    neumatico: ['tire', 'tires'],
    tambor: ['barrel', 'barrels'],
    heladera: ['fridge', 'fridges'],
    auto: ['car', 'cars'],
    contenedor: ['container', 'containers'],
    barco: ['sunken boat', 'sunken boats'],
  },
  craneTiers: ['By hand', 'Tires', 'Barrels', 'Fridges', 'Cars', 'Containers', 'Sunken boats'],
};

export type Lang = 'es' | 'en';
export const dict = { es, en };
export let lang: Lang = (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en';
export function setLang(l: Lang) {
  lang = l;
}
export function t() {
  return dict[lang];
}

export function fmt(n: number, decimals = 0): string {
  const loc = lang === 'es' ? 'es-AR' : 'en-US';
  if (Math.abs(n) >= 1e6) {
    return new Intl.NumberFormat(loc, { maximumFractionDigits: 2 }).format(n / 1e6) + ' M';
  }
  return new Intl.NumberFormat(loc, { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(n);
}
export function fmtInt(n: number): string {
  return new Intl.NumberFormat(lang === 'es' ? 'es-AR' : 'en-US', { maximumFractionDigits: 0 }).format(Math.round(n));
}
export function fmtKg(n: number): string {
  return fmtInt(Math.max(0, Math.round(n))) + ' kg';
}
export function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s.toString().padStart(2, '0')}s`;
}
