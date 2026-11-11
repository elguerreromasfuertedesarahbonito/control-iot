import { LatestState } from './latest-state.js';
import { PersistedHistory } from './history.js';
import { isStateResponse } from '../monitoring-validation.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const uuid = value => typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
const MAX_MANUAL_EVENTS = 256;
const DISABLED_MESSAGE = 'Monitoreo requiere servicios reales.';

/** Observación REST/WS. No controla el vehículo ni crea historial desde eventos. */
export class MonitorModel {
  constructor(api, { vehicleId, onChange = () => {}, enabled = true, historyDebounceMs = 80 } = {}) {
    this.api = api;
    this.vehicleId = vehicleId;
    this.onChange = onChange;
    this.enabled = Boolean(enabled);
    this.active = false;
    this.connection = 'offline';
    this.activity = this.enabled ? 'Sin movimientos registrados.' : DISABLED_MESSAGE;
    this.latest = new LatestState(vehicleId);
    this.history = new PersistedHistory(api, { vehicleId, debounceMs: historyDebounceMs,
      onChange: () => this._emit() });
    this._generation = 0;
    this._latestFlight = null;
    this._latestDirty = false;
    this._manualEvents = new Set();
    this._syncQueued = false;
    this._destroyed = false;
  }

  snapshot() {
    return { vehicleId: this.vehicleId, connection: this.connection,
      latest: this.latest.value === null ? null : { ...this.latest.value }, latestSource: this.latest.source,
      activity: this.enabled ? this.activity : DISABLED_MESSAGE,
      latestLoading: this.latest.loading, latestError: this.latest.error,
      history: this.history.items.map(row => ({ ...row })), historyLoading: this.history.loading,
      historyError: this.history.error, disabled: !this.enabled,
      stale: this.enabled && (this.connection !== 'online' || Boolean(this.latest.error || this.history.error)) };
  }

  _emit() {
    if (this._destroyed) return;
    try { this.onChange(this.snapshot()); } catch { /* La vista no altera las lecturas. */ }
  }

  _canRead() { return !this._destroyed && this.enabled && this.active && positiveId(this.vehicleId); }

  _cancel() {
    ++this._generation;
    this._syncQueued = false;
    this._latestFlight?.controller.abort();
    this._latestFlight = null;
    this._latestDirty = false;
    this.latest.loading = false;
    this.history.cancel();
  }

  setActive(value) {
    if (this._destroyed) return Promise.resolve();
    const active = Boolean(value);
    if (active === this.active) return Promise.resolve();
    this.active = active;
    if (!active) {
      this._cancel();
      this._emit();
      return Promise.resolve();
    }
    return this.refresh();
  }

  setContext(api, vehicleId) {
    if (this._destroyed || (api === this.api && vehicleId === this.vehicleId)) return Promise.resolve();
    this._cancel();
    this.api = api;
    this.vehicleId = vehicleId;
    this.connection = 'offline';
    this.latest.reset(vehicleId);
    this.history.setContext(api, vehicleId);
    this._manualEvents.clear();
    this.activity = this.enabled ? 'Sin movimientos registrados.' : DISABLED_MESSAGE;
    this._emit();
    return this.active ? this.refresh() : Promise.resolve();
  }

  setSocketStatus(status) {
    if (this._destroyed || !this.enabled || !['online', 'offline', 'connecting', 'reconnecting'].includes(status)) return;
    const becameOnline = status === 'online' && this.connection !== 'online';
    this.connection = status;
    this._emit();
    if (becameOnline) this._queueSync();
  }

  _queueSync() {
    if (!this._canRead() || this._syncQueued) return;
    this._syncQueued = true;
    const generation = this._generation;
    queueMicrotask(() => {
      if (generation !== this._generation || this._destroyed) return;
      this._syncQueued = false;
      if (this._canRead()) void this.refresh({ catchUp: true });
    });
  }

  _readLatest({ catchUp = false } = {}) {
    if (this._latestFlight) {
      if (catchUp) this._latestDirty = true;
      return this._latestFlight.promise;
    }
    this._latestDirty = false;
    const generation = this._generation;
    const revision = this.latest.revision;
    const flight = { controller: new AbortController(), promise: null };
    this._latestFlight = flight;
    this.latest.loading = true;
    this.latest.error = '';
    this._emit();
    const current = () => generation === this._generation && this._latestFlight === flight;
    flight.promise = (async () => {
      try {
        const value = await this.api.state({ signal: flight.controller.signal });
        if (current()) this.latest.acceptRest(value, revision);
      } catch (error) {
        if (current() && !flight.controller.signal.aborted) this.latest.fail(error, revision);
      } finally {
        if (current()) {
          this._latestFlight = null;
          this.latest.loading = false;
          this._emit();
          if (this._latestDirty && this._canRead()) void this._readLatest();
        }
      }
    })();
    return flight.promise;
  }

  refresh({ catchUp = false } = {}) {
    if (!this._canRead()) { this._emit(); return Promise.resolve(); }
    return Promise.all([this._readLatest({ catchUp }), this.history.refresh({ catchUp })]);
  }

  observe(event) {
    if (this._destroyed || !this.enabled || !object(event) || event.id_vehiculo !== this.vehicleId ||
        !['MANUAL', 'DEMO', 'TELEMETRIA'].includes(event.origen)) return;
    if (event.tipo === 'estado') {
      if (event.origen === 'MANUAL') {
        if (!uuid(event.id_evento) || this._manualEvents.has(event.id_evento) ||
            !isStateResponse(event.estado) || event.estado.id_vehiculo !== this.vehicleId) return;
      }
      const changed = this.latest.acceptSocket(event.estado);
      if (event.origen === 'MANUAL') {
        this._manualEvents.add(event.id_evento);
        if (this._manualEvents.size > MAX_MANUAL_EVENTS) this._manualEvents.delete(this._manualEvents.values().next().value);
        this.activity = 'Comando individual publicado por WSS.';
        if (this._canRead()) this.history.schedule();
      } else if (!changed) return;
      this._emit();
      return;
    }
    if (event.tipo === 'bienvenida' && event.origen === 'TELEMETRIA') {
      if (typeof event.corriendo !== 'boolean' || (event.estado !== null &&
          (!isStateResponse(event.estado) || event.estado.id_vehiculo !== this.vehicleId))) return;
      this.latest.acceptSocket(event.estado);
      this.activity = event.corriendo ? 'DEMO en ejecución.' :
        (this.latest.value ? 'Estado registrado del vehículo.' : 'Sin movimientos registrados.');
      this._emit();
      this._queueSync();
      return;
    }
    if (event.origen !== 'DEMO') return;
    const messages = { inicio: 'DEMO en ejecución.', pausa: 'DEMO en pausa.',
      fin: 'DEMO finalizada.', cancelado: 'DEMO cancelada.' };
    if (event.tipo === 'comando') {
      if (!this.latest.acceptDemo(event)) return;
      this.activity = positiveId(event.orden) ? `DEMO: paso ${event.orden}.` : 'DEMO en ejecución.';
    } else if (messages[event.tipo]) {
      this.activity = messages[event.tipo];
    } else return;
    this._emit();
  }

  destroy() {
    this._destroyed = true;
    this._cancel();
    this.onChange = () => {};
  }
}
