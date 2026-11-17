import { UPGRADES, UpgradeId, Levels, stats, Stats, MILESTONES } from './config';
import { t, fmt, fmtKg, fmtTime, lang, Lang } from './i18n';
import type { Settings } from './save';

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
function el(tag: string, cls = '', html = ''): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export interface UIHooks {
  buy: (id: UpgradeId) => void;
  returnToPlant: () => void;
  click: () => void;
  settingsChanged: (s: Settings) => void;
  reset: () => void;
  shopToggled: (open: boolean) => void;
}

export class UI {
  root: HTMLElement;
  private money!: HTMLElement;
  private remaining!: HTMLElement;
  private pctLabel!: HTMLElement;
  private progressFill!: HTMLElement;
  private loadFill!: HTMLElement;
  private loadText!: HTMLElement;
  private loadWrap!: HTMLElement;
  private returnBtn!: HTMLButtonElement;
  private shopBtn!: HTMLButtonElement;
  private badge!: HTMLElement;
  private shop!: HTMLElement;
  private shopList!: HTMLElement;
  private toastBox!: HTMLElement;
  private floatLayer!: HTMLElement;
  private hint!: HTMLElement;
  shopOpen = false;
  settings!: Settings;
  private lastShopKey = '';
  private shownMoney = 0;

  constructor(private hooks: UIHooks) {
    this.root = $('#ui');
    this.build();
  }

  private build() {
    const s = t();
    this.root.innerHTML = '';
    const hud = el('div', 'hud');
    hud.innerHTML = `
      <div class="hud-top">
        <div class="money pill"><span class="coin"></span><span class="money-v">$ 0</span></div>
        <div class="progress card">
          <div class="progress-label">${s.trashLeft}</div>
          <div class="progress-num">1.000.000 kg</div>
          <div class="bar"><div class="bar-fill"></div></div>
          <div class="progress-pct">0% ${s.clean}</div>
        </div>
        <button class="icon-btn settings-btn" aria-label="${s.settings}">⚙︎</button>
      </div>
      <div class="hud-bottom">
        <button class="return-btn hidden">⟲ ${s.returnToPlant}</button>
        <div class="load pill"><span class="load-label">${s.load}</span><div class="bar small"><div class="bar-fill load-fill"></div></div><span class="load-v">0 / 40 kg</span></div>
      </div>
      <button class="shop-btn"><span class="shop-ico">🛠️</span><span class="shop-txt">${s.upgrades}</span><span class="badge hidden">0</span></button>
      <div class="hint"></div>
    `;
    this.root.appendChild(hud);
    this.money = $('.money-v', hud);
    this.remaining = $('.progress-num', hud);
    this.pctLabel = $('.progress-pct', hud);
    this.progressFill = $('.progress .bar-fill', hud);
    this.loadFill = $('.load-fill', hud);
    this.loadText = $('.load-v', hud);
    this.loadWrap = $('.load', hud);
    this.returnBtn = $('.return-btn', hud);
    this.shopBtn = $('.shop-btn', hud);
    this.badge = $('.badge', hud);
    this.hint = $('.hint', hud);

    this.returnBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hooks.click();
      this.hooks.returnToPlant();
    });
    this.shopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleShop();
    });
    $('.settings-btn', hud).addEventListener('click', (e) => {
      e.stopPropagation();
      this.hooks.click();
      this.openSettings();
    });
    for (const b of [this.returnBtn, this.shopBtn, $('.settings-btn', hud)]) b.addEventListener('pointerdown', (e) => e.stopPropagation());

    // tienda
    this.shop = el('div', 'shop');
    this.shop.innerHTML = `<div class="shop-head"><h2>${s.upgrades}</h2><button class="icon-btn close-shop">✕</button></div><div class="shop-list"></div>`;
    this.shop.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.appendChild(this.shop);
    this.shopList = $('.shop-list', this.shop);
    $('.close-shop', this.shop).addEventListener('click', () => this.toggleShop(false));

    this.toastBox = el('div', 'toasts');
    this.root.appendChild(this.toastBox);
    this.floatLayer = el('div', 'floats');
    this.root.appendChild(this.floatLayer);
  }

  setHudVisible(v: boolean) {
    this.root.classList.toggle('hud-hidden', !v);
  }

  toggleShop(open = !this.shopOpen) {
    this.shopOpen = open;
    this.shop.classList.toggle('open', open);
    this.lastShopKey = '';
    this.hooks.click();
    this.hooks.shopToggled(open);
  }

  update(money: number, remaining: number, clean: number, load: number, cap: number, levels: Levels, canReturn: boolean, dt: number) {
    const s = t();
    // dinero con conteo animado
    const diff = money - this.shownMoney;
    this.shownMoney += Math.abs(diff) < 1 ? diff : diff * Math.min(1, dt * 8);
    this.money.textContent = '$ ' + fmt(Math.floor(this.shownMoney));
    this.remaining.textContent = fmtKg(Math.max(0, remaining));
    const pct = clean * 100;
    // la barra muestra el avance hacia el próximo hito (siempre hay un objetivo cercano)
    const next = MILESTONES.find((m) => m > clean + 1e-9) ?? 1;
    const prev = [...MILESTONES].reverse().find((m) => m <= clean + 1e-9) ?? 0;
    const seg = next > prev ? (clean - prev) / (next - prev) : 1;
    const pf = (v: number) => (v * 100 < 1 ? (v * 100).toFixed(2) : v * 100 < 10 ? (v * 100).toFixed(1) : (v * 100).toFixed(0));
    this.pctLabel.textContent = clean >= 1 ? `100% ${s.clean}` : `${pf(clean)}% ${s.clean} · ${s.next}: ${pf(next)}%`;
    this.progressFill.style.width = `${Math.min(100, seg * 100)}%`;
    const lf = cap > 0 ? Math.min(1, load / cap) : 0;
    this.loadFill.style.width = `${lf * 100}%`;
    this.loadText.textContent = `${fmt(Math.floor(Math.min(load, cap)))} / ${fmt(cap)} kg`;
    this.loadWrap.classList.toggle('full', lf >= 1);
    this.returnBtn.classList.toggle('hidden', !canReturn);
    this.returnBtn.classList.toggle('urgent', lf >= 1);

    // badge: mejoras compradas
    let affordable = 0;
    for (const u of UPGRADES) if (levels[u.id] < u.max && u.cost(levels[u.id]) <= money) affordable++;
    this.badge.textContent = String(affordable);
    this.badge.classList.toggle('hidden', affordable === 0);
    this.shopBtn.classList.toggle('glow', affordable > 0);

    if (this.shopOpen) this.renderShop(levels, money);
  }

  private describe(id: UpgradeId, st: Stats, lv: number): string {
    const s = t();
    switch (id) {
      case 'red': return `${st.radius.toFixed(1)} m`;
      case 'motor': return `${st.speed.toFixed(1)} m/s`;
      case 'bodega': return `${fmt(st.capacity)} kg`;
      case 'grua': return s.craneTiers[lv] ?? '';
      case 'planta': return `$ ${st.pricePerKg.toFixed(2)}/kg`;
      case 'flota': return `${st.helpers} 🚤`;
      case 'barreras': return `${fmt(st.barrierKgPerSec, 1)} kg/s`;
      case 'rastra': return `x${st.kgMult.toFixed(1)}`;
    }
  }

  private renderShop(levels: Levels, money: number) {
    const key = JSON.stringify(levels) + '|' + UPGRADES.map((u) => (u.cost(levels[u.id]) <= money ? 1 : 0)).join('') + lang;
    if (key === this.lastShopKey) return;
    this.lastShopKey = key;
    const s = t();
    const cur = stats(levels);
    this.shopList.innerHTML = '';
    for (const u of UPGRADES) {
      const lv = levels[u.id];
      const maxed = lv >= u.max;
      const cost = u.cost(lv);
      const next = maxed ? null : stats({ ...levels, [u.id]: lv + 1 });
      const card = el('div', `up-card up-${u.id}` + (maxed ? ' maxed' : ''));
      const [name, desc] = s.up[u.id];
      const pips = u.max <= 6 ? Array.from({ length: u.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('') : '';
      card.innerHTML = `
        <div class="up-ico">${u.icon}</div>
        <div class="up-body">
          <div class="up-name">${name} <span class="up-lv">${s.level} ${lv}/${u.max}</span></div>
          <div class="up-desc">${desc}</div>
          <div class="up-val">${this.describe(u.id, cur, lv)}${next ? ` <b>→ ${this.describe(u.id, next, lv + 1)}</b>` : ''}</div>
          ${pips ? `<div class="pips">${pips}</div>` : `<div class="lvbar"><div style="width:${(lv / u.max) * 100}%"></div></div>`}
        </div>
        <button class="buy" ${maxed || cost > money ? 'disabled' : ''}>${maxed ? s.max : '$ ' + fmt(cost)}</button>`;
      const btn = card.querySelector('.buy') as HTMLButtonElement;
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        this.hooks.buy(u.id);
        card.classList.remove('bought');
        void card.offsetWidth;
        card.classList.add('bought');
      });
      this.shopList.appendChild(card);
    }
  }

  // ---------------------------------------------------------- efectos de pantalla
  floatText(x: number, y: number, text: string, cls = '') {
    const e = el('div', 'float ' + cls, text);
    e.style.left = `${x}px`;
    e.style.top = `${y}px`;
    this.floatLayer.appendChild(e);
    setTimeout(() => e.remove(), 1300);
  }

  coinsTo(x: number, y: number, n: number) {
    const target = this.money.getBoundingClientRect();
    const tx = target.left + 12, ty = target.top + target.height / 2;
    for (let i = 0; i < n; i++) {
      const c = el('div', 'fly-coin');
      c.style.left = `${x + (Math.random() - 0.5) * 60}px`;
      c.style.top = `${y + (Math.random() - 0.5) * 40}px`;
      this.floatLayer.appendChild(c);
      const delay = i * 35;
      setTimeout(() => {
        c.style.transform = `translate(${tx - parseFloat(c.style.left)}px, ${ty - parseFloat(c.style.top)}px) scale(0.6)`;
        c.style.opacity = '0.9';
      }, 30 + delay);
      setTimeout(() => {
        c.remove();
        this.money.parentElement!.classList.remove('bump');
        void this.money.parentElement!.offsetWidth;
        this.money.parentElement!.classList.add('bump');
      }, 650 + delay);
    }
  }

  toast(title: string, sub = '', kind = '') {
    const e = el('div', 'toast ' + kind, `<div class="toast-t">${title}</div>${sub ? `<div class="toast-s">${sub}</div>` : ''}`);
    this.toastBox.appendChild(e);
    setTimeout(() => e.classList.add('out'), 3800);
    setTimeout(() => e.remove(), 4400);
  }

  showHint(text: string, ms = 4000) {
    this.hint.textContent = text;
    this.hint.classList.add('on');
    clearTimeout((this as any)._ht);
    (this as any)._ht = setTimeout(() => this.hint.classList.remove('on'), ms);
  }

  // ---------------------------------------------------------- modales
  modal(html: string, cls = ''): HTMLElement {
    const back = el('div', 'modal-back ' + cls);
    const box = el('div', 'modal', html);
    back.appendChild(box);
    back.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.appendChild(back);
    requestAnimationFrame(() => back.classList.add('in'));
    return back;
  }
  closeModal(m: HTMLElement) {
    m.classList.remove('in');
    setTimeout(() => m.remove(), 300);
  }

  showTitle(hasSave: boolean, isTouch: boolean, onPlay: () => void, onNew: () => void) {
    const s = t();
    const scr = el('div', 'title-screen');
    scr.innerHTML = `
      <div class="logo">
        <div class="logo-drop">💧</div>
        <h1>${s.title}</h1>
        <svg class="logo-wave" viewBox="0 0 300 24"><path d="M0 12 Q 25 0 50 12 T 100 12 T 150 12 T 200 12 T 250 12 T 300 12" /></svg>
        <p>${s.subtitle}</p>
      </div>
      <div class="title-btns">
        <button class="big-btn play">${hasSave ? s.continue : s.play}</button>
        ${hasSave ? `<button class="ghost-btn new">${s.newGame}</button>` : ''}
      </div>
      <div class="title-foot">🎧 ${isTouch ? s.controlsMobile : s.controlsDesktop}</div>`;
    scr.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.appendChild(scr);
    (this as any).closeTitle = () => close();
    const close = () => {
      scr.classList.add('out');
      setTimeout(() => scr.remove(), 700);
    };
    $('.play', scr).addEventListener('click', () => { close(); onPlay(); });
    const nb = scr.querySelector('.new');
    nb?.addEventListener('click', () => {
      if (!confirm(s.resetConfirm)) return;
      close();
      onNew();
    });
  }

  openSettings() {
    const s = t();
    const st = this.settings;
    const m = this.modal(`
      <h2>${s.settings}</h2>
      <label class="row"><span>${s.music}</span><input type="range" min="0" max="1" step="0.05" class="r-music" value="${st.music}"></label>
      <label class="row"><span>${s.sfx}</span><input type="range" min="0" max="1" step="0.05" class="r-sfx" value="${st.sfx}"></label>
      <div class="row"><span>${s.quality}</span><div class="seg q"><button data-v="1" class="${st.high !== false ? 'on' : ''}">${s.high}</button><button data-v="0" class="${st.high === false ? 'on' : ''}">${s.low}</button></div></div>
      <div class="row"><span>${s.language}</span><div class="seg l"><button data-v="es" class="${lang === 'es' ? 'on' : ''}">Español</button><button data-v="en" class="${lang === 'en' ? 'on' : ''}">English</button></div></div>
      <div class="note">${s.reloadNeeded}: ${s.quality.toLowerCase()} / ${s.language.toLowerCase()}</div>
      <div class="modal-btns"><button class="ghost-btn danger reset">${s.reset}</button><button class="big-btn close">${s.close}</button></div>
    `);
    const emit = () => this.hooks.settingsChanged(st);
    $('.r-music', m).addEventListener('input', (e) => { st.music = +(e.target as HTMLInputElement).value; emit(); });
    $('.r-sfx', m).addEventListener('input', (e) => { st.sfx = +(e.target as HTMLInputElement).value; emit(); });
    m.querySelectorAll('.seg.q button').forEach((b) => b.addEventListener('click', () => {
      st.high = (b as HTMLElement).dataset.v === '1';
      m.querySelectorAll('.seg.q button').forEach((x) => x.classList.toggle('on', x === b));
      emit();
    }));
    m.querySelectorAll('.seg.l button').forEach((b) => b.addEventListener('click', () => {
      st.lang = (b as HTMLElement).dataset.v as Lang;
      m.querySelectorAll('.seg.l button').forEach((x) => x.classList.toggle('on', x === b));
      emit();
    }));
    $('.reset', m).addEventListener('click', () => {
      if (confirm(s.resetConfirm)) this.hooks.reset();
    });
    $('.close', m).addEventListener('click', () => { this.hooks.click(); this.closeModal(m); });
  }

  offline(kg: number, money: number, onCollect: () => void) {
    const s = t();
    const m = this.modal(`
      <div class="modal-ico">🟨</div>
      <h2>${s.welcomeBack}</h2>
      <p>${s.offlineEarned}</p>
      <div class="big-num">${fmtKg(kg)}</div>
      <div class="big-money">+ $ ${fmt(money)}</div>
      <div class="modal-btns"><button class="big-btn ok">${s.collect}</button></div>`);
    $('.ok', m).addEventListener('click', () => { onCollect(); this.closeModal(m); });
  }

  end(time: number, trips: number, onKeep: () => void) {
    const s = t();
    const m = this.modal(`
      <div class="modal-ico">🐟🌿🐦</div>
      <h2>${s.endTitle}</h2>
      <p>${s.endText}</p>
      <div class="stats-row"><div><b>${fmtTime(time)}</b><span>${s.time}</span></div><div><b>${fmt(trips)}</b><span>${s.trips}</span></div><div><b>1.000.000</b><span>kg</span></div></div>
      <div class="modal-btns"><button class="big-btn ok">${s.keepPlaying}</button></div>`, 'end');
    $('.ok', m).addEventListener('click', () => { onKeep(); this.closeModal(m); });
  }
}
