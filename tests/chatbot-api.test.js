import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApi } from '../assets/js/api.js';

const requestId = '00000000-0000-4000-8000-000000000041';
const anotherId = '00000000-0000-4000-8000-000000000042';
const config = {
  apiBaseUrl: 'https://api.example.test', vehicleId: 7,
  requestTimeoutMs: 8000, assistantTimeoutMs: 35000,
};
const actionResponse = (accion, changes = {}) => ({ request_id: requestId, mensaje: 'Respuesta simulada.', accion, ...changes });
const movement = () => actionResponse({ tipo: 'comando', id_comando: 81, duracion_ms: 1000 });
const createAction = changes => ({ tipo: 'crear_comando', comando: { id_vehiculo: 7, nombre: 'LUZ', codigo: 16, ...changes } });
const proposal = () => ({ token: 'simulated-opaque-token', resumen: 'Crear LUZ', expira_en_segundos: 60 });
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

function fixture(replies, changes = {}) {
  const calls = [];
  const queue = [...replies];
  const api = createApi({ ...config, ...changes }, { fetchImpl: async (url, options) => {
    calls.push({ url, options });
    assert.ok(queue.length, 'ninguna llamada no prevista debe usar red real');
    return queue.shift();
  } });
  return { api, calls };
}

const invalidResponse = error => error instanceof ApiError && error.kind === 'invalid-response' && error.status === 200;

test('transcribir sube audio binario a la API sin clave administrativa', async () => {
  const audio = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/webm;codecs=opus' });
  const { api, calls } = fixture([response({ texto: 'estado' }), response({ texto: '' })]);
  assert.equal(await api.transcribeVoice(audio), 'estado');
  assert.equal(await api.transcribeVoice(audio), '');
  const { url, options } = calls[0];
  assert.equal(url, 'https://api.example.test/asistente/transcribir');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['Content-Type'], 'audio/webm');
  assert.equal(options.body, audio);
  assert.equal('X-Admin-Key' in options.headers, false);
  assert.equal(options.credentials, 'omit');
});

test('interpretar usa POST, vehículo/UUID correlacionado y únicamente el cuerpo del contrato', async () => {
  const data = movement();
  const { api, calls } = fixture([response(data)]);
  assert.equal(calls.length, 0, 'construir el cliente no abre conexiones');
  assert.deepEqual(await api.interpret('avanza un segundo', requestId), data);
  assert.equal(calls.length, 1);
  const { url, options } = calls[0];
  assert.equal(url, 'https://api.example.test/asistente/interpretar');
  assert.equal(options.method, 'POST');
  assert.deepEqual(JSON.parse(options.body), { id_vehiculo: 7, mensaje: 'avanza un segundo', request_id: requestId });
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.equal(options.headers.Accept, 'application/json');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.cache, 'no-store');
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal('X-Admin-Key' in options.headers, false);
});

test('interpretar acepta hasta diez segundos para el transcript y solo para el transcript', async () => {
  const command = duration => actionResponse({ tipo: 'comando', id_comando: 81, duracion_ms: duration });
  const { api, calls } = fixture([response(command(10000)), response(command(10001)), response(command(5000))]);
  const query = 'avanza durante diez segundos';
  assert.deepEqual(await api.interpret(query, requestId, { entrada: 'voz' }), command(10000));
  assert.deepEqual(JSON.parse(calls[0].options.body), { id_vehiculo: 7, mensaje: query, request_id: requestId, entrada: 'voz' });
  await assert.rejects(api.interpret(query, requestId, { entrada: 'voz' }), invalidResponse);
  await assert.rejects(api.interpret(query, requestId), invalidResponse);
  assert.equal('entrada' in JSON.parse(calls[2].options.body), false);
});

test('el POST manual envía la duración solo cuando se indica y comprueba la duración aceptada', async () => {
  const accepted = { ok: true, id_vehiculo: 7, id_comando: 81, id_evento: requestId, estado: {} };
  const timed = { ...accepted, duracion_ms: 5000 };
  const { api, calls } = fixture([response(accepted), response(timed), response(accepted)]);
  assert.deepEqual(await api.manual(81), accepted);
  assert.deepEqual(JSON.parse(calls[0].options.body), { id_comando: 81, origen: 'MANUAL' });
  assert.deepEqual(await api.manual(81, { durationMs: 5000 }), timed);
  assert.deepEqual(JSON.parse(calls[1].options.body), { id_comando: 81, origen: 'MANUAL', duracion_ms: 5000 });
  await assert.rejects(api.manual(81, { durationMs: 5000 }), invalidResponse);
  await assert.rejects(api.manual(81, { durationMs: 10001 }), error => error.kind === 'config');
  assert.equal(calls.length, 3);
});

test('confirmar envía la clave solo en su cabecera y nunca la conserva para interpretar', async () => {
  const simulatedKey = 'simulated-admin-header-only';
  const confirmed = actionResponse({ tipo: 'eliminar_comando', id_comando: 81 });
  const informational = actionResponse({ tipo: 'catalogo' }, { request_id: anotherId });
  const { api, calls } = fixture([response(confirmed), response(informational)], { adminKey: 'unused-config-value' });
  await api.confirmAssistant('opaque-token', requestId, simulatedKey);
  await api.interpret('muestra el catálogo', anotherId);
  assert.equal(calls[0].url, 'https://api.example.test/asistente/confirmar');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].options.body), { token: 'opaque-token', request_id: requestId });
  assert.equal(calls[0].options.headers['X-Admin-Key'], simulatedKey);
  assert.equal(calls[0].options.body.includes(simulatedKey), false);
  assert.equal(calls[0].url.includes(simulatedKey), false);
  assert.equal('X-Admin-Key' in calls[1].options.headers, false);
  assert.equal(JSON.stringify(calls[1]).includes(simulatedKey), false);
  assert.equal(JSON.stringify(calls).includes('unused-config-value'), false);
  assert.equal(calls[0].options.credentials, 'omit');
});

test('una propuesta de creación admite descripcion omitida, como el esquema opcional del backend', async () => {
  const data = actionResponse(createAction(), { confirmacion: proposal() });
  const { api } = fixture([response(data)]);
  assert.deepEqual(await api.interpret('crea LUZ', requestId), data);
  assert.equal('descripcion' in data.accion.comando, false);
});

test('crear confirmado admite descripcion null y confirmacion null sin exigir un campo ok', async () => {
  const data = actionResponse(createAction({ descripcion: null }), { confirmacion: null });
  const { api } = fixture([response(data)]);
  assert.equal('ok' in data, false);
  assert.deepEqual(await api.confirmAssistant('opaque-token', requestId, 'simulated-key'), data);
});

test('eliminar confirmado acepta la respuesta de acción sin confirmacion ni ok adicionales', async () => {
  const data = actionResponse({ tipo: 'eliminar_comando', id_comando: 81 });
  const { api, calls } = fixture([response(data)]);
  assert.deepEqual(await api.confirmAssistant('opaque-delete-token', requestId, 'simulated-key'), data);
  assert.equal('confirmacion' in data, false);
  assert.equal('ok' in data, false);
  assert.equal(calls[0].options.method, 'POST', 'la confirmación no inventa un DELETE del cliente');
});

for (const [name, data] of [
  ['UUID inválido', movement()],
  ['UUID de otra solicitud', movement()],
  ['duración mayor de 1000 ms', actionResponse({ tipo: 'comando', id_comando: 81, duracion_ms: 1001 })],
  ['duración cero', actionResponse({ tipo: 'comando', id_comando: 81, duracion_ms: 0 })],
  ['ID de comando cero', actionResponse({ tipo: 'comando', id_comando: 0, duracion_ms: 1000 })],
  ['ID de comando convertido en texto', actionResponse({ tipo: 'comando', id_comando: '81', duracion_ms: 1000 })],
  ['acción desconocida del modelo', actionResponse({ tipo: 'ejecutar_codigo', codigo: 'no se ejecuta' })],
]) {
  if (name === 'UUID inválido') data.request_id = 'invalid-request-id';
  if (name === 'UUID de otra solicitud') data.request_id = anotherId;
  test(`interpretar rechaza respuesta con ${name}`, async () => {
    const { api, calls } = fixture([response(data)]);
    await assert.rejects(api.interpret('avanza', requestId), invalidResponse);
    assert.equal(calls.length, 1, 'rechazar un contrato no provoca otro POST');
  });
}

for (const [name, data] of [
  ['un nuevo movimiento', movement()],
  ['una propuesta todavía pendiente', actionResponse(createAction(), { confirmacion: proposal() })],
  ['una acción de consulta', actionResponse({ tipo: 'estado' })],
  ['UUID no correlacionado', actionResponse({ tipo: 'eliminar_comando', id_comando: 81 }, { request_id: anotherId })],
]) {
  test(`confirmar rechaza ${name} aunque HTTP responda 200`, async () => {
    const { api, calls } = fixture([response(data)]);
    await assert.rejects(api.confirmAssistant('opaque-token', requestId, 'simulated-key'), invalidResponse);
    assert.equal(calls.length, 1);
  });
}

test('un 400 de confirmación conserva el estado HTTP y no reintenta el POST automáticamente', async () => {
  const { api, calls } = fixture([response({ detail: 'Confirmación no válida.' }, 400)]);
  await assert.rejects(api.confirmAssistant('opaque-token', requestId, 'simulated-key'), error =>
    error instanceof ApiError && error.kind === 'http' && error.status === 400 && /Confirmación no válida/.test(error.message));
  assert.equal(calls.length, 1);
});

test('un error interno de confirmación no expone detalles privados del servidor', async () => {
  const privateDetail = 'simulated-private-dependency-detail';
  const { api, calls } = fixture([response({ detail: privateDetail }, 500)]);
  await assert.rejects(api.confirmAssistant('opaque-token', requestId, 'simulated-key'), error =>
    error.kind === 'http' && error.status === 500 && !error.message.includes(privateDetail));
  assert.equal(calls.length, 1);
});

test('la cancelación de una solicitud se propaga al transporte sin reintentar', async () => {
  let fetchCalls = 0, transportSignal;
  const api = createApi(config, { fetchImpl: (_url, { signal }) => {
    ++fetchCalls; transportSignal = signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('simulated abort')), { once: true }));
  } });
  const controller = new AbortController();
  const task = api.interpret('avanza', requestId, { signal: controller.signal });
  controller.abort();
  await assert.rejects(task, error => error.kind === 'aborted');
  assert.equal(transportSignal.aborted, true);
  assert.equal(fetchCalls, 1);
  await assert.rejects(api.confirmAssistant('opaque-token', requestId, 'simulated-key', { signal: controller.signal }), error => error.kind === 'aborted');
  assert.equal(fetchCalls, 1, 'una señal ya cancelada no abre otra petición');
});

test('interpretar respeta su timeout propio y aborta al vencer sin duplicar la solicitud', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0, transportSignal;
  const api = createApi({ ...config, requestTimeoutMs: 1, assistantTimeoutMs: 50 }, { fetchImpl: (_url, { signal }) => {
    ++calls; transportSignal = signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('simulated timeout')), { once: true }));
  } });
  const task = api.interpret('consulta', requestId);
  t.mock.timers.tick(1);
  assert.equal(transportSignal.aborted, false, 'la interpretación no usa el timeout corto de las otras lecturas');
  t.mock.timers.tick(49);
  await assert.rejects(task, error => error.kind === 'timeout');
  assert.equal(calls, 1);
});

test('la política HTTPS bloquea interpretar y confirmar sobre HTTP antes de cualquier envío', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'https:' } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'location', previous) : delete globalThis.location);
  const { api, calls } = fixture([], { apiBaseUrl: 'http://api.example.test' });
  await assert.rejects(api.interpret('avanza', requestId), error => error.kind === 'mixed-content');
  await assert.rejects(api.confirmAssistant('opaque-token', requestId, 'simulated-key'), error => error.kind === 'mixed-content');
  assert.equal(calls.length, 0);
});
