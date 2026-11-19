import test from 'node:test';
import assert from 'node:assert/strict';
import { AssistantPulse } from '../assets/js/chatbot/pulse.js';
import { ManualInput } from '../assets/js/manual-input.js';
import { ControlCoordinator } from '../assets/js/coordinator.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const travel = { id_comando: 42, nombre: 'AVANZAR' };
const tool = { id_comando: 73, nombre: 'SUBIR_BRAZO' };
const halt = { id_comando: 9, nombre: 'DETENER' };

class Timers {
  time = 0;
  serial = 0;
  jobs = new Map();
  callbacks = new Map();
  set = (callback, delay) => {
    const id = ++this.serial;
    this.jobs.set(id, { at: this.time + delay, callback });
    this.callbacks.set(id, callback);
    return id;
  };
  clear = id => this.jobs.delete(id);
  advance(duration) {
    this.time += duration;
    for (const [id, job] of [...this.jobs]) if (job.at <= this.time) {
      this.jobs.delete(id); void job.callback();
    }
  }
}

function fixture({ accept = true, manual } = {}) {
  const calls = [];
  const api = { manual(id) {
    calls.push(id);
    return manual ? manual(id) : Promise.resolve({ id_evento: `event-${calls.length}` });
  } };
  const coordinator = new ControlCoordinator(api);
  coordinator.configure({ directions: { stop: halt }, byId: new Map([travel, tool, halt].map(command => [command.id_comando, command])) });
  coordinator.setReady(accept);
  const input = new ManualInput({ move: command => coordinator.move(command), stop: () => { void coordinator.stop(); } });
  const timers = new Timers();
  const pulse = new AssistantPulse(input, coordinator, { setTimer: timers.set, clearTimer: timers.clear });
  input.register('joystick', () => {});
  return { pulse, input, coordinator, timers, calls };
}

test('un pulso dura hasta 1000 ms y su liberación envía un solo STOP de catálogo', async () => {
  const f = fixture(); const task = f.pulse.start(travel, 1000);
  await flush(); assert.deepEqual(f.calls, [42]);
  assert.strictEqual(f.input.owner, f.pulse.source);
  f.timers.advance(999); await flush(); assert.deepEqual(f.calls, [42]);
  f.timers.advance(1);
  assert.deepEqual(await task, { interrupted: false, stopped: true });
  assert.deepEqual(f.calls, [42, 9]);
  assert.equal(f.input.owner, null);
  assert.equal(f.coordinator.mode, 'idle');
  assert.equal(f.timers.jobs.size, 0);
  f.pulse.destroy();
});

test('duraciones fuera de 1–1000 ms se rechazan antes de mover o adquirir propiedad', () => {
  const f = fixture();
  for (const duration of [0, -1, 1001, 1.5, NaN, '1000']) assert.throws(() => f.pulse.start(travel, duration), /máximo un segundo/);
  assert.deepEqual(f.calls, []); assert.equal(f.input.owner, null); assert.equal(f.timers.jobs.size, 0);
  f.pulse.destroy();
});

test('un control no disponible rechaza el pulso sin instalar temporizador', () => {
  const f = fixture({ accept: false });
  assert.throws(() => f.pulse.start(travel, 1000), /control no está disponible/);
  assert.deepEqual(f.calls, []); assert.equal(f.timers.jobs.size, 0);
  f.pulse.destroy();
});

test('el joystick nuevo adquiere propiedad y un callback cancelado del asistente no lo detiene', async () => {
  const f = fixture(); const old = f.pulse.start(travel, 1000); const timer = f.pulse.timer;
  await flush();
  assert.equal(f.input.request('joystick', tool), true);
  assert.deepEqual(await old, { interrupted: true });
  await f.timers.callbacks.get(timer)(); await flush();
  assert.strictEqual(f.input.owner, 'joystick');
  assert.deepEqual(f.calls, [42, 73]);
  assert.equal(f.coordinator.mode, 'manual');
  await f.pulse.stop(); assert.deepEqual(f.calls, [42, 73], 'cerrar el chat no detiene el joystick ajeno');
  f.input.release('joystick'); await f.coordinator.stop();
  assert.deepEqual(f.calls, [42, 73, 9]);
  f.pulse.destroy();
});

test('otro pulso sustituye el anterior y un temporizador viejo no corta el segundo', async () => {
  const f = fixture(); const first = f.pulse.start(travel, 1000); const oldTimer = f.pulse.timer;
  await flush(); f.timers.advance(500);
  const second = f.pulse.start(tool, 1000);
  assert.deepEqual(await first, { interrupted: true });
  await f.timers.callbacks.get(oldTimer)(); await flush();
  assert.deepEqual(f.calls, [42, 73]);
  f.timers.advance(999); await flush(); assert.deepEqual(f.calls, [42, 73]);
  f.timers.advance(1);
  assert.deepEqual(await second, { interrupted: false, stopped: true });
  assert.deepEqual(f.calls, [42, 73, 9]);
  f.pulse.destroy();
});

test('una parada explícita resuelve la espera y su callback tardío no vuelve a parar', async () => {
  const f = fixture(); const task = f.pulse.start(travel, 1000); const timer = f.pulse.timer;
  await flush(); await f.pulse.stop();
  assert.deepEqual(await task, { interrupted: true });
  await f.timers.callbacks.get(timer)(); await f.pulse.stop();
  assert.deepEqual(f.calls, [42, 9]);
  assert.equal(f.input.owner, null); assert.equal(f.timers.jobs.size, 0);
  f.pulse.destroy();
});

test('una orden manual aún en vuelo recibe STOP inmediato y otro final al terminar la vieja', async () => {
  const moving = deferred();
  const f = fixture({ manual: id => id === 42 ? moving.promise : Promise.resolve({ id_evento: 'stop-event' }) });
  const task = f.pulse.start(travel, 1000);
  f.timers.advance(1000); await flush();
  assert.deepEqual(f.calls, [42, 9]);
  assert.equal(f.coordinator.mode, 'stopping');
  moving.resolve({ id_evento: 'movement-event' });
  assert.deepEqual(await task, { interrupted: false, stopped: true });
  assert.deepEqual(f.calls, [42, 9, 9]);
  f.pulse.destroy();
});

test('un STOP rechazado nunca se anuncia como pulso finalizado con parada confirmada', async () => {
  const f = fixture({ manual: id => id === 9 ? Promise.reject(new Error('STOP rechazado')) : Promise.resolve({ id_evento: 'movement-event' }) });
  const task = f.pulse.start(travel, 1000); await flush();
  f.timers.advance(1000);
  assert.deepEqual(await task, { interrupted: false, stopped: false });
  assert.equal(f.coordinator.mode, 'uncertain');
  assert.deepEqual(f.calls, [42, 9]);
  f.pulse.destroy();
});

test('destroy invalida callbacks cancelados y elimina su registro sin afectar al joystick nuevo', async () => {
  const f = fixture(); const task = f.pulse.start(travel, 1000); const timer = f.pulse.timer;
  await flush(); f.input.request('joystick', tool); await flush();
  f.pulse.destroy();
  assert.deepEqual(await task, { interrupted: true });
  await f.timers.callbacks.get(timer)();
  assert.strictEqual(f.input.owner, 'joystick');
  assert.equal(f.input.resets.has(f.pulse.source), false);
  assert.deepEqual(f.calls, [42, 73]);
  f.input.release('joystick'); await f.coordinator.stop();
});
