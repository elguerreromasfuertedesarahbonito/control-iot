import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApi } from '../assets/js/api.js';

const config = { apiBaseUrl: 'https://api.example.test', vehicleId: 7, requestTimeoutMs: 8000 };
const state = (overrides = {}) => ({ id_vehiculo: 7, vehiculo: 'Excavadora', id_comando: 42,
  comando: 'AVANZAR', codigo: 4, conectado: true, fecha_actualizacion: '2026-11-11T23:33:01', ...overrides });
const row = (id, overrides = {}) => ({ id_historial: id, id_vehiculo: 7, comando: 'AVANZAR',
  codigo: 4, fecha_hora: '2026-11-11T23:33:01', origen: 'MANUAL', ...overrides });
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });

test('monitoring HTTP methods use exact GET routes without invented query limits or request bodies', async () => {
  const calls = [];
  const history = Array.from({ length: 13 }, (_, index) => row(index + 1,
    { origen: ['MANUAL', 'SEGURIDAD', 'WORKBENCH'][index % 3] }));
  const api = createApi(config, { fetchImpl: async (url, options) => {
    calls.push({ url: new URL(url), options });
    return response(url.endsWith('/estado/7') ? state() : history);
  } });
  assert.equal(calls.length, 0, 'constructing the API does not fetch');
  assert.deepEqual(await api.state(), state());
  assert.deepEqual(await api.history(), history, 'normalization and the ten-row limit belong to the model');
  assert.deepEqual(calls.map(({ url }) => url.pathname), ['/estado/7', '/historial/7']);
  for (const { url, options } of calls) {
    assert.equal(url.search, '');
    assert.equal(options.method, 'GET');
    assert.equal(Object.hasOwn(options, 'body'), false);
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test('state and history propagate cancellation to their GET transports without retrying', async () => {
  for (const method of ['state', 'history']) {
    const controller = new AbortController();
    let calls = 0, transportSignal;
    const api = createApi(config, { fetchImpl: (_url, { signal }) => {
      ++calls;
      transportSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('transport aborted')), { once: true });
      });
    } });
    const reading = api[method]({ signal: controller.signal });
    assert.equal(calls, 1);
    controller.abort();
    await assert.rejects(reading, error => error instanceof ApiError && error.kind === 'aborted');
    assert.equal(transportSignal.aborted, true);
    assert.equal(calls, 1);
    await assert.rejects(api[method]({ signal: controller.signal }), error => error.kind === 'aborted');
    assert.equal(calls, 1, 'an already cancelled monitoring read never starts Fetch');
  }
});

test('state 404 remains identifiable while valid empty history and nullable joined fields are accepted', async () => {
  const missing = createApi(config, { fetchImpl: async () => response({ detail: 'Estado no encontrado' }, 404) });
  await assert.rejects(missing.state(), error => error.kind === 'http' && error.status === 404);
  const empty = createApi(config, { fetchImpl: async () => response([]) });
  assert.deepEqual(await empty.history(), []);
  const nullable = createApi(config, { fetchImpl: async url => response(url.endsWith('/estado/7')
    ? state({ id_comando: null, comando: null, codigo: null })
    : [row(538, { comando: null, codigo: null })]) });
  assert.equal((await nullable.state()).id_comando, null);
  assert.equal((await nullable.history())[0].comando, null);
});

test('monitoring rejects malformed fields rather than accepting fabricated state or history contracts', async () => {
  for (const [method, data] of [
    ['state', state({ conectado: 'true' })],
    ['state', state({ fecha_actualizacion: '2026-11-11T24:00:00' })],
    ['history', [row(1, { id_historial: '1' })]],
    ['history', [row(1, { fecha_hora: 'today' })]],
    ['history', { items: [row(1)] }],
  ]) {
    let calls = 0;
    const api = createApi(config, { fetchImpl: async () => { ++calls; return response(data); } });
    await assert.rejects(api[method](), error => error.kind === 'invalid-response' && error.status === 200);
    assert.equal(calls, 1);
  }
});

test('monitoring invalid vehicle IDs fail before Fetch and server failures are not retried', async () => {
  let calls = 0;
  const fetchImpl = async () => { ++calls; return response({ detail: 'private database trace' }, 503); };
  for (const vehicleId of [0, -1, '7', true]) {
    const api = createApi({ ...config, vehicleId }, { fetchImpl });
    await assert.rejects(api.state(), error => error.kind === 'config');
    await assert.rejects(api.history(), error => error.kind === 'config');
  }
  assert.equal(calls, 0);
  const api = createApi(config, { fetchImpl });
  for (const method of ['state', 'history']) {
    await assert.rejects(api[method](), error => error.kind === 'http' && error.status === 503
      && !error.message.includes('private database trace'));
  }
  assert.equal(calls, 2);
});
