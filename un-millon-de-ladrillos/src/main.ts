import './style.css';
import { Game } from './game/game';
import { AudioEngine } from './game/audio';
import { UPGRADES } from './game/config';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
// acceso para pruebas automatizadas
(window as any).__game = game;
(window as any).__AudioEngine = AudioEngine;
(window as any).__UPG = UPGRADES;

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
