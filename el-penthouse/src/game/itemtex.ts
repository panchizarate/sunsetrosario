// Texturas dibujadas en canvas para los objetos: lomos y tapas de libros, etiquetas de botellas, logos de gorras.
// Cada textura es un atlas de N celdas horizontales; cada instancia elige una celda (atributo aVar).
import * as THREE from 'three';

const FONT = '"Space Grotesk", Inter, system-ui, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')!] as const;
}
function tex(c: HTMLCanvasElement, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
function fitText(x: CanvasRenderingContext2D, s: string, max: number, size: number, font: string, weight = 700) {
  let f = size;
  do { x.font = `${weight} ${f}px ${font}`; f -= 1; } while (x.measureText(s).width > max && f > 6);
}

// ------------------------------------------------------------------ LIBROS
// Máscara (no color): R = tinta clara (títulos dorados/crema), G = banda oscura, B = banda clara.
// Cada celda 256x512: los 64 px de la izquierda son el lomo, el resto la tapa.
export const BOOK_CELLS = 8;
const TITLES = [
  ['LA CIUDAD DORMIDA', 'M. ARANDA'], ['OCHO NOCHES', 'L. FERRO'], ['EL ÚLTIMO PISO', 'C. VIDAL'], ['MAREA ALTA', 'J. OLMOS'],
  ['CASA DE VIDRIO', 'R. SOLER'], ['LOS AUSENTES', 'A. QUIROGA'], ['NEÓN', 'T. BRANDT'], ['EL ORDEN', 'I. CASTRO'],
  ['TORMENTA', 'E. LUNA'], ['MEMORIA', 'P. DUARTE'], ['EL ESPEJO', 'S. RIVAS'], ['SIN NOMBRE', 'D. ROLDÁN'],
];
const bookCache = new Map<number, THREE.Texture>();
export function bookAtlas(variant: number) {
  if (bookCache.has(variant)) return bookCache.get(variant)!;
  const W = 256, H = 512;
  const [c, x] = canvas(W * BOOK_CELLS, H);
  x.fillStyle = '#000';
  x.fillRect(0, 0, c.width, H);
  for (let i = 0; i < BOOK_CELLS; i++) {
    const ox = i * W;
    const [title, author] = TITLES[(i + variant * 3) % TITLES.length];
    const style = (i + variant) % 4;
    // ---- lomo (0..64)
    const S = 64;
    if (style === 0) { x.fillStyle = '#00ff00'; x.fillRect(ox, 40, S, 16); x.fillRect(ox, H - 70, S, 16); }
    if (style === 1) { x.fillStyle = '#ff0000'; x.fillRect(ox + 6, 24, S - 12, 3); x.fillRect(ox + 6, H - 30, S - 12, 3); }
    if (style === 2) { x.fillStyle = '#0000ff'; x.fillRect(ox, 0, S, 90); }
    if (style === 3) { x.fillStyle = '#00ff00'; x.fillRect(ox, H - 120, S, 120); }
    x.save();
    x.translate(ox + S / 2, H / 2);
    x.rotate(Math.PI / 2);
    x.fillStyle = '#ff0000';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    fitText(x, title, H - 170, 30, style % 2 ? SERIF : FONT, 700);
    x.fillText(title, -20, -4);
    x.font = `500 15px ${FONT}`;
    x.fillText(author, 175, 0);
    x.restore();
    x.fillStyle = '#ff0000';
    x.beginPath(); x.arc(ox + S / 2, H - 40, 9, 0, Math.PI * 2); x.fill(); // logo editorial
    // ---- tapa (64..256)
    const cx = ox + S + (W - S) / 2, cw = W - S;
    x.fillStyle = '#00ff00';
    if (style === 0) x.fillRect(ox + S, 300, cw, 120);
    if (style === 1) for (let k = 0; k < 6; k++) x.fillRect(ox + S, 60 + k * 18, cw, 6);
    if (style === 2) { x.beginPath(); x.arc(cx, 250, 62, 0, Math.PI * 2); x.fill(); }
    if (style === 3) { x.fillStyle = '#0000ff'; x.fillRect(ox + S + 14, 14, cw - 28, H - 28); x.fillStyle = '#000'; x.fillRect(ox + S + 18, 18, cw - 36, H - 36); }
    x.fillStyle = '#ff0000';
    x.textAlign = 'center';
    x.textBaseline = 'alphabetic';
    const words = title.split(' ');
    let y = 150;
    for (const w of words) { fitText(x, w, cw - 30, 34, style % 2 ? SERIF : FONT, 700); x.fillText(w, cx, y); y += 38; }
    x.font = `500 16px ${FONT}`;
    x.fillText(author, cx, H - 40);
  }
  const t = tex(c, false);
  bookCache.set(variant, t);
  return t;
}

// ------------------------------------------------------------------ BOTELLAS (etiquetas a color)
export const LABEL_CELLS = 4;
const LABELS: { bg: string; ink: string; acc: string; name: string[]; sub: string[]; serif: boolean }[] = [
  { bg: '#efe6d2', ink: '#4a0f1a', acc: '#a37c32', name: ['GRAN RESERVA', 'MALBEC', 'BODEGA ALTA', 'CABERNET'], sub: ['MENDOZA · 2019', 'VALLE DE UCO', 'SALTA · 2021', 'LUJÁN DE CUYO'], serif: true },
  { bg: '#16120e', ink: '#d8b46a', acc: '#8a5a22', name: ['HIGHLAND 12', 'OLD OAK', 'BLACK CASK', 'DOUBLE MALT'], sub: ['AGED 12 YEARS', 'SMALL BATCH', 'SHERRY CASK', 'BLENDED'], serif: true },
  { bg: '#e9f2ef', ink: '#1d4b4a', acc: '#4f9a8e', name: ['LONDON DRY', 'BOTÁNICO', 'JUNIPER', 'GIN Nº 7'], sub: ['DISTILLED GIN', 'CÍTRICOS', 'SMALL BATCH', 'PATAGONIA'], serif: false },
  { bg: '#0f1a12', ink: '#e6cf8c', acc: '#b58e3c', name: ['BRUT', 'ROSÉ', 'EXTRA BRUT', 'NATURE'], sub: ['MÉTHODE TRAD.', 'CHAMPENOISE', 'CUVÉE', 'MILLÉSIME'], serif: true },
  { bg: '#f5f7f8', ink: '#22303c', acc: '#8fa3b8', name: ['VODKA', 'PURE', 'ARCTIC', 'NORTE'], sub: ['TRIPLE DISTILLED', '40% VOL', 'GRAIN', 'FILTERED'], serif: false },
];
const labelCache = new Map<number, THREE.Texture>();
export function labelAtlas(variant: number) {
  if (labelCache.has(variant)) return labelCache.get(variant)!;
  const L = LABELS[variant % 5];
  const W = 512, H = 256;
  const [c, x] = canvas(W * LABEL_CELLS, H);
  for (let i = 0; i < LABEL_CELLS; i++) {
    const ox = i * W;
    // la etiqueta ocupa el frente (centro del canvas); los costados quedan transparentes (vidrio)
    const lw = 300, lx = ox + (W - lw) / 2;
    x.fillStyle = L.bg;
    x.beginPath(); x.roundRect(lx, 8, lw, H - 16, i % 2 ? 4 : 18); x.fill();
    // textura de papel
    for (let k = 0; k < 900; k++) { x.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`; x.fillRect(lx + Math.random() * lw, 8 + Math.random() * (H - 16), 2, 2); }
    x.strokeStyle = L.acc; x.lineWidth = 3;
    x.strokeRect(lx + 12, 20, lw - 24, H - 40);
    x.lineWidth = 1; x.strokeRect(lx + 18, 26, lw - 36, H - 52);
    x.fillStyle = L.ink; x.textAlign = 'center';
    x.font = `600 13px ${FONT}`;
    x.fillText('EST. 1984', ox + W / 2, 52);
    fitText(x, L.name[i], lw - 60, 44, L.serif ? SERIF : FONT, 700);
    x.fillText(L.name[i], ox + W / 2, 120);
    x.fillStyle = L.acc; x.fillRect(ox + W / 2 - 40, 138, 80, 2);
    x.fillStyle = L.ink; x.font = `500 16px ${FONT}`;
    x.fillText(L.sub[i], ox + W / 2, 170);
    x.font = `500 12px ${FONT}`;
    x.fillText('750 ml', ox + W / 2, 215);
    // escudito
    x.strokeStyle = L.acc; x.lineWidth = 2;
    x.beginPath(); x.moveTo(ox + W / 2 - 10, 62); x.lineTo(ox + W / 2 + 10, 62); x.lineTo(ox + W / 2 + 10, 74); x.quadraticCurveTo(ox + W / 2, 84, ox + W / 2 - 10, 74); x.closePath(); x.stroke();
  }
  const t = tex(c);
  labelCache.set(variant, t);
  return t;
}

// ------------------------------------------------------------------ GORRAS (logo bordado, máscara)
export const CAP_CELLS = 4;
const capCache = new Map<number, THREE.Texture>();
export function capAtlas(variant: number) {
  if (capCache.has(variant)) return capCache.get(variant)!;
  const W = 256, H = 256;
  const [c, x] = canvas(W * CAP_CELLS, H);
  x.fillStyle = '#000'; x.fillRect(0, 0, c.width, H);
  const marks = ['PH', 'R', '52', 'NY', 'LA', 'CR', '★', 'BA'];
  for (let i = 0; i < CAP_CELLS; i++) {
    const ox = i * W;
    x.fillStyle = '#ff0000';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `700 ${i % 2 ? 110 : 90}px ${i % 2 ? SERIF : FONT}`;
    x.fillText(marks[(i + variant * 2) % marks.length], ox + W / 2, H / 2 + 6);
    if (i === 3) { x.fillStyle = '#00ff00'; x.fillRect(ox + 40, 200, W - 80, 8); }
  }
  const t = tex(c, false);
  capCache.set(variant, t);
  return t;
}

// ------------------------------------------------------------------ REMERAS (estampas, máscara)
export const SHIRT_CELLS = 4;
let shirtTex: THREE.Texture | null = null;
export function shirtAtlas() {
  if (shirtTex) return shirtTex;
  const W = 256, H = 256;
  const [c, x] = canvas(W * SHIRT_CELLS, H);
  x.fillStyle = '#000'; x.fillRect(0, 0, c.width, H);
  // 0 lisa, 1 rayas, 2 logo, 3 bolsillo + texto
  for (let k = 0; k < 9; k++) { x.fillStyle = '#00ff00'; x.fillRect(W, k * 30, W, 12); }
  x.fillStyle = '#ff0000'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `700 64px ${FONT}`; x.fillText('PH52', W * 2 + W / 2, 100);
  x.font = `500 22px ${FONT}`; x.fillText('PENTHOUSE CLUB', W * 2 + W / 2, 150);
  x.strokeStyle = '#ff0000'; x.lineWidth = 4; x.strokeRect(W * 3 + 150, 60, 56, 60);
  x.font = `600 20px ${SERIF}`; x.fillText('R.', W * 3 + 178, 92);
  shirtTex = tex(c, false);
  return shirtTex;
}
