import { ASSISTANT_PULSE_MS, MAX_VOICE_DURATION_MS } from './contracts.js';

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

  start(command, duration = ASSISTANT_PULSE_MS) {
    if (!Number.isInteger(duration) || duration < 1 || duration > MAX_VOICE_DURATION_MS) {
      throw new Error('La pulsación debe durar como máximo diez segundos.');
    }
    const current = {};
    const result = new Promise(resolve => { current.resolve = resolve; });
    const timed = duration > ASSISTANT_PULSE_MS;
    const options = timed ? {
      durationMs: duration,
      onResult: (epoch, error) => queueMicrotask(() => this.observeTimedResult(current, duration, epoch, error)),
    } : undefined;
    if (!this.input.request(this.source, command, options)) throw new Error('El control no está disponible. Comprueba API/WSS y DETENER.');
    this.reset();
    this.pending = current;
    if (!timed) {
      this.timer = this.setTimer(async () => {
        if (this.pending !== current) return;
        this.pending = null;
        this.timer = null;
        if (this.input.release(this.source)) {
          await this.coordinator.stop();
          current.resolve({ interrupted: false, stopped: this.coordinator.mode === 'idle' });
        } else current.resolve({ interrupted: true });
      }, duration);
    }
    return result;
  }

  observeTimedResult(current, duration, epoch, error) {
    if (this.pending !== current) return;
    if (error) {
      this.pending = null;
      this.input.release(this.source, { stop: false });
      current.resolve({ error: this.coordinator.message });
      return;
    }
    this.timer = this.setTimer(() => {
      if (this.pending !== current) return;
      this.pending = null;
      this.timer = null;
      // El dispositivo aplica el tiempo. Un STOP global podría cortar otra orden.
      const released = this.input.release(this.source, { stop: false });
      const completed = released && this.coordinator.finishTimedMove(epoch);
      current.resolve(completed ? { interrupted: false, timed: true } : { interrupted: true });
    }, duration);
  }

  async stop() {
    if (this.input.owner !== this.source) return;
    this.input.clear();
    await this.coordinator.stop();
  }

  destroy() { this.reset(); this.input.unregister(this.source); }
}
