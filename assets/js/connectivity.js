/** Una medición de salud y una sesión WSS alimentan ambas vistas. */
export class Connectivity {
  constructor(api, config, { simulation = false, onApiStatus = () => {} } = {}) {
    this.api = api;
    this.config = config;
    this.simulation = simulation;
    this.onApiStatus = onApiStatus;
    this.timer = null;
    this.flight = null;
    this.stopped = false;
    this.paint('rds', 'unverified', 'Sin verificar');
  }

  paint(service, state, label) {
    for (const id of [`${service}-status`, `monitor-${service}-status`]) {
      const element = document.getElementById(id);
      if (!element) continue;
      element.dataset.state = state;
      element.textContent = this.simulation && service !== 'rds' ? `Simulado · ${label}` : label;
    }
  }

  setSocketStatus(state) {
    const labels = { connecting: 'Conectando', online: 'En línea', reconnecting: 'Reconectando', offline: 'Desconectado' };
    this.paint('ws', state, labels[state] ?? 'Desconectado');
  }

  refresh() {
    if (this.stopped) return Promise.resolve();
    if (this.flight) return this.flight.promise;
    clearTimeout(this.timer);
    this.paint('api', 'checking', 'Comprobando');
    const flight = { controller: new AbortController(), promise: null };
    this.flight = flight;
    flight.promise = (async () => {
      try {
        await this.api.health({ signal: flight.controller.signal });
        if (this.stopped) return;
        this.paint('api', 'online', 'Disponible');
        this.onApiStatus(true);
      } catch (error) {
        if (this.stopped) return;
        this.paint('api', error.kind === 'config' ? 'unverified' : 'offline', error.kind === 'config' ? 'Sin configurar' : 'No disponible');
        this.onApiStatus(false, error.message);
      } finally {
        if (this.flight === flight) this.flight = null;
        if (!this.stopped) this.timer = setTimeout(() => { void this.refresh(); }, this.config.healthIntervalMs);
      }
    })();
    return flight.promise;
  }

  destroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.flight?.controller.abort();
  }
}
