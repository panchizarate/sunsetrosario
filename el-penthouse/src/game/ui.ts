// Interfaz: HUD, mensajes, subtítulos, modales. Estilo lujo oscuro + neón.
import { CATEGORIES, UPGRADES, ZONES, ZoneId, Levels, UpgradeId } from './config';

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
export const h = (html: string) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild as HTMLElement; };
export const fmt = (n: number) => '$' + Math.floor(n).toLocaleString('es-AR');

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
            <button class="icon-btn" id="btn-tablet" title="Tablet (T)">▦</button>
            <button class="icon-btn" id="btn-pause" title="Pausa (Esc)">❚❚</button>
          </div>
        </div>
        <div class="crosshair" id="cross"><i></i></div>
        <div class="aim" id="aim"></div>
        <div class="toast" id="toast"></div>
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
  toast(text: string, ms = 2200) {
    const el = $('#toast');
    el.innerHTML = text;
    el.classList.add('on');
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => el.classList.remove('on'), ms);
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
    const el = h(`<div class="banner" style="--c:${color}"><small>${sub}</small><b>${title}</b></div>`);
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
        <div class="up-i">${u.icon}</div>
        <div class="up-t"><b>${u.name}</b><small>${u.desc}</small><div class="pips">${Array.from({ length: u.max }, (_, i) => `<i class="${i < l ? 'on' : ''}"></i>`).join('')}</div></div>
        <button data-id="${u.id}" ${max || money < c ? 'disabled' : ''}>${max ? 'MÁX' : fmt(c)}</button></div>`;
    }).join('');
    const box = this.modal(`<div class="tab-head"><div><small>TABLET</small><h2>Mejoras</h2></div><div class="tab-money">${fmt(money)}</div></div><div class="ups">${rows}</div>${extra}`, 'tablet');
    box.querySelectorAll<HTMLButtonElement>('.up button').forEach((b) => (b.onclick = () => buy(b.dataset.id as UpgradeId)));
    return box;
  }
}
