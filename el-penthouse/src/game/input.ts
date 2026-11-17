// Entrada en primera persona: teclado + mouse (pointer lock o arrastrar) y táctil (joystick + mirar + botones).
export class Input {
  moveX = 0; // -1..1 (derecha +)
  moveY = 0; // -1..1 (adelante +)
  lookDX = 0; // acumulado en píxeles desde el último frame
  lookDY = 0;
  fire = false; // botón de acción mantenido
  firePressed = false; // flanco del frame
  jump = false;
  alt = false; // detonar (clic derecho / botón)
  isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  locked = false;
  enabled = true;
  sensitivity = 1;
  onKey: (k: string) => void = () => {};
  onWheel: (d: number) => void = () => {};
  private keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private joyId: number | null = null;
  private lookId: number | null = null;
  private jx = 0;
  private jy = 0;
  private joyOX = 0;
  private joyOY = 0;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  private wasFire = false;

  constructor(private surface: HTMLElement) {
    this.base = document.createElement('div');
    this.base.className = 'joy-base';
    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';
    this.base.appendChild(this.knob);
    document.body.appendChild(this.base);

    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'tab') e.preventDefault();
      if (e.repeat) return;
      this.keys.add(k);
      this.onKey(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.fire = false; });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === surface;
    });
    surface.addEventListener('contextmenu', (e) => e.preventDefault());
    surface.addEventListener('wheel', (e) => { if (this.enabled) this.onWheel(Math.sign(e.deltaY)); }, { passive: true });

    surface.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.pointerType === 'touch') {
        // mitad izquierda = caminar, derecha = mirar
        if (e.clientX < window.innerWidth * 0.42 && this.joyId === null) {
          this.joyId = e.pointerId;
          this.joyOX = e.clientX;
          this.joyOY = e.clientY;
          this.base.style.left = `${e.clientX}px`;
          this.base.style.top = `${e.clientY}px`;
          this.base.classList.add('on');
        } else if (this.lookId === null) {
          this.lookId = e.pointerId;
          this.lastX = e.clientX;
          this.lastY = e.clientY;
        }
        surface.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button === 2) { this.alt = true; this.onKey('rmb'); return; }
      if (!this.locked) {
        // intentar bloquear el puntero; si el navegador no deja, se mira arrastrando
        try { (surface.requestPointerLock as any)?.call(surface)?.catch?.(() => {}); } catch { /* sin pointer lock */ }
        this.dragging = true;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
      if (e.button === 0) this.fire = true;
    });
    surface.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') {
        if (e.pointerId === this.joyId) {
          const R = 55;
          let dx = e.clientX - this.joyOX, dy = e.clientY - this.joyOY;
          const len = Math.hypot(dx, dy);
          if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
          this.jx = dx / R;
          this.jy = -dy / R;
          this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        } else if (e.pointerId === this.lookId) {
          this.lookDX += (e.clientX - this.lastX) * 1.6;
          this.lookDY += (e.clientY - this.lastY) * 1.6;
          this.lastX = e.clientX;
          this.lastY = e.clientY;
        }
        return;
      }
      if (this.locked) {
        this.lookDX += e.movementX;
        this.lookDY += e.movementY;
      } else if (this.dragging) {
        this.lookDX += (e.clientX - this.lastX) * 1.5;
        this.lookDY += (e.clientY - this.lastY) * 1.5;
        this.lastX = e.clientX;
        this.lastY = e.clientY;
      }
    });
    const end = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        if (e.pointerId === this.joyId) {
          this.joyId = null;
          this.jx = this.jy = 0;
          this.base.classList.remove('on');
          this.knob.style.transform = 'translate(-50%,-50%)';
        }
        if (e.pointerId === this.lookId) this.lookId = null;
        return;
      }
      if (e.button === 0) this.fire = false;
      if (e.button === 2) this.alt = false;
      this.dragging = false;
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
  }

  /** Botones táctiles de la UI. */
  setFire(v: boolean) { this.fire = v; }
  setJump(v: boolean) { this.jump = v; }

  update() {
    let x = 0, y = 0;
    const k = this.keys;
    if (k.has('a') || k.has('arrowleft')) x -= 1;
    if (k.has('d') || k.has('arrowright')) x += 1;
    if (k.has('w') || k.has('arrowup')) y += 1;
    if (k.has('s') || k.has('arrowdown')) y -= 1;
    x += this.jx;
    y += this.jy;
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.moveX = this.enabled ? x : 0;
    this.moveY = this.enabled ? y : 0;
    if (k.has(' ')) this.jump = true;
    this.firePressed = this.fire && !this.wasFire;
    this.wasFire = this.fire;
    if (!this.enabled) this.fire = false;
  }

  consumeLook() {
    const d = [this.lookDX * this.sensitivity, this.lookDY * this.sensitivity];
    this.lookDX = this.lookDY = 0;
    return d;
  }

  get sprint() {
    return this.keys.has('shift');
  }
}
