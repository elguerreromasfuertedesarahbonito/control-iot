import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlCoordinator } from '../assets/js/coordinator.js';

const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const forward = { id_comando: 10, nombre: 'AVANZAR' };
const backward = { id_comando: 11, nombre: 'RETROCEDER' };
const stopCommand = { id_comando: 99, nombre: 'DETENER' };
const catalog = { directions: { forward, backward, stop: stopCommand },
  byId: new Map([forward, backward, stopCommand].map(command => [command.id_comando, command])) };

function fixture(overrides = {}) {
  let identity = 0;
  const calls = [];
  const api = {
    manual(id) { calls.push(['manual', id]); return Promise.resolve({ id_evento: uuid(++identity) }); },
    startDemo(id) { calls.push(['start', id]); return Promise.resolve({ id_ejecucion: uuid(100) }); },
    stopDemo(id) { calls.push(['cancel', id]); return Promise.resolve({ detenido: true }); },
    demoStatus(id) { calls.push(['status', id]); return Promise.resolve({ corriendo: true }); },
    ...overrides,
  };
  const changes = [];
  const coordinator = new ControlCoordinator(api, { onChange: state => changes.push(state) });
  coordinator.configure(catalog);
  coordinator.setReady(true);
  return { coordinator, api, calls, changes };
}

test('STOP is urgent, drops queued direction, and compensates after an older POST settles', async () => {
  const old = deferred();
  const { coordinator, api, calls } = fixture();
  const normal = api.manual;
  api.manual = id => {
    if (id === forward.id_comando) { calls.push(['manual', id]); return old.promise; }
    return normal(id);
  };
  assert.equal(coordinator.move(forward), true);
  assert.equal(coordinator.move(backward), true);
  const stopping = coordinator.stop();
  assert.deepEqual(calls, [['manual', 10], ['manual', 99]]);
  assert.equal(coordinator.snapshot().mode, 'stopping');
  assert.equal(coordinator.snapshot().action.name, 'DETENER');
  assert.equal(coordinator.move(backward), false);
  old.resolve({ id_evento: uuid(7) });
  await stopping;
  assert.deepEqual(calls, [['manual', 10], ['manual', 99], ['manual', 99]]);
  assert.equal(coordinator.snapshot().mode, 'idle');
  assert.equal(coordinator.snapshot().action.name, 'DETENER');
  assert.equal(coordinator.snapshot().action.accepted, true);
  assert.equal(coordinator.pending, null);
});

test('simultaneous STOP gestures share one operation', async () => {
  const result = deferred();
  let calls = 0;
  const { coordinator } = fixture({ manual() { ++calls; return result.promise; } });
  const first = coordinator.stop();
  const second = coordinator.stop();
  assert.strictEqual(first, second);
  assert.equal(calls, 1);
  result.resolve({ id_evento: uuid(1) });
  await first;
  assert.equal(coordinator.snapshot().mode, 'idle');
});

test('WS before HTTP is retained and correlated only with the actual response UUID', async () => {
  const response = deferred();
  const { coordinator } = fixture({ manual: () => response.promise });
  coordinator.move(forward);
  coordinator.observe({ tipo: 'estado', origen: 'MANUAL', id_evento: uuid(23) });
  assert.equal(coordinator.snapshot().action.received, false);
  response.resolve({ id_evento: uuid(23) });
  await tick();
  assert.equal(coordinator.snapshot().action.accepted, true);
  assert.equal(coordinator.snapshot().action.received, true);
  assert.equal(coordinator.snapshot().action.name, 'AVANZAR');
});

test('a DEMO command before HTTP202 is buffered and confirmed by the matching execution ID', async () => {
  const response = deferred();
  const { coordinator } = fixture({ startDemo: () => response.promise });
  const starting = coordinator.startDemo(7);
  coordinator.observe({ tipo: 'inicio', id_demo: 7, id_ejecucion: uuid(100), total_movimientos: 1 });
  coordinator.observe({ tipo: 'comando', id_demo: 7, id_ejecucion: uuid(100), orden: 1, nombre: 'AVANZAR' });
  assert.equal(coordinator.snapshot().mode, 'demo-starting');
  assert.equal(coordinator.snapshot().action.accepted, false);
  assert.equal(coordinator.snapshot().action.received, false);
  response.resolve({ id_ejecucion: uuid(100) });
  assert.equal(await starting, true);
  assert.equal(coordinator.snapshot().mode, 'demo');
  assert.equal(coordinator.snapshot().action.accepted, true);
  assert.equal(coordinator.snapshot().action.received, true);
});

test('a matching DEMO fin before HTTP202 remains finished even when another execution emits an event', async () => {
  const response = deferred();
  const { coordinator } = fixture({ startDemo: () => response.promise });
  const starting = coordinator.startDemo(7);
  coordinator.observe({ tipo: 'fin', id_demo: 7, id_ejecucion: uuid(100) });
  coordinator.observe({ tipo: 'comando', id_demo: 7, id_ejecucion: uuid(200), orden: 1, nombre: 'RETROCEDER' });
  assert.equal(coordinator.snapshot().mode, 'demo-starting');
  response.resolve({ id_ejecucion: uuid(100) });
  assert.equal(await starting, true);
  assert.equal(coordinator.snapshot().mode, 'idle');
  assert.equal(coordinator.snapshot().action.accepted, true);
  assert.equal(coordinator.snapshot().action.received, true);
  assert.equal(coordinator.snapshot().demoId, null);
  coordinator.observe({ tipo: 'comando', id_demo: 7, id_ejecucion: uuid(100), orden: 1, nombre: 'AVANZAR' });
  assert.equal(coordinator.snapshot().mode, 'idle');
});

test('a rejected movement remains uncertain and a failed STOP does not declare success', async () => {
  const { coordinator } = fixture({ manual: () => Promise.reject(new Error('Offline')) });
  coordinator.move(forward);
  await tick();
  assert.equal(coordinator.snapshot().mode, 'uncertain');
  assert.equal(coordinator.move(backward), false);
  await coordinator.stop();
  assert.equal(coordinator.snapshot().mode, 'uncertain');
  assert.equal(coordinator.snapshot().action.accepted, false);
});

test('unknown or not-ready controls do not issue POSTs', async () => {
  const { coordinator, calls } = fixture();
  coordinator.setReady(false);
  assert.equal(coordinator.move(forward), false);
  assert.equal(await coordinator.startDemo(7), false);
  coordinator.setReady(true);
  assert.equal(coordinator.move({ id_comando: 500, nombre: 'INVENTADO' }), false);
  assert.deepEqual(calls, []);
});

test('double start creates one DEMO request; manual commands stay blocked', async () => {
  const start = deferred();
  let starts = 0;
  const { coordinator } = fixture({ startDemo() { ++starts; return start.promise; } });
  const first = coordinator.startDemo(7);
  assert.equal(await coordinator.startDemo(7), false);
  assert.equal(starts, 1);
  assert.equal(coordinator.move(forward), false);
  start.resolve({ id_ejecucion: uuid(100) });
  assert.equal(await first, true);
  assert.equal(coordinator.snapshot().mode, 'demo');
});

test('late accepted DEMO after STOP is cancelled again and cannot restore running UI', async () => {
  const start = deferred();
  const { coordinator, api, calls } = fixture();
  api.startDemo = id => { calls.push(['start', id]); return start.promise; };
  const starting = coordinator.startDemo(7);
  const stopping = coordinator.stop();
  assert.deepEqual(calls, [['start', 7], ['cancel', 7], ['manual', 99]]);
  start.resolve({ id_ejecucion: uuid(100) });
  assert.equal(await starting, false);
  await stopping;
  assert.deepEqual(calls, [['start', 7], ['cancel', 7], ['manual', 99], ['cancel', 7], ['manual', 99]]);
  coordinator.observe({ tipo: 'inicio', id_demo: 7, id_ejecucion: uuid(100) });
  assert.equal(coordinator.snapshot().mode, 'idle');
  assert.equal(coordinator.snapshot().action.name, 'DETENER');
});

test('HTTP409 checks the existing DEMO rather than assuming it is inactive', async () => {
  const conflict = Object.assign(new Error('Already running'), { status: 409 });
  const { coordinator, calls } = fixture({ startDemo: () => Promise.reject(conflict) });
  assert.equal(await coordinator.startDemo(7), false);
  assert.deepEqual(calls, [['status', 7]]);
  assert.equal(coordinator.snapshot().mode, 'demo');
});

test('a failed DEMO status lookup from before STOP cannot overwrite the newer idle state', async () => {
  const status = deferred();
  const conflict = Object.assign(new Error('Already running'), { status: 409 });
  const { coordinator } = fixture({
    startDemo: () => Promise.reject(conflict),
    demoStatus: () => status.promise,
  });
  const starting = coordinator.startDemo(7);
  await tick();
  await coordinator.stop();
  assert.equal(coordinator.snapshot().mode, 'idle');
  status.reject(new Error('Late network failure'));
  await starting;
  assert.equal(coordinator.snapshot().mode, 'idle');
  assert.equal(coordinator.snapshot().action.name, 'DETENER');
});

test('a completed DEMO cannot be reactivated by a late command of the same execution', async () => {
  const { coordinator } = fixture();
  await coordinator.startDemo(7);
  coordinator.observe({ tipo: 'fin', id_demo: 7, id_ejecucion: uuid(100) });
  assert.equal(coordinator.snapshot().mode, 'idle');
  coordinator.observe({ tipo: 'comando', id_demo: 7, id_ejecucion: uuid(100), orden: 1, nombre: 'AVANZAR' });
  assert.equal(coordinator.snapshot().mode, 'idle');
});

test('a different execution ID does not finish the current DEMO', async () => {
  const { coordinator } = fixture();
  await coordinator.startDemo(7);
  coordinator.observe({ tipo: 'fin', id_demo: 7, id_ejecucion: uuid(101) });
  assert.equal(coordinator.snapshot().mode, 'demo');
});
