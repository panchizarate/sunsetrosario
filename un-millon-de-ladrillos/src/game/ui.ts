import { UPGRADES, UpgradeId, Levels, stats, Stats, Objective, ToolId, TOOL_ORDER, TOTAL_BRICKS } from './config';
import { t, fmt, fmtInt, fmtTime, lang, Lang } from './i18n';
import type { Settings } from './save';

const $ = <T extends HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
function el(tag: string, cls = '', html = ''): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export const TOOL_ICON: Record<ToolId, string> = { martillo: '🔨', maza: '⚒️', neumatico: '🛠️', bola: '🏗️', explosivos: '💥' };
const TOOL_UPGRADE: Record<ToolId, UpgradeId> = { martillo: 'martillo', maza: 'maza', neumatico: 'neumatico', bola: 'bola', explosivos: 'explosivos' };

export interface UIHooks {
  buy: (id: UpgradeId) => void;
  click: () => void;
  settingsChanged: (s: Settings) => void;
  reset: () => void;
  shopToggled: (open: boolean) => void;
  selectTool: (id: ToolId) => void;
  fire: (down: boolean) => void;
  jump: () => void;
  detonate: () => void;
  start: () => void;
}

export interface HudState {
  money: number;
  standing: number;
  ground: number;
  carried: number;
  cap: number;
  levels: Levels;
  unlocked: UpgradeId[];
  tool: ToolId;
  objective: Objective | null;
  objProgress: number;
  charges: number;
  cooldown: number; // 0..1 (bola)
  aimHit: boolean;
}

export class UI {
  root: HTMLElement;
  settings!: Settings;
  shopOpen = false;
  modalOpen = 0;
  private money!: HTMLElement;
  private standing!: HTMLElement;
  private pct!: HTMLElement;
  private bar!: HTMLElement;
  private ground!: HTMLElement;
  private objBox!: HTMLElement;
  private objText!: HTMLElement;
  private objNum!: HTMLElement;
  private objFill!: HTMLElement;
  private objReward!: HTMLElement;
  private loadFill!: HTMLElement;
  private loadText!: HTMLElement;
  private loadWrap!: HTMLElement;
  private hotbar!: HTMLElement;
  private cross!: HTMLElement;
  private detBtn!: HTMLButtonElement;
  private shopBtn!: HTMLButtonElement;
  private badge!: HTMLElement;
  private shop!: HTMLElement;
  private shopList!: HTMLElement;
  private toastBox!: HTMLElement;
  private floats!: HTMLElement;
  private hint!: HTMLElement;
  private banner!: HTMLElement;
  private lastShopKey = '';
  private lastObjKey = '';
  private lastHotKey = '';
  private shownMoney = 0;

  constructor(private hooks: UIHooks, isTouch: boolean) {
    this.root = $('#ui');
    this.root.classList.toggle('touch', isTouch);
    this.build(isTouch);
  }

  private build(isTouch: boolean) {
    const s = t();
    this.root.innerHTML = '';
    const hud = el('div', 'hud');
    hud.innerHTML = `
      <div class="hud-top">
        <div class="money pill"><span class="coin"></span><span class="money-v">$ 0</span></div>
        <div class="top-col">
          <div class="progress card">
            <div class="p-label">${s.standing}</div>
            <div class="p-num">1.000.000</div>
            <div class="bar"><i class="p-fill"></i></div>
            <div class="p-sub"><span class="p-pct">0%</span><span class="p-ground"></span></div>
          </div>
          <div class="objective card">
            <div class="obj-row"><span class="obj-ico">🎯</span><span class="obj-text"></span><span class="obj-num"></span></div>
            <div class="bar thin"><i class="obj-fill"></i></div>
            <div class="obj-reward"></div>
          </div>
        </div>
        <button class="icon-btn settings-btn" aria-label="${s.settings}">⚙︎</button>
      </div>
      <div class="crosshair"><i></i></div>
      <div class="hud-bottom">
        <div class="load pill"><span class="load-ico">🛒</span><div class="bar small"><i class="load-fill"></i></div><span class="load-v">0 / 60</span></div>
        <div class="hotbar"></div>
      </div>
      <button class="shop-btn"><span class="shop-ico">🛠️</span><span>${s.upgrades}</span><span class="badge hidden">0</span></button>
      <button class="det-btn hidden">💥 ${s.detonate}</button>
      ${isTouch ? `<button class="fire-btn">🔨</button><button class="jump-btn">⤒</button>` : ''}
      <div class="hint"></div>
      <div class="banner"></div>`;
    this.root.appendChild(hud);
    this.money = $('.money-v', hud);
    this.standing = $('.p-num', hud);
    this.pct = $('.p-pct', hud);
    this.bar = $('.p-fill', hud);
    this.ground = $('.p-ground', hud);
    this.objBox = $('.objective', hud);
    this.objText = $('.obj-text', hud);
    this.objNum = $('.obj-num', hud);
    this.objFill = $('.obj-fill', hud);
    this.objReward = $('.obj-reward', hud);
    this.loadFill = $('.load-fill', hud);
    this.loadText = $('.load-v', hud);
    this.loadWrap = $('.load', hud);
    this.hotbar = $('.hotbar', hud);
    this.cross = $('.crosshair', hud);
    this.detBtn = $('.det-btn', hud);
    this.shopBtn = $('.shop-btn', hud);
    this.badge = $('.badge', hud);
    this.hint = $('.hint', hud);
    this.banner = $('.banner', hud);
    const stop = (b: Element) => b.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.shopBtn.addEventListener('click', () => this.toggleShop());
    $('.settings-btn', hud).addEventListener('click', () => { this.hooks.click(); this.openSettings(); });
    this.detBtn.addEventListener('click', () => this.hooks.detonate());
    [this.shopBtn, $('.settings-btn', hud), this.detBtn, this.hotbar].forEach(stop);
    const fire = hud.querySelector('.fire-btn');
    if (fire) {
      fire.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.hooks.fire(true); });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) fire.addEventListener(ev, () => this.hooks.fire(false));
    }
    const jump = hud.querySelector('.jump-btn');
    jump?.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.hooks.jump(); });

    this.shop = el('div', 'shop');
    this.shop.innerHTML = `<div class="shop-head"><h2>${s.upgrades}</h2><button class="icon-btn close-shop">✕</button></div><div class="shop-list"></div>`;
    stop(this.shop);
    this.root.appendChild(this.shop);
    this.shopList = $('.shop-list', this.shop);
    $('.close-shop', this.shop).addEventListener('click', () => this.toggleShop(false));
    this.toastBox = el('div', 'toasts');
    this.root.appendChild(this.toastBox);
    this.floats = el('div', 'floats');
    this.root.appendChild(this.floats);
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

  objectiveText(o: Objective) {
    const s = t();
    switch (o.kind) {
      case 'broken': return s.obj.broken(fmtInt(o.target));
      case 'deposited': return s.obj.deposited(fmtInt(o.target));
      case 'building': return s.obj.building(s.buildings[o.building!]);
      case 'all': return s.obj.all();
    }
  }
  rewardText(o: Objective) {
    const s = t();
    const p: string[] = [];
    if (o.reward.unlock) p.push(`${UPGRADES.find((u) => u.id === o.reward.unlock)!.icon} ${s.up[o.reward.unlock][0]}`);
    if (o.reward.money) p.push(`$ ${fmt(o.reward.money)}`);
    return p.length ? `${s.reward}: ${p.join(' + ')}` : '';
  }

  update(h: HudState, dt: number) {
    const s = t();
    const d = h.money - this.shownMoney;
    this.shownMoney += Math.abs(d) < 1 ? d : d * Math.min(1, dt * 8);
    this.money.textContent = '$ ' + fmt(Math.floor(this.shownMoney));
    this.standing.textContent = fmtInt(h.standing);
    const pct = (1 - h.standing / TOTAL_BRICKS) * 100;
    this.pct.textContent = `${pct < 10 ? pct.toFixed(2) : pct.toFixed(1)}% ${s.demolished}`;
    this.bar.style.width = `${pct}%`;
    this.ground.textContent = h.ground > 0 ? `🧱 ${fmtInt(h.ground)} ${s.onGround}` : '';

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
      const tg = h.objective.target;
      const showNum = h.objective.kind !== 'all';
      this.objNum.textContent = showNum ? `${fmtInt(Math.min(h.objProgress, tg))}/${fmtInt(tg)}` : '';
      if (h.objective.kind === 'building') this.objNum.textContent = `${Math.round(Math.min(1, h.objProgress) * 100)}%`;
      this.objFill.style.width = `${Math.min(100, (h.objective.kind === 'building' ? h.objProgress : h.objProgress / tg) * 100)}%`;
      this.objBox.classList.remove('hidden');
    } else this.objBox.classList.add('hidden');

    const lf = h.cap ? Math.min(1, h.carried / h.cap) : 0;
    this.loadFill.style.width = `${lf * 100}%`;
    this.loadText.textContent = `${fmtInt(Math.min(h.carried, h.cap))} / ${fmtInt(h.cap)}`;
    this.loadWrap.classList.toggle('full', lf >= 1);

    const tools = TOOL_ORDER.filter((id) => h.unlocked.includes(TOOL_UPGRADE[id]));
    const hk = tools.join() + h.tool;
    if (hk !== this.lastHotKey) {
      this.lastHotKey = hk;
      this.hotbar.innerHTML = '';
      tools.forEach((id, i) => {
        const b = el('button', 'hot' + (id === h.tool ? ' on' : ''), `<span class="hk">${i + 1}</span>${TOOL_ICON[id]}<span class="hn">${s.tools[id]}</span>`);
        b.addEventListener('click', (e) => { e.stopPropagation(); this.hooks.selectTool(id); });
        this.hotbar.appendChild(b);
      });
      const fb = this.root.querySelector('.fire-btn');
      if (fb) fb.textContent = TOOL_ICON[h.tool];
    }
    this.detBtn.classList.toggle('hidden', h.charges <= 0);
    this.detBtn.textContent = `💥 ${s.detonate} (${h.charges})`;
    this.cross.classList.toggle('aim', h.aimHit);
    this.cross.style.setProperty('--cd', String(h.cooldown));

    let afford = 0;
    for (const u of UPGRADES) if (h.unlocked.includes(u.id) && h.levels[u.id] < u.max && u.cost(h.levels[u.id]) <= h.money) afford++;
    this.badge.textContent = String(afford);
    this.badge.classList.toggle('hidden', afford === 0);
    this.shopBtn.classList.toggle('glow', afford > 0);
    if (this.shopOpen) this.renderShop(h);
  }

  private describe(id: UpgradeId, st: Stats): string {
    switch (id) {
      case 'martillo': return `${st.hammerRate.toFixed(1)}/s`;
      case 'maza': return `⌀ ${(st.sledgeRadius * 2).toFixed(2)} m`;
      case 'neumatico': return `${st.jackRate.toFixed(0)}/s`;
      case 'bola': return `⌀ ${(st.ballRadius * 2).toFixed(1)} m`;
      case 'explosivos': return `${st.bombCharges}× ⌀ ${(st.bombRadius * 2).toFixed(1)} m`;
      case 'pala': return `${st.pickRadius.toFixed(1)} m`;
      case 'carretilla': return `${fmtInt(st.capacity)} 🧱`;
      case 'aspiradora': return `${st.vacuumRadius.toFixed(1)} m`;
      case 'precio': return `$ ${st.price.toFixed(2)}`;
      case 'obreros': return `${st.workers} 👷`;
      case 'robots': return `${st.robots} 🤖`;
      case 'botas': return `${st.walk.toFixed(1)} m/s`;
    }
  }

  private renderShop(h: HudState) {
    const key = JSON.stringify(h.levels) + h.unlocked.join() + UPGRADES.map((u) => (u.cost(h.levels[u.id]) <= h.money ? 1 : 0)).join('') + lang;
    if (key === this.lastShopKey) return;
    this.lastShopKey = key;
    const s = t();
    const cur = stats(h.levels);
    this.shopList.innerHTML = '';
    const ordered = [...UPGRADES].sort((a, b) => Number(!h.unlocked.includes(a.id)) - Number(!h.unlocked.includes(b.id)));
    for (const u of ordered) {
      const unlocked = h.unlocked.includes(u.id);
      const lv = h.levels[u.id];
      const [name, desc] = s.up[u.id];
      const card = el('div', 'up-card' + (unlocked ? '' : ' locked') + (lv >= u.max ? ' maxed' : ''));
      if (!unlocked) {
        card.innerHTML = `<div class="up-ico">🔒</div><div class="up-body"><div class="up-name">${name}</div><div class="up-desc">${s.locked}</div></div><div class="buy-ph">${u.icon}</div>`;
        this.shopList.appendChild(card);
        continue;
      }
      const maxed = lv >= u.max;
      const cost = u.cost(lv);
      const next = maxed ? null : stats({ ...h.levels, [u.id]: lv + 1 });
      card.innerHTML = `
        <div class="up-ico">${u.icon}</div>
        <div class="up-body">
          <div class="up-name">${name} <span class="up-lv">${s.level} ${lv}/${u.max}</span></div>
          <div class="up-desc">${desc}</div>
          <div class="up-val">${lv > 0 || u.startUnlocked ? this.describe(u.id, cur) : '—'}${next ? ` <b>→ ${this.describe(u.id, next)}</b>` : ''}</div>
          <div class="lvbar"><i style="width:${(lv / u.max) * 100}%"></i></div>
        </div>
        <button class="buy" ${maxed || cost > h.money ? 'disabled' : ''}>${maxed ? s.max : '$ ' + fmt(cost)}</button>`;
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

  // ---------------------------------------------------------- efectos
  floatText(text: string, cls = '', x = window.innerWidth / 2, y = window.innerHeight / 2 - 40) {
    if (this.floats.childElementCount > 30) return;
    const e = el('div', 'float ' + cls, text);
    e.style.left = `${x + (Math.random() - 0.5) * 40}px`;
    e.style.top = `${y}px`;
    this.floats.appendChild(e);
    setTimeout(() => e.remove(), 1200);
  }

  toast(title: string, sub = '', kind = '') {
    const e = el('div', 'toast ' + kind, `<div class="toast-t">${title}</div>${sub ? `<div class="toast-s">${sub}</div>` : ''}`);
    this.toastBox.appendChild(e);
    setTimeout(() => e.classList.add('out'), 3600);
    setTimeout(() => e.remove(), 4200);
  }

  bannerText(text: string) {
    this.banner.textContent = text;
    this.banner.classList.remove('on');
    void this.banner.offsetWidth;
    this.banner.classList.add('on');
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
    back.appendChild(el('div', 'modal', html));
    back.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.appendChild(back);
    this.modalOpen++;
    requestAnimationFrame(() => back.classList.add('in'));
    return back;
  }
  closeModal(m: HTMLElement) {
    m.classList.remove('in');
    this.modalOpen = Math.max(0, this.modalOpen - 1);
    setTimeout(() => m.remove(), 300);
  }
  ask(text: string, onYes: () => void) {
    const s = t();
    const m = this.modal(`<p class="ask-t">${text}</p><div class="modal-btns"><button class="ghost-btn no">${s.cancel}</button><button class="big-btn danger-btn yes">${s.yes}</button></div>`, 'ask');
    $('.no', m).addEventListener('click', () => this.closeModal(m));
    $('.yes', m).addEventListener('click', () => { this.closeModal(m); onYes(); });
  }
  unlockCard(icon: string, name: string, desc: string, onClose: () => void) {
    const s = t();
    const m = this.modal(`<div class="unlock-rays"></div><div class="unlock-ico">${icon}</div><div class="unlock-kicker">${s.newTool}</div><h2>${name}</h2><p>${desc}</p><div class="modal-btns"><button class="big-btn ok">${s.ok}</button></div>`, 'unlock');
    $('.ok', m).addEventListener('click', () => { this.closeModal(m); onClose(); });
  }

  showTitle(hasSave: boolean, isTouch: boolean, onPlay: () => void, onNew: () => void) {
    const s = t();
    const scr = el('div', 'title-screen');
    scr.innerHTML = `
      <div class="logo"><div class="logo-kicker">🧱</div><h1>${s.title}</h1><p>${s.subtitle}</p></div>
      <div class="title-btns">
        <button class="big-btn play">${hasSave ? s.continue : s.play}</button>
        ${hasSave ? `<button class="ghost-btn new">${s.newGame}</button>` : ''}
      </div>
      <div class="title-foot">🎧 ${isTouch ? s.controlsMobile : s.controlsDesktop}</div>`;
    scr.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.root.appendChild(scr);
    const close = () => { scr.classList.add('out'); setTimeout(() => scr.remove(), 700); };
    (this as any).closeTitle = close;
    $('.play', scr).addEventListener('click', () => { close(); onPlay(); });
    scr.querySelector('.new')?.addEventListener('click', () => this.ask(s.resetConfirm, () => { close(); onNew(); }));
  }

  /** Pantalla "clic para jugar" (necesaria para volver a capturar el mouse). */
  pauseOverlay(show: boolean) {
    let p = this.root.querySelector('.pause') as HTMLElement | null;
    if (show && !p) {
      p = el('div', 'pause', `<div>${t().clickToPlay}</div>`);
      p.addEventListener('click', () => this.hooks.start());
      this.root.appendChild(p);
    } else if (!show && p) p.remove();
  }

  openSettings() {
    const s = t();
    const st = this.settings;
    const q = (v: number | null, l: string) => `<button data-v="${v === null ? 'a' : v}" class="${st.quality === v ? 'on' : ''}">${l}</button>`;
    const m = this.modal(`
      <h2>${s.settings}</h2>
      <label class="row"><span>${s.music}</span><input id="r-music" type="range" min="0" max="1" step="0.05" value="${st.music}"></label>
      <label class="row"><span>${s.sfx}</span><input id="r-sfx" type="range" min="0" max="1" step="0.05" value="${st.sfx}"></label>
      <label class="row"><span>${s.sens}</span><input id="r-sens" type="range" min="0.3" max="2.5" step="0.05" value="${st.sens}"></label>
      <div class="row"><span>${s.quality}</span><div class="seg q">${q(null, s.auto)}${q(0, s.qualities[0])}${q(1, s.qualities[1])}${q(2, s.qualities[2])}</div></div>
      <div class="row"><span>${s.language}</span><div class="seg l"><button data-v="es" class="${lang === 'es' ? 'on' : ''}">Español</button><button data-v="en" class="${lang === 'en' ? 'on' : ''}">English</button></div></div>
      <div class="note">${s.reloadNeeded}: ${s.quality.toLowerCase()} / ${s.language.toLowerCase()}</div>
      <div class="modal-btns"><button class="ghost-btn danger reset">${s.reset}</button><button class="big-btn close">${s.close}</button></div>`);
    const emit = () => this.hooks.settingsChanged(st);
    $('#r-music', m).addEventListener('input', (e) => { st.music = +(e.target as HTMLInputElement).value; emit(); });
    $('#r-sfx', m).addEventListener('input', (e) => { st.sfx = +(e.target as HTMLInputElement).value; emit(); });
    $('#r-sens', m).addEventListener('input', (e) => { st.sens = +(e.target as HTMLInputElement).value; emit(); });
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
    $('.close', m).addEventListener('click', () => this.closeModal(m));
  }

  end(time: number, trips: number) {
    const s = t();
    const m = this.modal(`<div class="modal-ico">🧱🏁</div><h2>${s.endTitle}</h2><p>${s.endText}</p>
      <div class="stats-row"><div><b>${fmtTime(time)}</b><span>${s.time}</span></div><div><b>${fmtInt(trips)}</b><span>${s.trips}</span></div><div><b>1.000.000</b><span>${s.bricks}</span></div></div>
      <div class="modal-btns"><button class="big-btn ok">${s.keepPlaying}</button></div>`, 'end');
    $('.ok', m).addEventListener('click', () => this.closeModal(m));
  }
}
