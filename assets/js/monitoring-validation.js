import { isBackendDateTime, timestampOrderKey } from './date-time.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const positiveId = value => Number.isSafeInteger(value) && value > 0;
const boundedText = (value, limit = 240) => typeof value === 'string' && value.length <= limit && value.trim().length > 0;
const nullableText = value => value === null || boundedText(value);
const nullableCode = value => value === null || Number.isSafeInteger(value);

/** REST EstadoOut requires all seven fields, including nullable command fields. */
export function isStateResponse(value) {
  return object(value) && positiveId(value.id_vehiculo) && boundedText(value.vehiculo)
    && (value.id_comando === null || positiveId(value.id_comando))
    && nullableText(value.comando) && nullableCode(value.codigo)
    && typeof value.conectado === 'boolean' && isBackendDateTime(value.fecha_actualizacion);
}

function isHistoryRow(value) {
  return object(value) && positiveId(value.id_historial) && positiveId(value.id_vehiculo)
    && nullableText(value.comando) && nullableCode(value.codigo)
    && isBackendDateTime(value.fecha_hora) && boundedText(value.origen, 30);
}

/** Foreign vehicle rows remain structurally valid and are filtered by normalization. */
export function isHistoryResponse(value) {
  return Array.isArray(value) && value.every(isHistoryRow);
}

/** Copy actual persisted rows; never merge repeated movements by command/time. */
export function normalizeHistory(value, vehicleId, limit = 10) {
  if (!isHistoryResponse(value)) throw new TypeError('El historial no coincide con el contrato esperado.');
  if (!positiveId(vehicleId)) throw new TypeError('El vehículo debe ser un entero positivo.');
  if (!positiveId(limit)) throw new TypeError('El límite debe ser un entero positivo.');
  const rows = value.filter(row => row.id_vehiculo === vehicleId).map(row => ({
    id_historial: row.id_historial,
    id_vehiculo: row.id_vehiculo,
    comando: row.comando,
    codigo: row.codigo,
    fecha_hora: row.fecha_hora,
    origen: row.origen,
  }));
  rows.sort((a, b) => {
    const first = timestampOrderKey(a.fecha_hora);
    const second = timestampOrderKey(b.fecha_hora);
    return first === second ? b.id_historial - a.id_historial : first > second ? -1 : 1;
  });
  const seen = new Set();
  return rows.filter(row => {
    if (seen.has(row.id_historial)) return false;
    seen.add(row.id_historial);
    return true;
  }).slice(0, Math.min(limit, 10));
}
