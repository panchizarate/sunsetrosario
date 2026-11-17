import './style.css';
import { Game } from './game/game';
import { AudioEngine } from './game/audio';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
// acceso para pruebas automatizadas / depuración
(window as any).__game = game;
(window as any).__AudioEngine = AudioEngine;

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
