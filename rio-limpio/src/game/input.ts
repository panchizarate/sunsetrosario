// Entrada unificada: teclado (desktop) + joystick flotante (táctil) + mouse arrastrando.
export class Input {
  x = 0; // -1..1 (derecha +)
  y = 0; // -1..1 (arriba de la pantalla +)
  active = false;
  isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  private keys = new Set<string>();
  private pointerId: number | null = null;
  private ox = 0;
  private oy = 0;
  private stickX = 0;
  private stickY = 0;
  private base: HTMLDivElement;
  private knob: HTMLDivElement;
  onKey: (k: string) => void = () => {};
  enabled = true;

  constructor(private surface: HTMLElement) {
    this.base = document.createElement('div');
    this.base.className = 'joy-base';
    this.knob = document.createElement('div');
    this.knob.className = 'joy-knob';
    this.base.appendChild(this.knob);
    document.body.appendChild(this.base);

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.key.toLowerCase());
      this.onKey(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    surface.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      this.ox = e.clientX;
      this.oy = e.clientY;
      this.stickX = this.stickY = 0;
      surface.setPointerCapture(e.pointerId);
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.base.classList.add('on');
      this.knob.style.transform = 'translate(-50%,-50%)';
    });
    surface.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      const R = 60;
      let dx = e.clientX - this.ox, dy = e.clientY - this.oy;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        // el joystick "sigue" al dedo para no perder control
        this.ox += (dx / len) * (len - R);
        this.oy += (dy / len) * (len - R);
        dx = (dx / len) * R;
        dy = (dy / len) * R;
        this.base.style.left = `${this.ox}px`;
        this.base.style.top = `${this.oy}px`;
      }
      this.stickX = dx / R;
      this.stickY = -dy / R;
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.stickX = this.stickY = 0;
      this.base.classList.remove('on');
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
  }

  update() {
    let kx = 0, ky = 0;
    const k = this.keys;
    if (k.has('a') || k.has('arrowleft')) kx -= 1;
    if (k.has('d') || k.has('arrowright')) kx += 1;
    if (k.has('w') || k.has('arrowup')) ky += 1;
    if (k.has('s') || k.has('arrowdown')) ky -= 1;
    if (!this.enabled) kx = ky = 0;
    let x = kx + (this.enabled ? this.stickX : 0);
    let y = ky + (this.enabled ? this.stickY : 0);
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    // zona muerta
    if (len < 0.12) { x = 0; y = 0; }
    this.x = x;
    this.y = y;
    this.active = x !== 0 || y !== 0;
  }
}
