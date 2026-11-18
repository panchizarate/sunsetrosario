// Interfaz: HUD, mensajes, subtítulos, modales. Estilo lujo oscuro + neón.
import { CATEGORIES, UPGRADES, ZONES, ZoneId, Levels, UpgradeId } from './config';

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
export const h = (html: string) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild as HTMLElement; };
export const fmt = (n: number) => '$' + Math.floor(n).toLocaleString('es-AR');


const sv = (d: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const ICON: Record<string, string> = {
  info: sv('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  warn: sv('<path d="M12 4 2.5 20h19L12 4z"/><path d="M12 10v4M12 17h.01"/>'),
  call: sv('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
  cam: sv('<rect x="3" y="7" width="13" height="10" rx="2"/><path d="m16 11 5-3v8l-5-3"/>'),
  coin: sv('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/>'),
  tablet: sv('<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M11 18h2"/>'),
  pause: sv('<path d="M9 5v14M15 5v14"/>'),
  manos: sv('<path d="M7 11V6a1.5 1.5 0 0 1 3 0v5M10 10V4.5a1.5 1.5 0 0 1 3 0V10M13 10V5.5a1.5 1.5 0 0 1 3 0V12M16 9.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-2.7L3.5 14a1.6 1.6 0 0 1 2.6-1.8L7 13"/>'),
  velocidad: sv('<path d="M13 3 5 14h6l-1 7 8-11h-6l1-7z"/>'),
  agarre: sv('<path d="M4 8h4M4 12h6M4 16h4"/><rect x="12" y="6" width="8" height="12" rx="2"/>'),
  iman: sv('<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4H6z"/><path d="M6 8h4M14 8h4"/>'),
  escaner: sv('<circle cx="12" cy="12" r="3"/><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/>'),
  ayudantes: sv('<rect x="5" y="8" width="14" height="10" rx="3"/><path d="M12 4v4M9 13h.01M15 13h.01M2 13h3M19 13h3"/>'),
  combo: sv('<path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-4-1-6 1-9z"/>'),
  drink: sv('<path d="M5 4h14l-7 8-7-8zM12 12v7M8 20h8"/>'),
};

export interface HeldGroup { key: string; kind: string; variant: number; count: number }

export class UI {
  root: HTMLElement;
  private toastT = 0;
  private subQueue: { who: string; text: string; dur: number; cls: string }[] = [];
  private subT = 0;
  private aimEl: HTMLElement;
  modalOpen = false;
  onClose: (() => void) | null = null;

  constructor() {
    this.root = document.getElementById('ui')!;
    this.root.innerHTML = `
      <div class="hud">
        <div class="hud-top">
          <div class="left-col">
            <div class="money glass"><span class="chip-i"></span><b id="money">$0</b><span id="mult" class="mult"></span></div>
            <div class="tokens glass hidden" id="tokens"></div>
          </div>
          <div class="zone glass" id="zone">
            <div class="z-name"><i class="dot"></i><span id="zname">Living</span></div>
            <div class="z-num"><b id="zcount">0</b><span id="ztotal">/600</span></div>
            <div class="z-bar"><i id="zbar"></i></div>
          </div>
          <div class="right-col">
            <button class="icon-btn" id="btn-tablet" title="Tablet (T)" aria-label="Tablet">${ICON.tablet}</button>
            <button class="icon-btn" id="btn-pause" title="Pausa (Esc)" aria-label="Pausa">${ICON.pause}</button>
          </div>
        </div>
        <div class="crosshair" id="cross"><i></i></div>
        <div class="aim" id="aim"></div>
        <div class="notes" id="notes"></div>
        <div class="sub" id="sub"></div>
        <div class="hud-bottom">
          <div class="held" id="held"></div>
          <div class="cap" id="cap"></div>
        </div>
        <div class="touch-btns hidden" id="touch">
          <button class="tb tb-use hidden" id="tb-use">USAR</button>
          <button class="tb tb-act" id="tb-act">✋</button>
          <button class="tb tb-run" id="tb-run">⇧</button>
        </div>
        <div class="flash" id="flash"></div>
        <div class="vignette-red" id="vred"></div>
      </div>
      <div class="modal-back hidden" id="modal"><div class="modal glass" id="modal-box"></div></div>`;
    this.aimEl = $('#aim');
  }

  setMoney(n: number, mult: number) {
    const el = $('#money');
    el.textContent = fmt(n);
    el.parentElement!.classList.remove('bump');
    void el.parentElement!.offsetWidth;
    el.parentElement!.classList.add('bump');
    $('#mult').textContent = mult > 1.001 ? `×${mult.toFixed(1)}` : '';
  }
  setTokens(n: number) {
    const el = $('#tokens');
    el.classList.toggle('hidden', n === 0);
    el.innerHTML = Array.from({ length: 3 }, (_, i) => `<i class="tok ${i < n ? 'on' : ''}"></i>`).join('') + `<span>Fichas doradas</span>`;
  }
  setZone(zone: ZoneId, done: number, total: number) {
    const z = ZONES.find((x) => x.id === zone)!;
    $('#zname').textContent = z.name;
    ($('#zone') as HTMLElement).style.setProperty('--neon', z.neon);
    $('#zcount').textContent = done.toLocaleString('es-AR');
    $('#ztotal').textContent = total ? '/' + total.toLocaleString('es-AR') : '';
    ($('#zbar') as HTMLElement).style.width = total ? `${(100 * done) / total}%` : '100%';
  }
  setHeld(groups: HeldGroup[], active: number, cap: number, used: number) {
    const el = $('#held');
    el.innerHTML = groups.map((g, i) => {
      const cat = CATEGORIES.find((c) => c.kind === g.kind)!;
      const v = cat.variants[g.variant];
      const sw = v.color2 ? `linear-gradient(135deg, ${v.color} 55%, ${v.color2} 55%)` : v.color;
      return `<div class="hslot ${i === active ? 'on' : ''}" data-i="${i}"><i style="background:${sw}"></i><b>${g.count}</b><span>${cat.variants.length > 1 ? v.name : cat.name}</span></div>`;
    }).join('');
    $('#cap').innerHTML = `<span>${used}/${cap}</span><div class="capbar"><i style="width:${(100 * used) / cap}%"></i></div>`;
    $('#cap').classList.toggle('full', used >= cap);
  }
  aim(text: string, kind: '' | 'ok' | 'bad' | 'use' = '') {
    this.aimEl.textContent = text;
    this.aimEl.className = 'aim ' + kind + (text ? ' on' : '');
    $('#cross').className = 'crosshair' + (kind ? ' ' + kind : '');
  }
  /** Notificación lateral: título + detalle, con ícono según el tipo. */
  toast(title: string, ms = 2600, kind: 'info' | 'warn' | 'call' | 'cam' | 'coin' = 'info', body = '') {
    const box = $('#notes');
    if (!title) { box.querySelectorAll('.note[data-k="call"]').forEach((n) => this.dismiss(n as HTMLElement)); return; }
    const same = [...box.children].find((n) => (n as HTMLElement).dataset.t === title) as HTMLElement | undefined;
    if (same) this.dismiss(same, true);
    const el = h(`<div class="note" data-k="${kind}"><i class="ni">${ICON[kind]}</i><div class="nt"><b>${title}</b>${body ? `<span>${body}</span>` : ''}</div><i class="nbar" style="animation-duration:${ms}ms"></i></div>`);
    el.dataset.t = title;
    box.prepend(el);
    while (box.children.length > 3) this.dismiss(box.lastElementChild as HTMLElement, true);
    window.setTimeout(() => this.dismiss(el), ms);
  }
  private dismiss(el: HTMLElement, now = false) {
    if (!el.isConnected) return;
    if (now) { el.remove(); return; }
    el.classList.add('out');
    window.setTimeout(() => el.remove(), 380);
  }
  /** Subtítulo con quién habla (BOB, teléfono, vos). */
  say(who: string, text: string, dur = 3.6, cls = '') {
    this.subQueue.push({ who, text, dur, cls });
  }
  get speaking() { return this.subT > 0 || this.subQueue.length > 0; }
  update(dt: number) {
    if (this.subT > 0) {
      this.subT -= dt;
      if (this.subT <= 0) $('#sub').classList.remove('on');
    } else if (this.subQueue.length) {
      const s = this.subQueue.shift()!;
      const el = $('#sub');
      el.className = 'sub on ' + s.cls;
      el.innerHTML = `${s.who ? `<b>${s.who}</b>` : ''}<span>${s.text}</span>`;
      this.subT = s.dur;
      this.onSay?.(s.who);
    }
  }
  onSay: ((who: string) => void) | null = null;
  banner(title: string, sub: string, color = '#ffd9a0') {
    const el = h(`<div class="banner" style="--c:${color}"><b>${title}</b><span>${sub}</span></div>`);
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }
  floatText(text: string, cls = '') {
    const el = h(`<div class="float ${cls}">${text}</div>`);
    el.style.left = `${50 + (Math.random() - 0.5) * 8}%`;
    this.root.appendChild(el);
    setTimeout(() => el.remove(), 1100);
  }
  flash(color = '#fff', ms = 180) {
    const el = $('#flash');
    el.style.background = color;
    el.style.transition = 'none';
    el.style.opacity = '0.8';
    void el.offsetWidth;
    el.style.transition = `opacity ${ms}ms`;
    el.style.opacity = '0';
  }
  setDanger(v: number) { ($('#vred') as HTMLElement).style.opacity = String(v); }

  modal(html: string, cls = '', onClose: (() => void) | null = null) {
    const back = $('#modal'), box = $('#modal-box');
    box.className = 'modal glass ' + cls;
    box.innerHTML = `<button class="close" id="m-close">✕</button>` + html;
    back.classList.remove('hidden');
    this.modalOpen = true;
    this.onClose = onClose;
    $('#m-close').onclick = () => this.closeModal();
    return box;
  }
  closeModal() {
    if (!this.modalOpen) return;
    $('#modal').classList.add('hidden');
    $('#modal-box').innerHTML = '';
    this.modalOpen = false;
    const f = this.onClose;
    this.onClose = null;
    f?.();
  }

  shop(money: number, levels: Levels, buy: (id: UpgradeId) => void, extra: string) {
    const rows = UPGRADES.map((u) => {
      const l = levels[u.id], max = l >= u.max, c = u.cost(l);
      return `<div class="up ${max ? 'max' : money >= c ? 'can' : ''}">
        <div class="up-i">${ICON[u.id]}</div>
        <div class="up-t"><b>${u.name}</b><small>${u.desc}</small><div class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < l ? 'on' : ''}"></i>`).join('')}</div></div>
        <button data-id="${u.id}" ${max || money < c ? 'disabled' : ''}>${max ? 'MÁX' : fmt(c)}</button></div>`;
    }).join('');
    const box = this.modal(`<div class="tab-head"><div><small>TABLET</small><h2>Mejoras</h2></div><div class="tab-money">${fmt(money)}</div></div><div class="ups">${rows}</div>${extra}`, 'tablet');
    box.querySelectorAll<HTMLButtonElement>('.up button').forEach((b) => (b.onclick = () => buy(b.dataset.id as UpgradeId)));
    return box;
  }
}
