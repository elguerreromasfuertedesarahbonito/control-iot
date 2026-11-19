/** Pulsación con propiedad compartida: un temporizador viejo no detiene otro mando. */
export class AssistantPulse {
  constructor(input, coordinator, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
    this.input = input;
    this.coordinator = coordinator;
    this.setTimer = (callback, delay) => setTimer.call(globalThis, callback, delay);
    this.clearTimer = timer => clearTimer.call(globalThis, timer);
    this.timer = null;
    this.pending = null;
    this.source = Symbol('asistente');
    input.register(this.source, () => this.reset());
  }

  reset() {
    this.clearTimer(this.timer);
    this.timer = null;
    this.pending?.resolve({ interrupted: true });
    this.pending = null;
  }

  start(command, duration = 1000) {
    if (!Number.isInteger(duration) || duration < 1 || duration > 1000) throw new Error('La pulsación manual debe durar como máximo un segundo.');
    if (!this.input.request(this.source, command)) throw new Error('El control no está disponible. Comprueba API/WSS y DETENER.');
    this.reset();
    return new Promise(resolve => {
      const current = { resolve };
      this.pending = current;
      this.timer = this.setTimer(async () => {
        if (this.pending !== current) return;
        this.pending = null;
        this.timer = null;
        if (this.input.release(this.source)) {
          await this.coordinator.stop();
          resolve({ interrupted: false, stopped: this.coordinator.mode === 'idle' });
        } else resolve({ interrupted: true });
      }, duration);
    });
  }

  async stop() {
    if (this.input.owner !== this.source) return;
    this.input.clear();
    await this.coordinator.stop();
  }

  destroy() { this.reset(); this.input.unregister(this.source); }
}
