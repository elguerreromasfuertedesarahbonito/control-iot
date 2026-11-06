export function directionFromVector(x, y, radius, previous = null) {
  const distance = Math.hypot(x, y);
  // Histeresis: salir del centro requiere 25%; regresar requiere 17%.
  if (distance < radius * (previous ? 0.17 : 0.25)) return null;
  return Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'backward' : 'forward');
}

export class VirtualJoystick {
  constructor(element, stick, { onDirection, onRelease, enabled = () => true }) {
    this.element = element; this.stick = stick;
    this.onDirection = onDirection; this.onRelease = onRelease; this.enabled = enabled;
    this.pointer = null; this.direction = null; this.key = null;
    this.stopSent = false;
    element.addEventListener('pointerdown', event => this.down(event));
    element.addEventListener('pointermove', event => this.drag(event));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      element.addEventListener(type, event => { if (event.pointerId === this.pointer) this.release(); });
    }
    element.addEventListener('keydown', event => this.keydown(event));
    element.addEventListener('keyup', event => {
      if (event.key === this.key) { event.preventDefault(); this.release(); }
    });
    element.addEventListener('blur', () => this.release());
  }
  down(event) {
    if (!this.enabled() || this.pointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault(); this.pointer = event.pointerId; this.stopSent = false;
    this.element.setPointerCapture(event.pointerId);
    this.element.focus({ preventScroll: true });
    this.drag(event);
  }
  drag(event) {
    if (event.pointerId !== this.pointer) return;
    const rect = this.element.getBoundingClientRect();
    const radius = Math.min(rect.width, rect.height) * 0.32;
    let x = event.clientX - rect.left - rect.width / 2;
    let y = event.clientY - rect.top - rect.height / 2;
    const distance = Math.hypot(x, y);
    if (distance > radius) { x *= radius / distance; y *= radius / distance; }
    this.stick.style.transform = `translate(${x}px, ${y}px)`;
    this.setDirection(directionFromVector(x, y, radius, this.direction));
  }
  setDirection(next) {
    if (next === this.direction) return;
    this.direction = next;
    this.element.dataset.direction = next ?? 'neutral';
    if (next) { this.stopSent = false; this.onDirection(next); }
    else { this.stopSent = true; this.onRelease(); }
  }
  keydown(event) {
    const map = { ArrowUp: 'forward', ArrowDown: 'backward', ArrowLeft: 'left', ArrowRight: 'right' };
    if (!map[event.key] || !this.enabled()) return;
    event.preventDefault();
    if (event.repeat || this.key === event.key) return;
    this.key = event.key;
    this.setDirection(map[event.key]);
  }
  release(notify = true) {
    const active = this.pointer !== null || this.key !== null || this.direction !== null;
    const pointer = this.pointer;
    this.pointer = null; this.key = null; this.direction = null;
    this.element.dataset.direction = 'neutral';
    this.stick.style.transform = 'translate(0px, 0px)';
    if (pointer !== null && this.element.hasPointerCapture(pointer)) this.element.releasePointerCapture(pointer);
    if (active && notify && !this.stopSent) this.onRelease();
    this.stopSent = true;
  }
}
