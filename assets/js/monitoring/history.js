import { isHistoryResponse, normalizeHistory } from '../monitoring-validation.js';

/** Lista persistida: una sola lectura en curso y una lectura posterior si hubo cambios. */
export class PersistedHistory {
  constructor(api, { vehicleId, onChange = () => {}, debounceMs = 80 } = {}) {
    this.api = api;
    this.vehicleId = vehicleId;
    this.onChange = onChange;
    this.debounceMs = debounceMs;
    this.items = [];
    this.loading = false;
    this.error = '';
    this._generation = 0;
    this._flight = null;
    this._timer = null;
    this._dirty = false;
  }

  cancel() {
    ++this._generation;
    clearTimeout(this._timer);
    this._timer = null;
    this._dirty = false;
    this._flight?.controller.abort();
    this._flight = null;
    this.loading = false;
  }

  setContext(api, vehicleId) {
    this.cancel();
    this.api = api;
    this.vehicleId = vehicleId;
    this.items = [];
    this.error = '';
  }

  schedule() {
    if (this._flight) {
      this._dirty = true;
      return;
    }
    if (this._timer !== null) return;
    this._timer = setTimeout(() => {
      this._timer = null;
      void this.refresh();
    }, this.debounceMs);
  }

  refresh({ catchUp = false } = {}) {
    if (this._flight) {
      if (catchUp) this._dirty = true;
      return this._flight.promise;
    }
    clearTimeout(this._timer);
    this._timer = null;
    this._dirty = false;
    const generation = this._generation;
    const flight = { controller: new AbortController(), promise: null };
    this._flight = flight;
    this.loading = true;
    this.error = '';
    this.onChange();
    const current = () => generation === this._generation && this._flight === flight;
    flight.promise = (async () => {
      try {
        const value = await this.api.history({ signal: flight.controller.signal });
        if (!current()) return;
        if (!isHistoryResponse(value)) throw new TypeError('El historial recibido no coincide con el contrato esperado.');
        this.items = normalizeHistory(value, this.vehicleId, 10);
        this.error = '';
      } catch (error) {
        if (current() && !flight.controller.signal.aborted) {
          this.error = error instanceof TypeError ? error.message : 'No se pudo consultar el historial persistido.';
        }
      } finally {
        if (current()) {
          this._flight = null;
          this.loading = false;
          this.onChange();
          if (this._dirty) {
            this._dirty = false;
            this.schedule();
          }
        }
      }
    })();
    return flight.promise;
  }
}
