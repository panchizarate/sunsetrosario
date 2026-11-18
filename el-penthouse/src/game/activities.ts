// Actividades: casino (ruleta, blackjack, tragamonedas), arcade, DJ y barra de tragos.
import { UI, fmt } from './ui';
import { audio } from './audio';

export interface Ctx {
  ui: UI;
  money: () => number;
  add: (n: number, casino?: boolean) => void;
  betLimit: () => number;
  token: (id: string) => void;
  hasToken: (id: string) => boolean;
  drink: (id: string, name: string, desc: string) => void;
  dj: (mode: number) => void;
  djMode: () => number;
}

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

function betRow(ctx: Ctx, get: () => number, set: (n: number) => void) {
  const lim = ctx.betLimit();
  const opts = [10, 50, 100, 500, 1000, 5000].filter((v) => v <= lim);
  return `<div class="bet"><span>Apuesta</span>${opts.map((v) => `<button class="chipb" data-b="${v}">${v >= 1000 ? v / 1000 + 'k' : v}</button>`).join('')}<button class="chipb" data-b="max">MÁX</button><b class="betv">${fmt(get())}</b><small>límite ${fmt(lim)}</small></div>`;
}
function wireBet(box: HTMLElement, ctx: Ctx, set: (n: number) => void, get: () => number) {
  box.querySelectorAll<HTMLButtonElement>('.chipb').forEach((b) => (b.onclick = () => {
    const v = b.dataset.b === 'max' ? ctx.betLimit() : +b.dataset.b!;
    set(Math.min(v, ctx.betLimit(), Math.floor(ctx.money())));
    box.querySelector('.betv')!.textContent = fmt(get());
    audio.chip();
  }));
}

// ------------------------------------------------------------------ RULETA
export function ruleta(ctx: Ctx) {
  let bet = Math.min(100, ctx.betLimit());
  let busy = false;
  const nums = Array.from({ length: 37 }, (_, n) => `<button class="rn ${n === 0 ? 'g' : RED.has(n) ? 'r' : 'k'}" data-n="${n}">${n}</button>`).join('');
  const box = ctx.ui.modal(`
    <div class="cas-head"><small>CASINO · PLATA DEL JUEGO</small><h2>Ruleta</h2></div>
    <div class="wheel"><div class="wnum" id="wn">–</div></div>
    ${betRow(ctx, () => bet, (n) => (bet = n))}
    <div class="rbets">
      <button data-k="rojo" class="r">Rojo ×2</button><button data-k="negro" class="k">Negro ×2</button>
      <button data-k="par">Par ×2</button><button data-k="impar">Impar ×2</button>
      <button data-k="bajo">1–18 ×2</button><button data-k="alto">19–36 ×2</button>
    </div>
    <div class="rgrid">${nums}</div><small class="hint">Número exacto paga ×36</small>
    <div class="res" id="res"></div>`, 'casino');
  wireBet(box, ctx, (n) => (bet = n), () => bet);
  const play = (kind: string, num = -1) => {
    if (busy) return;
    if (bet <= 0 || ctx.money() < bet) { ctx.ui.toast('No te alcanza', 2400, 'coin', 'Bajá la apuesta o seguí ordenando'); return; }
    busy = true;
    ctx.add(-bet, true);
    audio.chip();
    const res = Math.floor(Math.random() * 37);
    const wn = box.querySelector('#wn')!;
    let k = 0;
    const spin = () => {
      k++;
      wn.textContent = String(Math.floor(Math.random() * 37));
      audio.tick();
      if (k < 22) setTimeout(spin, 40 + k * k * 0.6);
      else {
        wn.textContent = String(res);
        wn.className = 'wnum ' + (res === 0 ? 'g' : RED.has(res) ? 'r' : 'k');
        const win =
          (kind === 'num' && res === num) ? 36 :
          res !== 0 && ((kind === 'rojo' && RED.has(res)) || (kind === 'negro' && !RED.has(res)) || (kind === 'par' && res % 2 === 0) || (kind === 'impar' && res % 2 === 1) || (kind === 'bajo' && res <= 18) || (kind === 'alto' && res > 18)) ? 2 : 0;
        const r = box.querySelector('#res')!;
        if (win) { ctx.add(bet * win, true); audio.win(win > 2); r.innerHTML = `<b class="ok">¡Ganaste ${fmt(bet * win)}!</b>`; }
        else { audio.lose(); r.innerHTML = `<b class="bad">Salió ${res}. Perdiste ${fmt(bet)}</b>`; }
        busy = false;
      }
    };
    spin();
  };
  box.querySelectorAll<HTMLButtonElement>('.rbets button').forEach((b) => (b.onclick = () => play(b.dataset.k!)));
  box.querySelectorAll<HTMLButtonElement>('.rn').forEach((b) => (b.onclick = () => play('num', +b.dataset.n!)));
}

// ------------------------------------------------------------------ BLACKJACK
export function blackjack(ctx: Ctx) {
  let bet = Math.min(100, ctx.betLimit());
  let deck: number[] = [], P: number[] = [], D: number[] = [], live = false, cur = 0;
  const SUITS = ['♠', '♥', '♦', '♣'];
  const NAMES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const val = (h: number[]) => { let s = 0, a = 0; for (const c of h) { const r = c % 13; s += r === 0 ? 11 : Math.min(10, r + 1); if (r === 0) a++; } while (s > 21 && a) { s -= 10; a--; } return s; };
  const card = (c: number, hide = false) => hide ? `<i class="card back"></i>` : `<i class="card ${(Math.floor(c / 13) % 4 === 1 || Math.floor(c / 13) % 4 === 2) ? 'red' : ''}"><b>${NAMES[c % 13]}</b>${SUITS[Math.floor(c / 13) % 4]}</i>`;
  const box = ctx.ui.modal(`
    <div class="cas-head"><small>CASINO · PLATA DEL JUEGO</small><h2>Blackjack</h2></div>
    <div class="bj"><div class="hand-l">Crupier <b id="dv"></b></div><div class="hand" id="dh"></div><div class="hand-l">Vos <b id="pv"></b></div><div class="hand" id="ph"></div></div>
    ${betRow(ctx, () => bet, (n) => (bet = n))}
    <div class="acts"><button id="deal" class="primary">Repartir</button><button id="hit" disabled>Pedir</button><button id="stand" disabled>Plantarse</button><button id="dbl" disabled>Doblar</button></div>
    <div class="res" id="res"></div>`, 'casino');
  wireBet(box, ctx, (n) => (bet = n), () => bet);
  const q = (s: string) => box.querySelector(s) as HTMLElement;
  const render = (hide: boolean) => {
    q('#dh').innerHTML = D.map((c, i) => card(c, hide && i === 1)).join('');
    q('#ph').innerHTML = P.map((c) => card(c)).join('');
    q('#pv').textContent = String(val(P));
    q('#dv').textContent = hide ? '?' : String(val(D));
  };
  const btns = (on: boolean) => { (q('#hit') as HTMLButtonElement).disabled = !on; (q('#stand') as HTMLButtonElement).disabled = !on; (q('#dbl') as HTMLButtonElement).disabled = !on || P.length > 2 || ctx.money() < cur; (q('#deal') as HTMLButtonElement).disabled = on; };
  const end = (mult: number, msg: string) => {
    live = false;
    render(false);
    btns(false);
    if (mult > 0) { ctx.add(cur * mult, true); audio.win(mult > 2); } else audio.lose();
    q('#res').innerHTML = `<b class="${mult > 1 ? 'ok' : mult === 1 ? '' : 'bad'}">${msg}</b>`;
  };
  const dealerPlay = () => {
    const step = () => {
      if (val(D) < 17) { D.push(deck.pop()!); audio.card(); render(false); setTimeout(step, 450); return; }
      const p = val(P), d = val(D);
      if (d > 21 || p > d) end(2, `¡Ganaste ${fmt(cur * 2)}!`);
      else if (p === d) end(1, 'Empate: te devuelven la apuesta');
      else end(0, `Gana la casa (${d} a ${p})`);
    };
    render(false);
    setTimeout(step, 450);
  };
  q('#deal').onclick = () => {
    if (live) return;
    if (bet <= 0 || ctx.money() < bet) { ctx.ui.toast('No te alcanza', 2400, 'coin', 'Bajá la apuesta o seguí ordenando'); return; }
    cur = bet;
    ctx.add(-cur, true);
    deck = Array.from({ length: 52 * 4 }, (_, i) => i % 52).sort(() => Math.random() - 0.5);
    P = [deck.pop()!, deck.pop()!];
    D = [deck.pop()!, deck.pop()!];
    live = true;
    q('#res').innerHTML = '';
    audio.card();
    render(true);
    btns(true);
    if (val(P) === 21) end(val(D) === 21 ? 1 : 2.5, val(D) === 21 ? 'Empate de blackjacks' : `¡BLACKJACK! ${fmt(cur * 2.5)}`);
  };
  q('#hit').onclick = () => {
    if (!live) return;
    P.push(deck.pop()!);
    audio.card();
    render(true);
    btns(true);
    if (val(P) > 21) end(0, `Te pasaste (${val(P)})`);
  };
  q('#stand').onclick = () => { if (live) { btns(false); dealerPlay(); } };
  q('#dbl').onclick = () => {
    if (!live || ctx.money() < cur) return;
    ctx.add(-cur, true);
    cur *= 2;
    P.push(deck.pop()!);
    audio.card();
    if (val(P) > 21) end(0, `Te pasaste (${val(P)})`);
    else { btns(false); dealerPlay(); }
  };
}

// ------------------------------------------------------------------ TRAGAMONEDAS
export function slots(ctx: Ctx) {
  let bet = Math.min(50, ctx.betLimit());
  const SYM = ['7', 'BAR', '★', '♦', '♥', '◆'];
  const PAY: Record<string, number> = { '7': 50, BAR: 20, '★': 10, '♦': 5, '♥': 4, '◆': 3 };
  let busy = false;
  const box = ctx.ui.modal(`
    <div class="cas-head"><small>CASINO · PLATA DEL JUEGO</small><h2>Tragamonedas</h2></div>
    <div class="reels">${[0, 1, 2].map((i) => `<div class="reel" id="r${i}">7</div>`).join('')}</div>
    <div class="paytable">${SYM.map((s) => `<span><b>${s}${s}${s}</b> ×${PAY[s]}</span>`).join('')}<span><b>2 iguales</b> ×1.2</span></div>
    ${betRow(ctx, () => bet, (n) => (bet = n))}
    <div class="acts"><button id="spin" class="primary big">GIRAR</button></div>
    <div class="res" id="res"></div>`, 'casino');
  wireBet(box, ctx, (n) => (bet = n), () => bet);
  (box.querySelector('#spin') as HTMLElement).onclick = () => {
    if (busy) return;
    if (bet <= 0 || ctx.money() < bet) { ctx.ui.toast('No te alcanza', 2400, 'coin', 'Bajá la apuesta o seguí ordenando'); return; }
    busy = true;
    ctx.add(-bet, true);
    const res = [0, 1, 2].map(() => SYM[Math.floor(Math.random() * 6)]);
    const els = [0, 1, 2].map((i) => box.querySelector('#r' + i) as HTMLElement);
    els.forEach((e) => e.classList.add('spin'));
    let k = 0;
    const iv = setInterval(() => {
      k++;
      els.forEach((e, i) => { if (k < 10 + i * 6) { e.textContent = SYM[Math.floor(Math.random() * 6)]; } else if (e.classList.contains('spin')) { e.textContent = res[i]; e.classList.remove('spin'); audio.chip(); } });
      if (k % 2) audio.tick();
      if (k >= 22) {
        clearInterval(iv);
        const r = box.querySelector('#res')!;
        let mult = 0;
        if (res[0] === res[1] && res[1] === res[2]) mult = PAY[res[0]];
        else if (res[0] === res[1] || res[1] === res[2] || res[0] === res[2]) mult = 1.2;
        if (mult) { ctx.add(Math.round(bet * mult), true); audio.win(mult >= 10); r.innerHTML = `<b class="ok">${mult >= 10 ? '¡PREMIO MAYOR! ' : ''}+${fmt(bet * mult)}</b>`; }
        else { audio.lose(); r.innerHTML = `<b class="bad">Nada esta vez</b>`; }
        busy = false;
      }
    }, 70);
  };
}

// ------------------------------------------------------------------ ARCADE: "NEON CATCH"
export function arcade(ctx: Ctx) {
  const box = ctx.ui.modal(`
    <div class="cas-head"><small>ARCADE</small><h2>NEON CATCH</h2></div>
    <canvas id="arc" width="420" height="560"></canvas>
    <small class="hint">Mové la bandeja con el mouse, el dedo o ← →. Atrapá los objetos, esquivá las bombas.<br>Llegá a <b>25</b> para ganar una ficha dorada.</small>`, 'arcade', () => { stop = true; });
  const cv = box.querySelector('#arc') as HTMLCanvasElement;
  const g = cv.getContext('2d')!;
  let stop = false, px = 210, score = 0, lives = 3, t = 0, spawn = 0, over = false, started = false, best = 0;
  let objs: { x: number; y: number; v: number; bomb: boolean; c: string; r: number }[] = [];
  const keys = new Set<string>();
  const kd = (e: KeyboardEvent) => { keys.add(e.key); if (e.key === ' ' && over) reset(); };
  const ku = (e: KeyboardEvent) => keys.delete(e.key);
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  const move = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); px = ((e.clientX - r.left) / r.width) * 420; started = true; };
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerdown', (e) => { move(e); if (over) reset(); });
  const reset = () => { score = 0; lives = 3; t = 0; objs = []; over = false; started = true; };
  const COLORS = ['#2ee6ff', '#ff4fa3', '#ffd23a', '#7dffb0', '#b06bff'];
  let last = performance.now();
  const frame = (now: number) => {
    if (stop) { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); return; }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (keys.has('ArrowLeft') || keys.has('a')) { px -= 420 * dt; started = true; }
    if (keys.has('ArrowRight') || keys.has('d')) { px += 420 * dt; started = true; }
    px = Math.max(40, Math.min(380, px));
    if (started && !over) {
      t += dt;
      spawn -= dt;
      if (spawn <= 0) {
        spawn = Math.max(0.28, 0.9 - t * 0.012);
        const bomb = Math.random() < Math.min(0.35, 0.12 + t * 0.004);
        objs.push({ x: 30 + Math.random() * 360, y: -20, v: 150 + t * 4 + Math.random() * 60, bomb, c: COLORS[Math.floor(Math.random() * 5)], r: 12 + Math.random() * 6 });
      }
      for (const o of objs) o.y += o.v * dt;
      objs = objs.filter((o) => {
        if (o.y > 505 && o.y < 530 && Math.abs(o.x - px) < 48) {
          if (o.bomb) { lives--; audio.wrong(); if (lives <= 0) { over = true; best = Math.max(best, score); } }
          else { score++; audio.place('plastico'); if (score === 25 && !ctx.hasToken('arcade')) { ctx.token('arcade'); } }
          return false;
        }
        if (o.y > 580) { if (!o.bomb) { lives--; audio.lose(); if (lives <= 0) { over = true; best = Math.max(best, score); } } return false; }
        return true;
      });
    }
    // dibujo
    g.fillStyle = '#07060f';
    g.fillRect(0, 0, 420, 560);
    g.strokeStyle = 'rgba(46,230,255,0.08)';
    for (let y = (t * 60) % 40; y < 560; y += 40) { g.beginPath(); g.moveTo(0, y); g.lineTo(420, y); g.stroke(); }
    for (const o of objs) {
      g.shadowBlur = 16;
      if (o.bomb) {
        g.shadowColor = '#ff2a2a'; g.strokeStyle = '#ff3b3b'; g.lineWidth = 4;
        g.beginPath(); g.moveTo(o.x - 10, o.y - 10); g.lineTo(o.x + 10, o.y + 10); g.moveTo(o.x + 10, o.y - 10); g.lineTo(o.x - 10, o.y + 10); g.stroke();
      } else {
        g.shadowColor = o.c; g.fillStyle = o.c;
        g.beginPath(); g.roundRect(o.x - o.r, o.y - o.r, o.r * 2, o.r * 2, 5); g.fill();
      }
    }
    g.shadowBlur = 20; g.shadowColor = '#2ee6ff'; g.fillStyle = '#2ee6ff';
    g.beginPath(); g.roundRect(px - 46, 512, 92, 12, 6); g.fill();
    g.shadowBlur = 0;
    g.fillStyle = '#fff'; g.font = '700 22px "Space Grotesk", sans-serif'; g.textAlign = 'left';
    g.fillText(`${score}`, 16, 34);
    g.textAlign = 'right';
    g.fillStyle = '#ff4fa3';
    g.fillText('♥'.repeat(Math.max(0, lives)), 404, 34);
    g.textAlign = 'center';
    if (!started) { g.fillStyle = '#fff'; g.fillText('Mové para empezar', 210, 280); }
    if (over) { g.fillStyle = '#fff'; g.fillText(`FIN · ${score} puntos`, 210, 260); g.font = '500 16px Inter, sans-serif'; g.fillText(ctx.hasToken('arcade') ? '¡Ficha dorada conseguida!' : 'Necesitás 25 para la ficha', 210, 290); g.fillText('Tocá para jugar de nuevo', 210, 320); }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  void best;
}

// ------------------------------------------------------------------ DJ
export function dj(ctx: Ctx) {
  const MODES = [['Apagado', 'Solo la lluvia'], ['Lo-fi', 'Para ordenar tranqui'], ['Synthwave', 'Neón y ruta nocturna'], ['House', 'Fiesta en el penthouse']];
  const box = ctx.ui.modal(`<div class="cas-head"><small>LIVING</small><h2>Mesa de DJ</h2></div>
    <div class="djs">${MODES.map((m, i) => `<button data-m="${i}" class="${ctx.djMode() === i ? 'on' : ''}"><b>${m[0]}</b><small>${m[1]}</small></button>`).join('')}</div>`, 'dj');
  box.querySelectorAll<HTMLButtonElement>('.djs button').forEach((b) => (b.onclick = () => {
    ctx.dj(+b.dataset.m!);
    box.querySelectorAll('.djs button').forEach((x) => x.classList.toggle('on', x === b));
    audio.click();
  }));
}

// ------------------------------------------------------------------ TRAGOS
const ING = ['Gin', 'Ron', 'Whisky', 'Vermut', 'Bitter', 'Limón', 'Menta', 'Hielo'];
const RECIPES = [
  { id: 'negroni', name: 'Negroni', ing: ['Gin', 'Vermut', 'Bitter'], desc: '+40% de velocidad por 2 minutos' },
  { id: 'mojito', name: 'Mojito', ing: ['Ron', 'Menta', 'Limón'], desc: 'Imán potente por 2 minutos' },
  { id: 'oldfashioned', name: 'Old Fashioned', ing: ['Whisky', 'Bitter', 'Hielo'], desc: 'Pagos ×1.5 por 2 minutos' },
  { id: 'gintonic', name: 'Gin Tonic', ing: ['Gin', 'Limón', 'Hielo'], desc: '+4 al agarre rápido por 2 minutos' },
];
export function tragos(ctx: Ctx) {
  const sel = new Set<string>();
  const box = ctx.ui.modal(`<div class="cas-head"><small>BAR</small><h2>Barra de tragos</h2></div>
    <p class="lead">Elegí 3 ingredientes. Algunos tragos te dan un efecto por 2 minutos.</p>
    <div class="ings">${ING.map((i) => `<button data-i="${i}">${i}</button>`).join('')}</div>
    <div class="menu">${RECIPES.map((r) => `<div><b>${r.name}</b><small>${r.ing.join(' · ')}</small><em>${r.desc}</em></div>`).join('')}</div>
    <div class="acts"><button id="mix" class="primary" disabled>Preparar</button></div><div class="res" id="res"></div>`, 'tragos');
  const mix = box.querySelector('#mix') as HTMLButtonElement;
  box.querySelectorAll<HTMLButtonElement>('.ings button').forEach((b) => (b.onclick = () => {
    const i = b.dataset.i!;
    if (sel.has(i)) sel.delete(i); else if (sel.size < 3) sel.add(i);
    b.classList.toggle('on', sel.has(i));
    mix.disabled = sel.size !== 3;
    audio.click();
  }));
  mix.onclick = () => {
    const r = RECIPES.find((x) => x.ing.every((i) => sel.has(i)));
    const res = box.querySelector('#res')!;
    audio.place('vidrio');
    if (r) { ctx.drink(r.id, r.name, r.desc); res.innerHTML = `<b class="ok">${r.name}: ${r.desc}</b>`; }
    else res.innerHTML = `<b class="bad">Sabe horrible. BOB: "El dueño siempre pedía Old Fashioned".</b>`;
    sel.clear();
    box.querySelectorAll('.ings button').forEach((x) => x.classList.remove('on'));
    mix.disabled = true;
  };
}
