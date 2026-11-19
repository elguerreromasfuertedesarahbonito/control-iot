const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => Number.isSafeInteger(value) && value > 0;
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const uuid = value => typeof value === 'string' && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
const TYPES = new Set(['comando', 'detener', 'demo', 'estado', 'historial', 'catalogo', 'crear_comando', 'eliminar_comando', 'respuesta']);
export const ASSISTANT_PULSE_MS = 1000;
export const MAX_VOICE_DURATION_MS = 10000;

/** El navegador nunca interpreta código, URLs ni herramientas arbitrarias del modelo. */
export function isAssistantResponse(value, { entrada } = {}) {
  if (!object(value) || !uuid(value.request_id) || !text(value.mensaje, 8000) || !object(value.accion)) return false;
  const action = value.accion;
  if (!TYPES.has(action.tipo)) return false;
  if (['comando', 'detener', 'eliminar_comando'].includes(action.tipo) && !id(action.id_comando)) return false;
  const maxDuration = entrada === 'voz' ? MAX_VOICE_DURATION_MS : ASSISTANT_PULSE_MS;
  if (action.tipo === 'comando' && (!Number.isInteger(action.duracion_ms) || action.duracion_ms < 1 || action.duracion_ms > maxDuration)) return false;
  if (action.tipo === 'demo' && !id(action.id_demo)) return false;
  if (action.tipo === 'crear_comando' && (!object(action.comando) || !id(action.comando.id_vehiculo)
    || !text(action.comando.nombre, 60) || !Number.isSafeInteger(action.comando.codigo)
    || !(action.comando.descripcion === undefined || action.comando.descripcion === null || typeof action.comando.descripcion === 'string'))) return false;
  if (value.confirmacion !== undefined && value.confirmacion !== null) {
    if (!['crear_comando', 'eliminar_comando'].includes(action.tipo)) return false;
    const confirmation = value.confirmacion;
    if (!object(confirmation) || !text(confirmation.token, 200) || !text(confirmation.resumen, 1000)
      || !Number.isInteger(confirmation.expira_en_segundos) || confirmation.expira_en_segundos < 1
      || confirmation.expira_en_segundos > 300) return false;
  }
  return true;
}

/** STOP corto y explícito no espera a Gemini; una negación no coincide. */
export function isStopMessage(value) {
  const normalized = value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/[.!¡¿?]+$/g, '').trim();
  return /^(?:detener(?: todo| la excavadora| el vehiculo)?|detente|para|parar|alto|stop|cancela(?:r)?(?: la)? demo)$/.test(normalized);
}
