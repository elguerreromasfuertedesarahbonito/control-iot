import { isStateResponse } from '../monitoring-validation.js';
import { timestampOrderKey } from '../date-time.js';

const positiveId = value => Number.isSafeInteger(value) && value > 0;

/** El contador protege el estado vivo frente a lecturas REST anteriores. */
export class LatestState {
  constructor(vehicleId) { this.reset(vehicleId); }

  reset(vehicleId) {
    this.vehicleId = vehicleId;
    this.value = null;
    this.source = null;
    this.error = '';
    this.loading = false;
    this.revision = 0;
  }

  _isOlder(value) {
    const incoming = timestampOrderKey(value?.fecha_actualizacion);
    const current = timestampOrderKey(this.value?.fecha_actualizacion);
    return incoming !== null && current !== null && incoming < current;
  }

  acceptRest(value, revision) {
    if (!isStateResponse(value) || value.id_vehiculo !== this.vehicleId) {
      throw new TypeError('La respuesta de estado no corresponde al vehículo seleccionado.');
    }
    if (revision !== this.revision || this._isOlder(value)) return false;
    this.value = { ...value };
    this.source = 'REST';
    this.error = '';
    return true;
  }

  acceptSocket(value) {
    if (value !== null && (!isStateResponse(value) || value.id_vehiculo !== this.vehicleId)) return false;
    if (this._isOlder(value)) return false;
    ++this.revision;
    this.value = value === null ? null : { ...value };
    this.source = 'WSS';
    this.error = '';
    return true;
  }

  acceptDemo(event) {
    if (event.id_vehiculo !== this.vehicleId || !positiveId(event.id_comando) ||
        !Number.isSafeInteger(event.codigo) || typeof event.nombre !== 'string') return false;
    ++this.revision;
    // Un paso no trae una fecha de BD ni confirma el campo conectado.
    this.value = { id_vehiculo: this.vehicleId, id_comando: event.id_comando,
      codigo: event.codigo, comando: event.nombre, fecha_actualizacion: null };
    this.source = 'DEMO';
    this.error = '';
    return true;
  }

  fail(error, revision) {
    if (revision !== this.revision) return;
    if (error?.status === 404) {
      this.value = null;
      this.source = 'REST';
      this.error = '';
      return;
    }
    this.error = error instanceof TypeError ? error.message : 'No se pudo consultar el último estado registrado.';
  }
}
