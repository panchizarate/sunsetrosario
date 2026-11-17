import type { UpgradeId } from './config';

const es = {
  title: 'Río Limpio',
  subtitle: 'Un millón de kilos de basura. Un río que quiere volver a vivir.',
  play: 'Jugar',
  continue: 'Continuar',
  newGame: 'Nueva partida',
  tapToStart: 'Tocá para empezar',
  trashLeft: 'Basura en el río',
  clean: 'limpio',
  load: 'Carga',
  upgrades: 'Mejoras',
  settings: 'Ajustes',
  returnToPlant: 'Volver a la planta',
  full: '¡Bodega llena! Volvé a la planta',
  needCrane: 'Necesitás Grúa nivel',
  level: 'Nivel',
  max: 'MÁX',
  music: 'Música',
  sfx: 'Sonido',
  quality: 'Calidad gráfica',
  high: 'Alta',
  low: 'Baja',
  language: 'Idioma',
  reset: 'Borrar progreso',
  resetConfirm: '¿Seguro? Se pierde todo el progreso.',
  close: 'Cerrar',
  welcomeBack: '¡Bienvenido de vuelta!',
  offlineEarned: 'Mientras no estabas, tus barreras sacaron',
  collect: 'Cobrar',
  controlsDesktop: 'Mover: WASD / flechas · Mejoras: E · Volver: R',
  controlsMobile: 'Arrastrá en la pantalla para mover el barco',
  endTitle: '¡El río está vivo!',
  endText: 'Sacaste un millón de kilos de basura. Los peces, las ranas y los pájaros volvieron.',
  time: 'Tiempo',
  trips: 'Viajes',
  keepPlaying: 'Seguir navegando',
  reloadNeeded: 'Se aplica al recargar',
  milestones: {
    '0.001': '¡Primeros 1.000 kg fuera del río!',
    '0.005': '5.000 kg: la gente empieza a notar el cambio',
    '0.01': 'Primer 1%: el agua empieza a aclarar',
    '0.025': '2,5%: menos olor, más vida',
    '0.05': '5%: los juncos vuelven a ponerse verdes',
    '0.1': '10%: ¡volvieron los peces!',
    '0.25': '25%: aparecen nenúfares y ranas',
    '0.5': '50%: las aves regresan al río',
    '0.75': '75%: las orillas se llenan de flores',
    '0.9': '90%: el agua está casi cristalina',
    '1': '100%: ¡río limpio!',
  } as Record<string, string>,
  bonus: 'Premio',
  yes: 'Sí, borrar',
  cancel: 'Cancelar',
  next: 'Próximo hito',
  up: {
    red: ['Red', 'Radio de recolección'],
    motor: ['Motor', 'Velocidad del barco'],
    bodega: ['Bodega', 'Capacidad de carga'],
    grua: ['Grúa', 'Permite levantar basura más pesada'],
    planta: ['Planta', 'Pago por kilo reciclado'],
    flota: ['Flota', 'Barcos ayudantes automáticos'],
    barreras: ['Barreras', 'Atrapan basura sola, también offline'],
    rastra: ['Rastra', 'Arrastra basura sumergida: más kg por pieza'],
  } as Record<UpgradeId, [string, string]>,
  craneTiers: ['Liviana', 'Neumáticos', 'Tambores', 'Heladeras', 'Autos', 'Contenedores'],
};

const en: typeof es = {
  title: 'Clean River',
  subtitle: 'One million kilos of trash. A river that wants to live again.',
  play: 'Play',
  continue: 'Continue',
  newGame: 'New game',
  tapToStart: 'Tap to start',
  trashLeft: 'Trash in the river',
  clean: 'clean',
  load: 'Load',
  upgrades: 'Upgrades',
  settings: 'Settings',
  returnToPlant: 'Return to plant',
  full: 'Hold full! Head back to the plant',
  needCrane: 'Requires Crane level',
  level: 'Level',
  max: 'MAX',
  music: 'Music',
  sfx: 'Sound',
  quality: 'Graphics quality',
  high: 'High',
  low: 'Low',
  language: 'Language',
  reset: 'Reset progress',
  resetConfirm: 'Are you sure? All progress will be lost.',
  close: 'Close',
  welcomeBack: 'Welcome back!',
  offlineEarned: 'While you were away, your barriers removed',
  collect: 'Collect',
  controlsDesktop: 'Move: WASD / arrows · Upgrades: E · Return: R',
  controlsMobile: 'Drag anywhere to steer the boat',
  endTitle: 'The river is alive!',
  endText: 'You removed one million kilos of trash. The fish, frogs and birds are back.',
  time: 'Time',
  trips: 'Trips',
  keepPlaying: 'Keep sailing',
  reloadNeeded: 'Applies after reload',
  milestones: {
    '0.001': 'First 1,000 kg out of the river!',
    '0.005': '5,000 kg: people start to notice',
    '0.01': 'First 1%: the water starts to clear',
    '0.025': '2.5%: less smell, more life',
    '0.05': '5%: the reeds turn green again',
    '0.1': '10%: the fish are back!',
    '0.25': '25%: lily pads and frogs appear',
    '0.5': '50%: the birds return to the river',
    '0.75': '75%: the banks bloom with flowers',
    '0.9': '90%: the water is almost crystal clear',
    '1': '100%: clean river!',
  },
  bonus: 'Bonus',
  yes: 'Yes, delete',
  cancel: 'Cancel',
  next: 'Next goal',
  up: {
    red: ['Net', 'Pickup radius'],
    motor: ['Engine', 'Boat speed'],
    bodega: ['Hold', 'Cargo capacity'],
    grua: ['Crane', 'Lift heavier trash'],
    planta: ['Plant', 'Pay per recycled kilo'],
    flota: ['Fleet', 'Automatic helper boats'],
    barreras: ['Barriers', 'Catch trash on their own, even offline'],
    rastra: ['Dredge', 'Drags sunken trash: more kg per piece'],
  },
  craneTiers: ['Light', 'Tires', 'Barrels', 'Fridges', 'Cars', 'Containers'],
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
export function fmtKg(n: number): string {
  const loc = lang === 'es' ? 'es-AR' : 'en-US';
  return new Intl.NumberFormat(loc, { maximumFractionDigits: 0 }).format(Math.ceil(n)) + ' kg';
}
export function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${s.toString().padStart(2, '0')}s`;
}
