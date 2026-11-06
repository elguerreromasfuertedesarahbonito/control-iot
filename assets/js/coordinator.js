/** Una sola entrada para joystick, botones, DEMO y parada prioritaria. */
export class ControlCoordinator {
  constructor(api, { onChange = () => {} } = {}) {
    this.api = api;
    this.onChange = onChange;
    this.catalog = null;
    this.ready = false;
    this.mode = 'idle';
    this.epoch = 0;
    this.pending = null;
    this.running = false;
    this.inflight = new Set();
    this.stopTask = null;
    this.demoId = null;
    this.executionId = null;
    this.events = new Map();
    this.demoEvents = new Map();
    this.action = { name: 'En espera', requested: false, accepted: false, received: false };
    this.message = 'Selecciona un control para comenzar.';
  }

  snapshot() {
    return { mode: this.mode, ready: this.ready, action: { ...this.action },
      message: this.message, demoId: this.demoId };
  }
  emit() { this.onChange(this.snapshot()); }
  configure(catalog) { this.catalog = catalog; this.emit(); }
  setReady(value) { this.ready = Boolean(value); this.emit(); }
  begin(name) {
    this.action = { name, requested: true, accepted: false, received: false, eventId: null };
  }
  accept(response, epoch) {
    if (epoch !== this.epoch) return;
    this.action.accepted = true;
    this.action.eventId = response.id_evento ?? null;
    this.action.received = Boolean(this.action.eventId && this.events.has(this.action.eventId));
    this.emit();
  }
  track(promise) {
    this.inflight.add(promise);
    promise.then(() => this.inflight.delete(promise), () => this.inflight.delete(promise));
    return promise;
  }

  move(command) {
    if (!this.ready || !command || !this.catalog?.byId.has(command.id_comando)
      || ['stopping', 'uncertain', 'demo-starting', 'demo'].includes(this.mode)) return false;
    const epoch = ++this.epoch;
    this.pending = { command, epoch };
    this.mode = 'manual';
    this.begin(command.nombre);
    this.message = 'Movimiento solicitado. Esperando respuesta de la API.';
    this.emit();
    void this.drain();
    return true;
  }

  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending && this.mode === 'manual') {
        const { command, epoch } = this.pending;
        this.pending = null;
        try {
          const response = await this.track(this.api.manual(command.id_comando));
          this.accept(response, epoch);
          if (epoch === this.epoch) {
            this.message = 'Aceptado por la API. Esto no confirma movimiento fisico.';
            this.emit();
          }
        } catch (error) {
          if (epoch === this.epoch) {
            this.mode = 'uncertain';
            this.message = `${error.message} Usa DETENER para solicitar una parada.`;
            this.emit();
          }
        }
      }
    } finally { this.running = false; }
  }

  async startDemo(id) {
    if (!this.ready || this.mode !== 'idle' || !Number.isInteger(id) || id < 1) return false;
    const epoch = ++this.epoch;
    this.mode = 'demo-starting';
    this.demoId = id;
    this.executionId = null;
    this.begin('DEMO');
    this.message = 'Inicio de DEMO solicitado.';
    this.emit();
    try {
      const response = await this.track(this.api.startDemo(id));
      if (epoch !== this.epoch) return false;
      this.executionId = response.id_ejecucion ?? this.executionId;
      this.action.accepted = true;
      const early = this.demoEvents.get(this.executionId);
      this.action.received = Boolean(early);
      // Correlacionar con la ejecucion real: el evento puede preceder al 202.
      if (early && ['fin', 'cancelado'].includes(early.tipo)) {
        this.mode = 'idle'; this.demoId = null; this.executionId = null;
      } else this.mode = 'demo';
      this.message = this.mode === 'idle' ? 'DEMO finalizada por el servidor.' : 'DEMO aceptada por la API.';
      this.emit();
      return true;
    } catch (error) {
      if (epoch !== this.epoch) return false;
      if (error.status === 409) {
        try {
          const status = await this.api.demoStatus(id);
          if (epoch !== this.epoch) return false;
          this.mode = status.corriendo ? 'demo' : 'idle';
          this.message = status.corriendo ? 'Esta DEMO ya esta ejecutandose. Puedes cancelarla.' : error.message;
        } catch {
          if (epoch !== this.epoch) return false;
          this.mode = 'uncertain'; this.message = 'No se pudo comprobar la DEMO. Solicita DETENER.';
        }
      } else { this.mode = 'uncertain'; this.message = `${error.message} Solicita DETENER.`; }
      this.emit();
      return false;
    }
  }

  stop() {
    if (this.stopTask) return this.stopTask;
    const epoch = ++this.epoch;
    const older = [...this.inflight];
    const demoId = this.demoId;
    this.pending = null;
    this.mode = 'stopping';
    this.begin('DETENER');
    this.message = 'Detencion solicitada. Esperando confirmacion de la API.';
    this.emit();
    this.stopTask = (async () => {
      const perform = async () => {
        // Ambos intentos son independientes: un fallo al cancelar no impide STOP.
        const cancellation = demoId ? this.api.stopDemo(demoId) : Promise.resolve();
        const stopCommand = this.catalog?.directions.stop;
        const stop = stopCommand ? this.api.manual(stopCommand.id_comando)
          : Promise.reject(new Error('No se ha verificado DETENER en el catalogo.'));
        const [cancelled, stopped] = await Promise.allSettled([cancellation, stop]);
        if (stopped.status === 'fulfilled') this.accept(stopped.value, epoch);
        if (cancelled.status === 'rejected') throw cancelled.reason;
        if (stopped.status === 'rejected') throw stopped.reason;
      };
      let initialFailure = null;
      try { await perform(); } catch (error) { initialFailure = error; }
      const settled = await Promise.allSettled(older);
      // Abortar Fetch no cancela el servidor. Una orden que estaba en vuelo
      // puede terminar despues del primer STOP: se envia entonces uno final.
      if (older.length) {
        try { await perform(); initialFailure = null; } catch (error) { initialFailure = error; }
      }
      if (epoch !== this.epoch) return;
      const unknown = settled.some(result => result.status === 'rejected');
      if (initialFailure || unknown) {
        this.mode = 'uncertain';
        this.message = 'No se pudo confirmar toda la detencion. Reintenta DETENER y verifica la API.';
      } else {
        this.mode = 'idle';
        this.demoId = null;
        this.executionId = null;
        this.message = 'Detencion aceptada por la API. El evento WS se confirma por separado.';
      }
      this.emit();
    })().finally(() => { this.stopTask = null; });
    return this.stopTask;
  }

  observe(event) {
    if (event.tipo === 'estado' && event.origen === 'MANUAL' && typeof event.id_evento === 'string') {
      this.events.set(event.id_evento, event);
      if (this.events.size > 64) this.events.delete(this.events.keys().next().value);
      if (event.id_evento === this.action.eventId) { this.action.received = true; this.emit(); }
    }
    if (event.tipo === 'bienvenida' && event.corriendo && !['stopping', 'uncertain'].includes(this.mode)) {
      this.mode = 'demo'; this.demoId = event.id_demo;
      this.message = 'El servidor informa una DEMO en ejecucion.'; this.emit();
    }
    if (!this.demoId || event.id_demo !== this.demoId || ['stopping', 'uncertain'].includes(this.mode)) return;
    if (typeof event.id_ejecucion === 'string') {
      this.demoEvents.set(event.id_ejecucion, event);
      if (this.demoEvents.size > 64) this.demoEvents.delete(this.demoEvents.keys().next().value);
    }
    if (this.mode === 'demo-starting' && !this.action.accepted) return;
    if (this.executionId && event.id_ejecucion && this.executionId !== event.id_ejecucion) return;
    if (event.tipo === 'inicio') {
      this.executionId = event.id_ejecucion ?? this.executionId;
      this.mode = 'demo'; this.action.received = true;
    } else if (event.tipo === 'comando') {
      this.mode = 'demo'; this.action.received = true;
      this.message = `DEMO: evento ${event.orden} recibido · ${event.nombre ?? 'Movimiento'}.`;
    } else if (event.tipo === 'fin' || event.tipo === 'cancelado') {
      this.mode = 'idle'; this.action.received = true;
      this.demoId = null;
      this.executionId = null;
      this.message = event.tipo === 'fin' ? 'DEMO finalizada por el servidor.' : 'Cancelacion recibida por WebSocket.';
    }
    this.emit();
  }
}
