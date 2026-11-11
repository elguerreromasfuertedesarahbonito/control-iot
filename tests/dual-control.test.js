import test from 'node:test';
import assert from 'node:assert/strict';
import { VirtualJoystick } from '../assets/js/joystick.js';
import { ManualInput } from '../assets/js/manual-input.js';
import { ControlCoordinator } from '../assets/js/coordinator.js';
import { buildCatalog } from '../assets/js/catalog.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const uuid = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;

class Element {
  constructor(focus) {
    this.focusState = focus;
    this.listeners = new Map();
    this.dataset = {};
    this.captured = new Set();
  }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  dispatch(type, values = {}) {
    this.listeners.get(type)?.({ preventDefault() {}, pointerType: 'touch', button: 0, ...values });
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 200 }; }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) {
    this.captured.delete(id);
    this.dispatch('lostpointercapture', { pointerId: id });
  }
  focus() {
    const previous = this.focusState.current;
    if (previous === this) return;
    this.focusState.current = this;
    previous?.dispatch('blur');
  }
}

test('two joystick gestures resolve catalog IDs and retain the latest action through focus and late events', async () => {
  const command = (id_comando, codigo, nombre) => ({ id_comando, codigo, nombre, id_vehiculo: 1, activo: true });
  // Deliberately different IDs and codes catch use of a physical code as an API ID.
  const catalog = buildCatalog([
    command(42, 104, 'AVANZAR'), command(73, 207, 'ABRIR_PALA'), command(9, 309, 'DETENER'),
  ], 1);
  const requests = [];
  const api = {
    manual(id) {
      let resolve;
      const promise = new Promise(done => { resolve = done; });
      requests.push({ id, eventId: uuid(requests.length + 1), resolve });
      return promise;
    },
  };
  const coordinator = new ControlCoordinator(api);
  coordinator.configure(catalog);
  coordinator.setReady(true);
  let stopping;
  const input = new ManualInput({
    move: value => coordinator.move(value),
    stop: () => { stopping = coordinator.stop(); },
  });
  const focus = { current: null };
  const createControl = group => {
    const element = new Element(focus);
    const control = new VirtualJoystick(element, { style: {} }, {
      enabled: () => coordinator.ready && ['idle', 'manual'].includes(coordinator.mode),
      onDirection: direction => input.request(element, catalog[group][direction]),
      onRelease: () => input.release(element),
    });
    input.register(element, () => control.release(false));
    return element;
  };
  const drive = createControl('directions');
  const tool = createControl('tools');
  const ids = () => requests.map(request => request.id);
  const observe = request => coordinator.observe({ tipo: 'estado', origen: 'MANUAL', id_evento: request.eventId });
  const accept = async request => { request.resolve({ id_evento: request.eventId }); await tick(); };

  drive.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 30 });
  await accept(requests[0]);
  assert.deepEqual(ids(), [42]);
  assert.equal(coordinator.snapshot().action.name, 'AVANZAR');
  assert.equal(coordinator.snapshot().action.accepted, true);

  tool.dispatch('pointerdown', { pointerId: 2, clientX: 30, clientY: 100 });
  assert.strictEqual(focus.current, tool, 'the second gesture moves focus and blurs the first');
  assert.deepEqual(ids(), [42, 73], 'tool left sends ABRIR_PALA from the catalog, without an intervening STOP');
  assert.equal(drive.dataset.direction, 'neutral');
  assert.equal(tool.dataset.direction, 'left');
  drive.dispatch('pointerup', { pointerId: 1 });
  drive.dispatch('lostpointercapture', { pointerId: 1 });
  drive.dispatch('pointermove', { pointerId: 1, clientX: 100, clientY: 180 });
  observe(requests[0]);
  assert.deepEqual(ids(), [42, 73], 'late events from the old finger do not stop or restart either control');
  assert.equal(coordinator.snapshot().action.name, 'ABRIR_PALA');
  assert.equal(coordinator.snapshot().action.accepted, false);
  assert.equal(coordinator.snapshot().action.received, false, 'the previous movement WS event cannot confirm the tool action');

  observe(requests[1]);
  await accept(requests[1]);
  assert.equal(coordinator.snapshot().action.accepted, true);
  assert.equal(coordinator.snapshot().action.received, true);
  tool.dispatch('pointerup', { pointerId: 2 });
  tool.dispatch('lostpointercapture', { pointerId: 2 });
  assert.deepEqual(ids(), [42, 73, 9], 'releasing the owning finger requests the catalog STOP exactly once');
  assert.equal(tool.dataset.direction, 'neutral');
  observe(requests[1]);
  assert.equal(coordinator.snapshot().action.name, 'DETENER');
  assert.equal(coordinator.snapshot().action.received, false);
  await accept(requests[2]);
  await stopping;
  assert.equal(coordinator.snapshot().mode, 'idle');
  assert.equal(coordinator.snapshot().action.name, 'DETENER');
  assert.equal(coordinator.snapshot().action.accepted, true);
  assert.deepEqual(ids(), [42, 73, 9]);
});
