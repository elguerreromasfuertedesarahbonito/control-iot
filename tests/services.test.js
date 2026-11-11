import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApi } from '../assets/js/api.js';
import { buildCatalog } from '../assets/js/catalog.js';
import { DemoSocket } from '../assets/js/socket.js';

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const config = { apiBaseUrl: 'https://api.example.test', wsUrlTemplate: 'wss://api.example.test/ws/demos/{id_demo}',
  vehicleId: 1, healthPath: '/health', requestTimeoutMs: 8000 };
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const command = (id, nombre, changes = {}) => ({ id_comando: id, id_vehiculo: 1,
  codigo: id + 100, nombre, descripcion: null, activo: true, ...changes });

function secureLocation(t) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { protocol: 'https:' } });
  t.after(() => descriptor ? Object.defineProperty(globalThis, 'location', descriptor) : delete globalThis.location);
}

test('REST uses the real routes, methods and manual JSON without sending cookies', async () => {
  const calls = [];
  const replies = [
    { status: 'ok', db: 'vehiculo_iot' },
    { id_vehiculo: 1, nombre: 'Excavadora' },
    [command(42, 'AVANZAR')],
    [{ id_demo: 7, nombre: 'Prueba' }],
    [{ id_comando: 42, orden: 1, duracion_ms: 500, pausa_ms: 100 }],
    { id_demo: 7, id_vehiculo: 1, corriendo: false },
    { ok: true, id_vehiculo: 1, id_comando: 42, id_evento: uuid(1), estado: {} },
    { ok: true, id_vehiculo: 1, id_demo: 7, total_movimientos: 1, corriendo: true, id_ejecucion: uuid(2) },
    { ok: true, id_demo: 7, detenido: true, estaba_corriendo: true },
  ];
  const api = createApi(config, { fetchImpl: async (url, options) => {
    calls.push([new URL(url).pathname, options]);
    return response(replies.shift(), options.method === 'POST' ? 201 : 200);
  } });
  assert.equal(calls.length, 0, 'Constructing a client must not open a connection');
  await api.health(); await api.vehicle(); await api.commands(); await api.demos();
  await api.movements(7); await api.demoStatus(7); await api.manual(42); await api.startDemo(7); await api.stopDemo(7);
  assert.deepEqual(calls.map(([path, options]) => [options.method, path]), [
    ['GET', '/health'], ['GET', '/vehiculos/1'], ['GET', '/comandos/vehiculo/1'], ['GET', '/demos/vehiculo/1'],
    ['GET', '/demos/7/movimientos'], ['GET', '/demos/7/estado-ejecucion'],
    ['POST', '/vehiculos/1/comando-manual'], ['POST', '/demos/7/ejecutar'], ['POST', '/demos/7/detener'],
  ]);
  assert.deepEqual(JSON.parse(calls[6][1].body), { id_comando: 42, origen: 'MANUAL' });
  assert.equal(calls[6][1].headers['Content-Type'], 'application/json');
  assert.equal('body' in calls[7][1], false, 'The existing DEMO POST has no invented JSON body');
  assert.equal('body' in calls[8][1], false);
  for (const [, options] of calls) {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.Accept, 'application/json');
    assert.ok(options.signal instanceof AbortSignal);
  }
});

test('REST rejects invalid IDs and mixed content before calling Fetch', async t => {
  secureLocation(t);
  let calls = 0;
  const fetchImpl = async () => { ++calls; return response({ status: 'ok' }); };
  const api = createApi({ ...config, apiBaseUrl: 'http://api.example.test' }, { fetchImpl });
  await assert.rejects(api.health(), error => error instanceof ApiError && error.kind === 'mixed-content');
  const secureApi = createApi(config, { fetchImpl });
  await assert.rejects(secureApi.manual('42'), error => error.kind === 'config');
  await assert.rejects(secureApi.startDemo(0), error => error.kind === 'config');
  const credentialsApi = createApi({ ...config, apiBaseUrl: 'https://user:secret@api.example.test' }, { fetchImpl });
  await assert.rejects(credentialsApi.health(), error => error.kind === 'config');
  assert.equal(calls, 0);
});

test('REST distinguishes HTTP errors, malformed JSON, invalid contracts and network errors', async () => {
  const http = createApi(config, { fetchImpl: async () => response({ detail: 'Conflict' }, 409) });
  await assert.rejects(http.startDemo(7), error => error.kind === 'http' && error.status === 409);
  const internal = createApi(config, { fetchImpl: async () => response({ detail: 'private dependency trace' }, 500) });
  await assert.rejects(internal.health(), error => error.status === 500 && !error.message.includes('private dependency trace'));
  const json = createApi(config, { fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError(); } }) });
  await assert.rejects(json.health(), error => error.kind === 'invalid-response');
  const invalid = createApi(config, { fetchImpl: async () => response({ status: 'unknown' }) });
  await assert.rejects(invalid.health(), error => error.kind === 'invalid-response');
  const malformedMovement = createApi(config, { fetchImpl: async () => response([{ id_comando: 2, orden: 1, duracion_ms: -1 }]) });
  await assert.rejects(malformedMovement.movements(7), error => error.kind === 'invalid-response');
  const offline = createApi(config, { fetchImpl: async () => { throw new TypeError('Offline'); } });
  await assert.rejects(offline.health(), error => error.kind === 'network');
});

test('REST timeout aborts transport and reports timeout rather than successful cancellation', async () => {
  let calls = 0;
  const api = createApi({ ...config, requestTimeoutMs: 5 }, { fetchImpl: (_url, { signal }) => {
    ++calls;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  await assert.rejects(api.health(), error => error.kind === 'timeout');
  assert.equal(calls, 1, 'A timed-out POST/GET must not be silently retried');
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api.manual(42, { signal: controller.signal }), error => error.kind === 'aborted');
  assert.equal(calls, 1);
});

test('catalog takes actual IDs/codes and excludes inactive, foreign and duplicate commands', () => {
  const commands = [command(42, 'Avanzar'), command(71, 'RETROCEDER'), command(82, 'Girar izquierda'),
    command(91, 'GIRAR_DERECHA'), command(95, 'DETENER'), command(120, 'SUBIR_BRAZO'), command(121, 'LUZ'),
    command(1, 'INACTIVO', { activo: false }), command(2, 'OTRO', { id_vehiculo: 2 }),
    command(3, 'REPETIDO'), command(3, 'REPETIDO DOS')];
  const catalog = buildCatalog(commands, 1);
  assert.equal(catalog.directions.forward.id_comando, 42);
  assert.equal(catalog.directions.forward.codigo, 142);
  assert.equal(catalog.directions.left.id_comando, 82);
  assert.equal(catalog.directions.stop.id_comando, 95);
  assert.equal(catalog.tools.forward.id_comando, 120);
  assert.deepEqual(catalog.auxiliary.map(value => value.id_comando), [121]);
  assert.equal(catalog.byId.has(1), false);
  assert.equal(catalog.byId.has(2), false);
  assert.equal(catalog.byId.has(3), false);
  const ambiguous = buildCatalog([...commands, command(43, 'AVANZAR')], 1);
  assert.equal(ambiguous.directions.forward, null);
});

test('tool joystick resolves the four real functions and keeps extra commands available', () => {
  const commands = [command(25, 'Subir brazo'), command(38, 'BAJAR_BRAZO'),
    command(44, 'Abrir pala'), command(59, 'cerrar-pala'), command(63, 'SONIDO')];
  const catalog = buildCatalog(commands, 1);
  assert.deepEqual(Object.values(catalog.tools).map(value => value.id_comando), [25, 38, 44, 59]);
  assert.deepEqual(catalog.auxiliary.map(value => value.id_comando), [63]);
  assert.equal(catalog.tools.left.nombre, 'Abrir pala');
  assert.equal(catalog.tools.right.nombre, 'cerrar-pala');
  const ambiguous = buildCatalog([...commands, command(78, 'ABRIR_PALA')], 1);
  assert.equal(ambiguous.tools.left, null);
  assert.deepEqual(ambiguous.auxiliary.map(value => value.id_comando), [63]);
  assert.equal(buildCatalog([], 1).tools.forward, null);
});

class FakeSocket {
  static instances = [];
  constructor(url) { this.url = url; this.closed = false; FakeSocket.instances.push(this); }
  send() { throw new Error('An observer must never send commands or telemetry'); }
  close() { this.closed = true; this.onclose?.({ code: 1000 }); }
  message(value) { this.onmessage?.({ data: typeof value === 'string' ? value : JSON.stringify(value) }); }
}
const welcome = (demo = 7, vehicle = 1) => ({ tipo: 'bienvenida', origen: 'TELEMETRIA', id_demo: demo,
  id_vehiculo: vehicle, corriendo: false,
  estado: { id_vehiculo: vehicle, id_comando: 9, conectado: true } });

test('socket is an observer and becomes online only after a valid welcome', t => {
  FakeSocket.instances = [];
  const statuses = [], events = [], ready = [];
  const socket = new DemoSocket(config, { WebSocketImpl: FakeSocket,
    onStatus: value => statuses.push(value), onEvent: value => events.push(value), onReady: value => ready.push(value) });
  t.after(() => socket.disconnect());
  assert.equal(socket.connect(7), true);
  const transport = FakeSocket.instances[0];
  assert.equal(transport.url, 'wss://api.example.test/ws/demos/7');
  assert.deepEqual(statuses, ['connecting']);
  transport.onopen?.();
  assert.deepEqual(statuses, ['connecting'], 'TCP/WebSocket opening alone does not prove room registration');
  transport.message(welcome(7, 2));
  transport.message('{invalid');
  transport.message({ tipo: 'estado', origen: 'MANUAL', id_vehiculo: 1, id_evento: uuid(1), estado: { id_vehiculo: 1, id_comando: 42, conectado: true } });
  assert.equal(ready.length, 0);
  assert.equal(events.length, 0);
  transport.message(welcome());
  assert.deepEqual(statuses, ['connecting', 'online']);
  assert.equal(ready.length, 1);
  transport.message({ tipo: 'estado', origen: 'MANUAL', id_vehiculo: 1, id_evento: uuid(1), secret: 'discard',
    estado: { id_vehiculo: 1, id_comando: 42, conectado: true, secret: 'discard' } });
  assert.equal(events.length, 2);
  assert.equal(events[1].id_evento, uuid(1));
  assert.equal('secret' in events[1], false);
  assert.equal('secret' in events[1].estado, false);
});

test('old socket callbacks cannot change a newer session', t => {
  FakeSocket.instances = [];
  const statuses = [], events = [];
  const socket = new DemoSocket(config, { WebSocketImpl: FakeSocket,
    onStatus: value => statuses.push(value), onEvent: value => events.push(value) });
  t.after(() => socket.disconnect());
  socket.connect(7);
  const old = FakeSocket.instances[0];
  old.message(welcome());
  socket.connect(8);
  const current = FakeSocket.instances[1];
  current.message(welcome(8));
  const before = statuses.length;
  old.onclose?.({ code: 1006 });
  old.message(welcome());
  assert.equal(statuses.length, before);
  assert.equal(statuses.at(-1), 'online');
  assert.deepEqual(events.map(event => event.id_demo), [7, 8]);
});

test('socket switches to reconnecting immediately and recovers after a new welcome', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(Math, 'random', () => 0.5);
  FakeSocket.instances = [];
  const statuses = [];
  const socket = new DemoSocket(config, { WebSocketImpl: FakeSocket, onStatus: value => statuses.push(value) });
  t.after(() => socket.disconnect());
  socket.connect(7);
  FakeSocket.instances[0].message(welcome());
  FakeSocket.instances[0].onerror?.();
  assert.equal(statuses.at(-1), 'reconnecting');
  t.mock.timers.tick(1000);
  assert.equal(FakeSocket.instances.length, 2);
  FakeSocket.instances[1].message(welcome());
  assert.equal(statuses.at(-1), 'online');
});

test('socket blocks insecure WS on an HTTPS page without opening transport', t => {
  secureLocation(t);
  FakeSocket.instances = [];
  const statuses = [];
  const socket = new DemoSocket({ ...config, wsUrlTemplate: 'ws://api.example.test/ws/demos/{id_demo}' },
    { WebSocketImpl: FakeSocket, onStatus: (status, detail) => statuses.push([status, detail]) });
  t.after(() => socket.disconnect());
  assert.equal(socket.connect(7), false);
  assert.equal(FakeSocket.instances.length, 0);
  assert.equal(statuses[0][0], 'offline');
  assert.equal(statuses[0][1].error.kind, 'mixed-content');
});
