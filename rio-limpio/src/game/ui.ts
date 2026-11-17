import { UPGRADES, UpgradeId, Levels, stats, Stats, TRASH_TYPES, TOTAL_KG, VehicleId, Objective, VEHICLES } from './config';
import { t, fmt, fmtInt, fmtKg, fmtTime, lang, Lang } from './i18n';
import type { Settings } from './save';

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
function el(tag: string, cls = '', html = ''): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export const TRASH_ICON: Record<string, string> = {
  lata: '🥫', bolsa: '🛍️', botella: '🍾', neumatico: '🛞', tambor: '🛢️', heladera: '🧊', auto: '🚗', contenedor: '📦', barco: '🚢',
};
const VEHICLE_ICON: Record<VehicleId, string> = { remo: '🛶', lancha: '🚤', barcaza: '🛳️' };

export interface UIHooks {
  buy: (id: UpgradeId) => void;
  returnToPlant: () => void;
  click: () => void;
  settingsChanged: (s: Settings) => void;
  reset: () => void;
  shopToggled: (open: boolean) => void;
  riverInfo: () => { id: string; left: number; total: number; kg: number }[];
}

export interface HudState {
  money: number;
  remainingKg: number;
  remainingItems: number;
  load: number;
  cap: number;
  levels: Levels;
  unlocked: UpgradeId[];
  vehicle: VehicleId;
  canReturn: boolean;
  objective: Objective | null;
  objProgress: number;
  clean: number;
}

export class UI {
  root: HTMLElement;
  settings!: Settings;
  shopOpen = false;
  private money!: HTMLElement;
  private remaining!: HTMLElement;
  private itemsLeft!: HTMLElement;
  private pctLabel!: HTMLElement;
  private progressFill!: HTMLElement;
  private objBox!: HTMLElement;
  private objText!: HTMLElement;
  private objFill!: HTMLElement;
  private objNum!: HTMLElement;
  private objReward!: HTMLElement;
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
  private lastShopKey = '';
  private lastObjKey = '';
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
        <div class="top-col">
          <button class="progress card" aria-label="${s.riverTitle}">
            <div class="progress-label">${s.trashLeft}</div>
            <div class="progress-num">1.000.000 kg</div>
            <div class="progress-items">4.274 ${s.items}</div>
            <div class="bar"><div class="bar-fill"></div></div>
            <div class="progress-pct">0% ${s.clean}</div>
          </button>
          <div class="objective card">
            <div class="obj-row"><span class="obj-ico">🎯</span><span class="obj-text"></span><span class="obj-num"></span></div>
            <div class="bar thin"><div class="bar-fill obj-fill"></div></div>
            <div class="obj-reward"></div>
          </div>
        </div>
        <button class="icon-btn settings-btn" aria-label="${s.settings}">⚙︎</button>
      </div>
      <div class="hud-bottom">
        <button class="return-btn hidden">⟲ ${s.returnToPlant}</button>
        <div class="load pill"><span class="load-label">${s.load}</span><div class="bar small"><div class="bar-fill load-fill"></div></div><span class="load-v">0 / 30 kg</span></div>
      </div>
      <button class="shop-btn"><span class="shop-ico">🛠️</span><span class="shop-txt">${s.upgrades}</span><span class="badge hidden">0</span></button>
      <div class="hint"></div>
    `;
    this.root.appendChild(hud);
    this.money = $('.money-v', hud);
    this.remaining = $('.progress-num', hud);
    this.itemsLeft = $('.progress-items', hud);
    this.pctLabel = $('.progress-pct', hud);
    this.progressFill = $('.progress .bar-fill', hud);
    this.objBox = $('.objective', hud);
    this.objText = $('.obj-text', hud);
    this.objNum = $('.obj-num', hud);
    this.objFill = $('.obj-fill', hud);
    this.objReward = $('.obj-reward', hud);
    this.loadFill = $('.load-fill', hud);
    this.loadText = $('.load-v', hud);
    this.loadWrap = $('.load', hud);
    this.returnBtn = $('.return-btn', hud);
    this.shopBtn = $('.shop-btn', hud);
    this.badge = $('.badge', hud);
    this.hint = $('.hint', hud);

    const stop = (b: HTMLElement) => b.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.returnBtn.addEventListener('click', (e) => { e.stopPropagation(); this.hooks.click(); this.hooks.returnToPlant(); });
    this.shopBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleShop(); });
    $('.settings-btn', hud).addEventListener('click', (e) => { e.stopPropagation(); this.hooks.click(); this.openSettings(); });
    $('.progress', hud).addEventListener('click', (e) => { e.stopPropagation(); this.hooks.click(); this.openRiver(); });
    for (const b of [this.returnBtn, this.shopBtn, $('.settings-btn', hud), $('.progress', hud)]) stop(b);

    this.shop = el('div', 'shop');
    this.shop.innerHTML = `<div class="shop-head"><h2>${s.upgrades}</h2><button class="icon-btn close-shop">✕</button></div><div class="shop-list"></div>`;
    stop(this.shop);
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

  objectiveText(o: Objective): string {
    const s = t();
    switch (o.kind) {
      case 'items': return s.obj.items(fmtInt(o.target));
      case 'kg': return s.obj.kg(fmtInt(o.target));
      case 'type': return s.obj.type(fmtInt(o.target), s.trash[o.type!][o.target === 1 ? 0 : 1]);
      case 'all': return s.obj.all();
    }
  }

  rewardText(o: Objective): string {
    const s = t();
    const parts: string[] = [];
    if (o.reward.unlock) parts.push(`${UPGRADES.find((u) => u.id === o.reward.unlock)!.icon} ${s.up[o.reward.unlock][0]}`);
    if (o.reward.vehicle) parts.push(`${VEHICLE_ICON[o.reward.vehicle]} ${s.vehicles[o.reward.vehicle][0]}`);
    if (o.reward.money) parts.push(`$ ${fmt(o.reward.money)}`);
    return parts.length ? `${s.reward}: ${parts.join(' + ')}` : '';
  }

  update(h: HudState, dt: number) {
    const s = t();
    const diff = h.money - this.shownMoney;
    this.shownMoney += Math.abs(diff) < 1 ? diff : diff * Math.min(1, dt * 8);
    this.money.textContent = '$ ' + fmt(Math.floor(this.shownMoney));
    this.remaining.textContent = fmtKg(h.remainingKg);
    this.itemsLeft.textContent = `${fmtInt(h.remainingItems)} ${s.items}`;
    const clean = h.clean;
    const pct = clean * 100;
    this.pctLabel.textContent = `${pct < 10 ? pct.toFixed(2) : pct.toFixed(1)}% ${s.clean}`;
    this.progressFill.style.width = `${Math.min(100, pct)}%`;

    // objetivo
    if (h.objective) {
      const key = this.objectiveText(h.objective) + lang;
      if (key !== this.lastObjKey) {
        this.lastObjKey = key;
        this.objText.textContent = this.objectiveText(h.objective);
        this.objReward.textContent = this.rewardText(h.objective);
        this.objBox.classList.remove('pop');
        void this.objBox.offsetWidth;
        this.objBox.classList.add('pop');
      }
      const tgt = h.objective.target;
      this.objNum.textContent = h.objective.kind === 'all' ? '' : `${fmtInt(Math.min(h.objProgress, tgt))}/${fmtInt(tgt)}`;
      this.objFill.style.width = `${Math.min(100, (h.objProgress / tgt) * 100)}%`;
      this.objBox.classList.remove('hidden');
    } else this.objBox.classList.add('hidden');

    const lf = h.cap > 0 ? Math.min(1, h.load / h.cap) : 0;
    this.loadFill.style.width = `${lf * 100}%`;
    this.loadText.textContent = `${fmt(Math.floor(Math.min(h.load, h.cap)))} / ${fmt(h.cap)} kg`;
    this.loadWrap.classList.toggle('full', lf >= 1);
    this.returnBtn.classList.toggle('hidden', !h.canReturn);
    this.returnBtn.classList.toggle('urgent', lf >= 1);

    let affordable = 0;
    for (const u of UPGRADES) if (h.unlocked.includes(u.id) && h.levels[u.id] < u.max && u.cost(h.levels[u.id]) <= h.money) affordable++;
    this.badge.textContent = String(affordable);
    this.badge.classList.toggle('hidden', affordable === 0);
    this.shopBtn.classList.toggle('glow', affordable > 0);

    if (this.shopOpen) this.renderShop(h);
  }

  private describe(id: UpgradeId, st: Stats, lv: number): string {
    const s = t();
    switch (id) {
      case 'mano': return `${st.radius.toFixed(1)} m`;
      case 'red': return lv === 0 ? '—' : `${st.radius.toFixed(1)} m`;
      case 'motor': return `${st.speed.toFixed(1)} m/s`;
      case 'bodega': return `${fmt(st.capacity)} kg`;
      case 'grua': return s.craneTiers[lv] ?? '';
      case 'planta': return `$ ${st.pricePerKg.toFixed(2)}/kg`;
      case 'iman': return `${st.magnetRadius.toFixed(1)} m`;
      case 'aspiradora': return `${st.suctionRadius.toFixed(1)} m`;
      case 'flota': return `${st.helpers} 🚤`;
      case 'drones': return `${st.drones} 🛸`;
    }
  }

  private renderShop(h: HudState) {
    const key = JSON.stringify(h.levels) + h.unlocked.join() + h.vehicle + '|' + UPGRADES.map((u) => (u.cost(h.levels[u.id]) <= h.money ? 1 : 0)).join('') + lang;
    if (key === this.lastShopKey) return;
    this.lastShopKey = key;
    const s = t();
    const cur = stats(h.levels, h.vehicle);
    this.shopList.innerHTML = '';
    const [vn, vd] = s.vehicles[h.vehicle];
    this.shopList.appendChild(el('div', 'veh-card', `<div class="veh-ico">${VEHICLE_ICON[h.vehicle]}</div><div><div class="up-name">${vn}</div><div class="up-desc">${vd}</div><div class="up-val">${VEHICLES[h.vehicle].speed} m/s · ${fmt(VEHICLES[h.vehicle].capacity)} kg base</div></div>`));
    // primero lo desbloqueado, después lo bloqueado (como adelanto)
    const ordered = [...UPGRADES].sort((a, b) => Number(!h.unlocked.includes(a.id)) - Number(!h.unlocked.includes(b.id)));
    for (const u of ordered) {
      const unlocked = h.unlocked.includes(u.id);
      // la mano deja de importar cuando tenés red
      if (u.id === 'mano' && h.unlocked.includes('red') && h.levels.mano === 0) continue;
      const lv = h.levels[u.id];
      const maxed = lv >= u.max;
      const cost = u.cost(lv);
      const next = maxed ? null : stats({ ...h.levels, [u.id]: lv + 1 }, h.vehicle);
      const [name, desc] = s.up[u.id];
      const card = el('div', `up-card up-${u.id}` + (maxed ? ' maxed' : '') + (unlocked ? '' : ' locked'));
      if (!unlocked) {
        card.innerHTML = `<div class="up-ico">🔒</div><div class="up-body"><div class="up-name">${name}</div><div class="up-desc">${s.locked}</div></div><div class="buy-ph">${u.icon}</div>`;
        this.shopList.appendChild(card);
        continue;
      }
      const pips = u.max <= 8 ? Array.from({ length: u.max }, (_, i) => `<i class="${i < lv ? 'on' : ''}"></i>`).join('') : '';
      card.innerHTML = `
        <div class="up-ico">${u.icon}</div>
        <div class="up-body">
          <div class="up-name">${name} <span class="up-lv">${s.level} ${lv}/${u.max}</span></div>
          <div class="up-desc">${desc}</div>
          <div class="up-val">${this.describe(u.id, cur, lv)}${next ? ` <b>→ ${this.describe(u.id, next, lv + 1)}</b>` : ''}</div>
          ${pips ? `<div class="pips">${pips}</div>` : `<div class="lvbar"><div style="width:${(lv / u.max) * 100}%"></div></div>`}
        </div>
        ${u.id === 'grua' ? `<div class="buy-obj">🎯<span>${s.craneByGoal}</span></div>` : `<button class="buy" ${maxed || cost > h.money ? 'disabled' : ''}>${maxed ? s.max : '$ ' + fmt(cost)}</button>`}`;
      const btn = card.querySelector('.buy') as HTMLButtonElement | null;
      btn?.addEventListener('click', () => {
        if (!btn || btn.disabled) return;
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
    if (this.floatLayer.childElementCount > 40) return;
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
      const sx = x + (Math.random() - 0.5) * 60, sy = y + (Math.random() - 0.5) * 40;
      c.style.left = `${sx}px`;
      c.style.top = `${sy}px`;
      this.floatLayer.appendChild(c);
      const delay = i * 35;
      setTimeout(() => {
        c.style.transform = `translate(${tx - sx}px, ${ty - sy}px) scale(0.6)`;
        c.style.opacity = '0.9';
      }, 30 + delay);
      setTimeout(() => {
        c.remove();
        const pill = this.money.parentElement!;
        pill.classList.remove('bump');
        void pill.offsetWidth;
        pill.classList.add('bump');
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

  /** Confirmación dentro del juego (confirm() nativo no funciona en webviews/iframes). */
  ask(text: string, onYes: () => void) {
    const s = t();
    const m = this.modal(`<p class="ask-t">${text}</p><div class="modal-btns"><button class="ghost-btn no">${s.cancel}</button><button class="big-btn danger-btn yes">${s.yes}</button></div>`, 'ask');
    $('.no', m).addEventListener('click', () => { this.hooks.click(); this.closeModal(m); });
    $('.yes', m).addEventListener('click', () => { this.closeModal(m); onYes(); });
  }

  /** Anuncio grande de herramienta / vehículo nuevo. */
  unlockCard(icon: string, kind: 'tool' | 'vehicle', name: string, desc: string, onClose: () => void) {
    const s = t();
    const m = this.modal(`
      <div class="unlock-rays"></div>
      <div class="unlock-ico">${icon}</div>
      <div class="unlock-kicker">${kind === 'tool' ? s.newTool : s.newVehicle}</div>
      <h2>${name}</h2>
      <p>${desc}</p>
      <div class="modal-btns"><button class="big-btn ok">${s.ok}</button></div>`, 'unlock');
    $('.ok', m).addEventListener('click', () => { this.closeModal(m); onClose(); });
  }

  openRiver() {
    const s = t();
    const rows = this.hooks.riverInfo()
      .map((r) => {
        const done = r.left === 0;
        return `<div class="river-row ${done ? 'done' : ''}">
          <span class="rr-ico">${TRASH_ICON[r.id]}</span>
          <span class="rr-name">${s.trash[r.id as keyof typeof s.trash][1]}</span>
          <span class="rr-bar"><i style="width:${(1 - r.left / r.total) * 100}%"></i></span>
          <span class="rr-num">${done ? '✓' : `${fmtInt(r.left)} ${s.remaining}`}</span>
          <span class="rr-kg">${fmtKg(r.left * r.kg)}</span>
        </div>`;
      })
      .join('');
    const m = this.modal(`<h2>${s.riverTitle}</h2><div class="river-list">${rows}</div><div class="modal-btns"><button class="big-btn close">${s.close}</button></div>`, 'river');
    $('.close', m).addEventListener('click', () => { this.hooks.click(); this.closeModal(m); });
  }

  showTitle(hasSave: boolean, isTouch: boolean, onPlay: () => void, onNew: () => void) {
    const s = t();
    const scr = el('div', 'title-screen');
    scr.innerHTML = `
      <div class="logo">
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
    const close = () => {
      scr.classList.add('out');
      setTimeout(() => scr.remove(), 700);
    };
    (this as any).closeTitle = close;
    $('.play', scr).addEventListener('click', () => { close(); onPlay(); });
    scr.querySelector('.new')?.addEventListener('click', () => {
      this.ask(s.resetConfirm, () => { close(); onNew(); });
    });
  }

  openSettings() {
    const s = t();
    const st = this.settings;
    const qBtn = (v: number | null, label: string) => `<button data-v="${v === null ? 'a' : v}" class="${st.quality === v ? 'on' : ''}">${label}</button>`;
    const m = this.modal(`
      <h2>${s.settings}</h2>
      <label class="row"><span>${s.music}</span><input id="r-music" type="range" min="0" max="1" step="0.05" class="r-music" value="${st.music}"></label>
      <label class="row"><span>${s.sfx}</span><input id="r-sfx" type="range" min="0" max="1" step="0.05" class="r-sfx" value="${st.sfx}"></label>
      <div class="row"><span>${s.quality}</span><div class="seg q">${qBtn(null, s.auto)}${qBtn(0, s.qualities[0])}${qBtn(1, s.qualities[1])}${qBtn(2, s.qualities[2])}</div></div>
      <div class="row"><span>${s.language}</span><div class="seg l"><button data-v="es" class="${lang === 'es' ? 'on' : ''}">Español</button><button data-v="en" class="${lang === 'en' ? 'on' : ''}">English</button></div></div>
      <div class="note">${s.reloadNeeded}: ${s.quality.toLowerCase()} / ${s.language.toLowerCase()}</div>
      <div class="modal-btns"><button class="ghost-btn danger reset">${s.reset}</button><button class="big-btn close">${s.close}</button></div>
    `);
    const emit = () => this.hooks.settingsChanged(st);
    $('.r-music', m).addEventListener('input', (e) => { st.music = +(e.target as HTMLInputElement).value; emit(); });
    $('.r-sfx', m).addEventListener('input', (e) => { st.sfx = +(e.target as HTMLInputElement).value; emit(); });
    m.querySelectorAll('.seg.q button').forEach((b) => b.addEventListener('click', () => {
      const v = (b as HTMLElement).dataset.v!;
      st.quality = v === 'a' ? null : (+v as 0 | 1 | 2);
      m.querySelectorAll('.seg.q button').forEach((x) => x.classList.toggle('on', x === b));
      emit();
    }));
    m.querySelectorAll('.seg.l button').forEach((b) => b.addEventListener('click', () => {
      st.lang = (b as HTMLElement).dataset.v as Lang;
      m.querySelectorAll('.seg.l button').forEach((x) => x.classList.toggle('on', x === b));
      emit();
    }));
    $('.reset', m).addEventListener('click', () => this.ask(s.resetConfirm, () => this.hooks.reset()));
    $('.close', m).addEventListener('click', () => { this.hooks.click(); this.closeModal(m); });
  }

  end(time: number, trips: number, onKeep: () => void) {
    const s = t();
    const m = this.modal(`
      <div class="modal-ico">🐟🌿🐦</div>
      <h2>${s.endTitle}</h2>
      <p>${s.endText}</p>
      <div class="stats-row"><div><b>${fmtTime(time)}</b><span>${s.time}</span></div><div><b>${fmt(trips)}</b><span>${s.trips}</span></div><div><b>${fmtInt(TOTAL_KG)}</b><span>kg</span></div></div>
      <div class="modal-btns"><button class="big-btn ok">${s.keepPlaying}</button></div>`, 'end');
    $('.ok', m).addEventListener('click', () => { onKeep(); this.closeModal(m); });
  }
}

export { TRASH_TYPES };
