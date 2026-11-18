import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import './style.css';
import { Game } from './game/game';
import { runBot } from './game/bot';
import { loadAssets } from './game/assets';

const qs = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const high = qs.has('low') ? false : qs.has('high') ? true : !touch;
if (qs.has('fresh')) Game.wipe();
const FONTS = ['700 30px "Space Grotesk"', '500 16px "Space Grotesk"', '600 16px Inter'];
await Promise.race([Promise.all(FONTS.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 2500))]);
const loading = document.createElement('div');
loading.className = 'loading';
loading.innerHTML = '<b>El Penthouse</b><div class="lbar"><i></i></div>';
document.getElementById('ui')!.appendChild(loading);
await loadAssets((f) => { (loading.querySelector('.lbar i') as HTMLElement).style.width = `${Math.round(f * 100)}%`; });
loading.remove();
const game = new Game(canvas, { high });
(window as any).game = game;
game.timeScale = +(qs.get('timescale') ?? 1);
game.noRender = qs.has('norender');

// pantalla de título
const title = document.createElement('div');
title.className = 'title-screen';
const has = Game.hasSave();
const kb = (k: string) => `<kbd>${k}</kbd>`;
title.innerHTML = `
  <div class="t-scrim"></div>
  <div class="t-main">
    <h1 class="t-word"><span class="t-el">El</span><span class="t-ph">Penthouse</span></h1>
    <p class="t-log">Te contrataron para ordenar los 3.000 objetos del piso 52 de Cristian Rolando. Él está de viaje. Eso dice BOB.</p>
    <div class="t-acts">
      <button class="primary big" id="play">${has ? 'Continuar' : 'Entrar al penthouse'}</button>
      ${has ? '<button class="ghost" id="new">Partida nueva</button>' : ''}
    </div>
    <p class="t-keys">${touch ? 'Joystick a la izquierda para caminar · arrastrá a la derecha para mirar · botón de la mano para agarrar y dejar' : `${kb('W')}${kb('A')}${kb('S')}${kb('D')} caminar <span></span> ${kb('Clic')} agarrar y dejar <span></span> ${kb('Q')} cambiar <span></span> ${kb('E')} usar <span></span> ${kb('T')} tablet`}</p>
  </div>
  <dl class="t-read">
    <div><dt>Hora</dt><dd>23:40</dd></div>
    <div><dt>Piso</dt><dd>52</dd></div>
    <div><dt>Clima</dt><dd>Tormenta</dd></div>
  </dl>`;
document.getElementById('ui')!.appendChild(title);
const go = () => {
  title.classList.add('out');
  setTimeout(() => title.remove(), 900);
  game.start();
  if (!touch) try { (canvas.requestPointerLock as any)?.call(canvas)?.catch?.(() => {}); } catch { /* */ }
};
document.getElementById('play')!.onclick = go;
const nw = document.getElementById('new');
if (nw) nw.onclick = () => { if (confirm('¿Empezar de cero? Se borra la partida guardada.')) { Game.wipe(); location.reload(); } };
if (qs.has('autostart') || qs.has('bot')) go();
if (qs.has('bot')) runBot(game);

let last = performance.now();
function frame(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  game.update(dt);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
if ('serviceWorker' in navigator && location.protocol === 'https:' && !qs.has('nosw')) navigator.serviceWorker.register('./sw.js').catch(() => {});
