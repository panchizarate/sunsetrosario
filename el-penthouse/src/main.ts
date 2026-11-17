import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import './style.css';
import { Game } from './game/game';
import { runBot } from './game/bot';

const qs = new URLSearchParams(location.search);
const canvas = document.getElementById('game') as HTMLCanvasElement;
const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
const high = qs.has('low') ? false : qs.has('high') ? true : !touch;
if (qs.has('fresh')) Game.wipe();
const game = new Game(canvas, { high });
(window as any).game = game;
game.timeScale = +(qs.get('timescale') ?? 1);
game.noRender = qs.has('norender');

// pantalla de título
const title = document.createElement('div');
title.className = 'title-screen';
const has = Game.hasSave();
title.innerHTML = `
  <div class="t-inner">
    <small class="t-kicker">PISO 52 · TORMENTA · 23:40</small>
    <h1>EL<br>PENTHOUSE</h1>
    <p>Ordená 3.000 objetos en la casa de un millonario que nunca está.<br>Algo no cierra.</p>
    <button class="primary big" id="play">${has ? 'Continuar' : 'Entrar'}</button>
    ${has ? '<button class="ghost" id="new">Partida nueva</button>' : ''}
    <div class="t-keys">${touch ? 'Joystick izquierdo para caminar · arrastrá a la derecha para mirar · ✋ agarrar/dejar' : 'WASD moverse · Mouse mirar · Clic agarrar/dejar · Q cambiar · E usar · T tablet'}</div>
  </div>`;
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
