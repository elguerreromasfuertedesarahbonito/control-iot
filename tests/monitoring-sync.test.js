import test from 'node:test';
import assert from 'node:assert/strict';
import { MonitorModel } from '../assets/js/monitoring/monitor.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const debounce = () => new Promise(resolve => setTimeout(resolve, 15));
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const state = (command = 1, vehicle = 1) => ({ id_vehiculo: vehicle, vehiculo: 'Excavadora',
  id_comando: command, comando: `COMANDO ${command}`, codigo: command + 10,
  conectado: true, fecha_actualizacion: '2026-11-11T17:00:00' });
const row = (id, overrides = {}) => ({ id_historial: id, id_vehiculo: 1, comando: 'AVANZAR',
  codigo: 4, fecha_hora: '2026-11-11T17:00:00', origen: 'MANUAL', ...overrides });
const manual = (id, command = 2, vehicle = 1) => ({ tipo: 'estado', origen: 'MANUAL',
  id_vehiculo: vehicle, id_evento: uuid(id), estado: state(command, vehicle) });
const welcome = (vehicle = 1) => ({ tipo: 'bienvenida', origen: 'TELEMETRIA',
  id_vehiculo: vehicle, id_demo: 7, corriendo: false, estado: state(1, vehicle) });

function fixture(overrides = {}, options = {}) {
  const calls = { state: [], history: [] };
  const api = {
    state(options) { calls.state.push(options); return Promise.resolve(state()); },
    history(options) { calls.history.push(options); return Promise.resolve([row(1)]); },
    ...overrides,
  };
  for (const method of ['manual', 'startDemo', 'stopDemo']) {
    api[method] = () => assert.fail('Monitoreo no debe enviar órdenes.');
  }
  const changes = [];
  const model = new MonitorModel(api, { vehicleId: 1, onChange: value => changes.push(value),
    historyDebounceMs: 0, ...options });
  return { model, api, calls, changes };
}

test('activation reads persisted state and ten distinct rows, preserving every origin', async t => {
  const rows = Array.from({ length: 16 }, (_, i) => row(i + 1,
    { origen: ['MANUAL', 'WORKBENCH', 'SEGURIDAD'][i % 3] }));
  const { model, calls } = fixture({ history(options) {
    calls.history.push(options);
    return Promise.resolve([...rows, row(16), row(99, { id_vehiculo: 2 })]);
  } });
  t.after(() => model.destroy());
  assert.equal(calls.state.length, 0);
  await model.setActive(true);
  const value = model.snapshot();
  assert.equal(value.latestSource, 'REST');
  assert.equal(value.latest.id_comando, 1);
  assert.deepEqual(value.history.map(item => item.id_historial), [16, 15, 14, 13, 12, 11, 10, 9, 8, 7]);
  assert.equal(new Set(value.history.map(item => item.origen)).size, 3);
  assert.equal(value.historyLoading, false);
  assert.equal(calls.state.length, 1);
  assert.equal(calls.history.length, 1);
  value.history[0].comando = 'Cambio de la vista';
  value.latest.comando = 'Cambio de la vista';
  assert.notEqual(model.snapshot().history[0].comando, value.history[0].comando);
  assert.notEqual(model.snapshot().latest.comando, value.latest.comando);
});

test('an in-flight older REST result cannot overwrite a newer WS event', async t => {
  const old = deferred();
  const { model } = fixture({ state: () => old.promise });
  t.after(() => model.destroy());
  const reading = model.setActive(true);
  model.observe(manual(1, 5));
  assert.equal(model.snapshot().latest.id_comando, 5);
  assert.equal(model.snapshot().latestSource, 'WSS');
  old.resolve(state(1));
  await reading;
  assert.equal(model.snapshot().latest.id_comando, 5);
  assert.equal(model.snapshot().latestSource, 'WSS');
  assert.equal(model.snapshot().latestError, '');
});

test('out-of-order manual snapshots cannot resurrect old state but still refresh persisted history', async t => {
  const { model, calls } = fixture();
  t.after(() => model.destroy());
  await model.setActive(true);
  model.observe({ tipo: 'estado', origen: 'TELEMETRIA', id_vehiculo: 1,
    estado: { ...state(9), fecha_actualizacion: '2026-11-11T17:00:02' } });
  const old = { ...manual(2, 1), estado: { ...state(1), fecha_actualizacion: '2026-11-11T17:00:01' } };
  model.observe(old);
  assert.equal(model.snapshot().latest.id_comando, 9);
  assert.equal(model.snapshot().latest.fecha_actualizacion, '2026-11-11T17:00:02');
  assert.equal(model.snapshot().activity, 'Comando individual publicado por WSS.');
  await debounce();
  assert.equal(calls.history.length, 2);
  model.observe(old);
  await debounce();
  assert.equal(calls.history.length, 2);
  // Different accepted commands can legitimately share the same DB second.
  model.observe({ ...manual(3, 5), estado: { ...state(5), fecha_actualizacion: '2026-11-11T17:00:02' } });
  assert.equal(model.snapshot().latest.id_comando, 5);
});

test('REST begun after a WS snapshot cannot replace it with an older database timestamp', async t => {
  const { model, api, calls } = fixture();
  t.after(() => model.destroy());
  await model.setActive(true);
  model.observe({ tipo: 'estado', origen: 'TELEMETRIA', id_vehiculo: 1,
    estado: { ...state(9), fecha_actualizacion: '2026-11-11T17:00:02' } });
  api.state = async () => ({ ...state(1), fecha_actualizacion: '2026-11-11T11:00:01-06:00' });
  await model.refresh();
  assert.equal(model.snapshot().latest.id_comando, 9);
  assert.equal(model.snapshot().latestSource, 'WSS');
  assert.equal(model.snapshot().latestError, '');
  model.observe(welcome());
  await tick();
  assert.equal(calls.history.length, 3, 'a welcome still resynchronizes when its state is older');
  assert.equal(model.snapshot().latest.id_comando, 9);
});

test('DEMO commands update immediately without fabricated dates or persisted rows', async t => {
  const { model, calls } = fixture();
  t.after(() => model.destroy());
  await model.setActive(true);
  const before = model.snapshot().history;
  const metadata = { origen: 'DEMO', id_vehiculo: 1, id_demo: 7, id_ejecucion: uuid(50) };
  model.observe({ ...metadata, tipo: 'inicio' });
  model.observe({ ...metadata, tipo: 'comando', id_comando: 5, codigo: 16,
    nombre: 'SUBIR_BRAZO', orden: 3 });
  assert.deepEqual(model.snapshot().latest, { id_vehiculo: 1, id_comando: 5, codigo: 16,
    comando: 'SUBIR_BRAZO', fecha_actualizacion: null });
  assert.equal(model.snapshot().latestSource, 'DEMO');
  for (const tipo of ['pausa', 'fin', 'cancelado']) model.observe({ ...metadata, tipo });
  await debounce();
  assert.equal(model.snapshot().activity, 'DEMO cancelada.');
  assert.deepEqual(model.snapshot().history, before);
  assert.equal(calls.history.length, 1);
  assert.equal(calls.state.length, 1);
  model.observe({ ...metadata, tipo: 'estado', estado: state(9) });
  assert.equal(model.snapshot().latest.id_comando, 9);
  assert.equal(model.snapshot().latestSource, 'WSS');
});

test('duplicate manual UUIDs neither create history rows nor cause request storms', async t => {
  const { model, calls } = fixture();
  t.after(() => model.destroy());
  await model.setActive(true);
  for (let i = 0; i < 100; ++i) model.observe(manual(1, 5));
  await debounce();
  assert.equal(calls.history.length, 2);
  assert.deepEqual(model.snapshot().history.map(item => item.id_historial), [1]);
  model.observe(manual(1, 8));
  await debounce();
  assert.equal(calls.history.length, 2);
  assert.equal(model.snapshot().latest.id_comando, 5);
});

test('manual bursts during one history read trigger exactly one non-overlapping catch-up', async t => {
  const old = deferred();
  let reads = 0, concurrent = 0, maxConcurrent = 0;
  const { model } = fixture({ history: async () => {
    ++reads;
    ++concurrent;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    try { return reads === 1 ? await old.promise : [row(2), row(1)]; }
    finally { --concurrent; }
  } });
  t.after(() => model.destroy());
  const reading = model.setActive(true);
  for (let i = 1; i <= 100; ++i) model.observe(manual(i));
  for (let i = 0; i < 20; ++i) void model.refresh();
  assert.equal(reads, 1);
  old.resolve([row(1)]);
  await reading;
  await debounce();
  assert.equal(reads, 2);
  assert.equal(maxConcurrent, 1);
  assert.deepEqual(model.snapshot().history.map(item => item.id_historial), [2, 1]);
  await debounce();
  assert.equal(reads, 2, 'there is no periodic polling');
});

test('offline retains the last values; online plus welcome coalesce one resynchronization', async t => {
  const { model, calls } = fixture();
  t.after(() => model.destroy());
  await model.setActive(true);
  const before = model.snapshot();
  model.setSocketStatus('reconnecting');
  assert.deepEqual(model.snapshot().latest, before.latest);
  assert.deepEqual(model.snapshot().history, before.history);
  assert.equal(model.snapshot().stale, true);
  assert.equal(calls.history.length, 1);
  model.setSocketStatus('online');
  model.observe(welcome());
  await tick();
  assert.equal(calls.state.length, 2);
  assert.equal(calls.history.length, 2);
  assert.equal(model.snapshot().stale, false);
  model.setSocketStatus('online');
  await tick();
  assert.equal(calls.history.length, 2);
});

test('changing vehicles aborts old reads and ignores late responses even if transport ignores abort', async t => {
  const oldState = deferred(), oldHistory = deferred();
  const signals = [];
  const { model } = fixture({
    state({ signal }) { signals.push(signal); return oldState.promise; },
    history({ signal }) { signals.push(signal); return oldHistory.promise; },
  });
  t.after(() => model.destroy());
  const first = model.setActive(true);
  const next = { state: async () => state(6, 2), history: async () => [row(20, { id_vehiculo: 2 })] };
  await model.setContext(next, 2);
  assert.ok(signals.every(signal => signal.aborted));
  oldState.resolve(state(1));
  oldHistory.resolve([row(1)]);
  await first;
  model.observe(manual(60, 8, 1));
  assert.equal(model.snapshot().vehicleId, 2);
  assert.equal(model.snapshot().latest.id_comando, 6);
  assert.deepEqual(model.snapshot().history.map(item => item.id_historial), [20]);
});

test('a reconnect during old REST reads guarantees one subsequent fresh catch-up', async t => {
  const oldState = deferred(), oldHistory = deferred();
  let states = 0, histories = 0;
  const { model } = fixture({
    state: () => ++states === 1 ? oldState.promise : Promise.resolve(state(9)),
    history: () => ++histories === 1 ? oldHistory.promise : Promise.resolve([row(9), row(1)]),
  });
  t.after(() => model.destroy());
  const reading = model.setActive(true);
  model.setSocketStatus('reconnecting');
  model.setSocketStatus('online');
  model.observe(welcome());
  await tick();
  assert.equal(states, 1);
  assert.equal(histories, 1);
  oldState.resolve(state(1));
  oldHistory.resolve([row(1)]);
  await reading;
  await debounce();
  assert.equal(states, 2);
  assert.equal(histories, 2);
  assert.equal(model.snapshot().latest.id_comando, 9);
  assert.equal(model.snapshot().history[0].id_historial, 9);
});

test('state and history settle independently, 404 is empty state, and failures preserve prior history', async t => {
  const pendingHistory = deferred();
  const { model, api } = fixture({ state: async () => { throw { status: 404 }; },
    history: () => pendingHistory.promise });
  t.after(() => model.destroy());
  const reading = model.setActive(true);
  await tick();
  assert.equal(model.snapshot().latest, null);
  assert.equal(model.snapshot().latestError, '');
  assert.equal(model.snapshot().latestLoading, false);
  assert.equal(model.snapshot().historyLoading, true);
  assert.match(model.snapshot().activity, /Sin movimientos/);
  pendingHistory.resolve([row(3)]);
  await reading;
  api.state = async () => state(7);
  api.history = async () => { throw new Error('not available'); };
  await model.refresh();
  assert.equal(model.snapshot().latest.id_comando, 7);
  assert.equal(model.snapshot().latestError, '');
  assert.match(model.snapshot().historyError, /historial persistido/);
  assert.deepEqual(model.snapshot().history.map(item => item.id_historial), [3]);
  api.state = async () => { throw new Error('not available'); };
  api.history = async () => [row(4)];
  await model.refresh();
  assert.equal(model.snapshot().latest.id_comando, 7);
  assert.match(model.snapshot().latestError, /último estado/);
  assert.equal(model.snapshot().historyError, '');
  assert.equal(model.snapshot().history[0].id_historial, 4);
});

test('foreign or malformed REST and WS state cannot become the selected vehicle state', async t => {
  const { model, api } = fixture();
  t.after(() => model.destroy());
  await model.setActive(true);
  api.state = async () => state(8, 2);
  api.history = async () => [{ ...row(2), id_historial: '2' }];
  await model.refresh();
  assert.equal(model.snapshot().latest.id_comando, 1);
  assert.match(model.snapshot().latestError, /vehículo seleccionado/);
  assert.match(model.snapshot().historyError, /contrato/);
  model.observe(manual(99, 7, 2));
  model.observe({ ...manual(100, 7), estado: { ...state(7), conectado: 'true' } });
  model.observe({ ...manual(101, 7), estado: state(7, 2) });
  assert.equal(model.snapshot().latest.id_comando, 1);
});

test('hiding cancels only monitoring reads and retains WS observations until the next entry', async t => {
  const result = deferred();
  const { model, calls } = fixture({ state: ({ signal }) => {
    calls.state.push({ signal });
    return result.promise;
  } });
  t.after(() => model.destroy());
  const reading = model.setActive(true);
  await model.setActive(false);
  assert.equal(calls.state[0].signal.aborted, true);
  model.observe(manual(1, 5));
  await debounce();
  assert.equal(model.snapshot().latest.id_comando, 5);
  assert.equal(calls.history.length, 1);
  result.resolve(state(1));
  await reading;
  assert.equal(model.snapshot().latest.id_comando, 5);
  await model.setActive(true);
  assert.equal(calls.history.length, 2);
});

test('simulation leaves monitoring disabled without any synthetic or network data', async t => {
  const { model, calls } = fixture({}, { enabled: false });
  t.after(() => model.destroy());
  await model.setActive(true);
  model.setSocketStatus('online');
  model.observe(welcome());
  model.observe(manual(1));
  await model.refresh();
  await tick();
  assert.deepEqual(calls, { state: [], history: [] });
  assert.equal(model.snapshot().disabled, true);
  assert.equal(model.snapshot().connection, 'offline');
  assert.equal(model.snapshot().latest, null);
  assert.deepEqual(model.snapshot().history, []);
  assert.match(model.snapshot().activity, /requiere servicios reales/);
});
