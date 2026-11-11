import test from 'node:test';
import assert from 'node:assert/strict';
import { directionFromVector, VirtualJoystick } from '../assets/js/joystick.js';
import { ManualInput } from '../assets/js/manual-input.js';

class Element {
  constructor(focusState = { current: null }) {
    this.listeners = new Map(); this.dataset = {}; this.captured = new Set();
    this.focusState = focusState;
  }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) {
    this.captured.delete(id);
    this.dispatch('lostpointercapture', { pointerId: id });
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: 200, height: 200 }; }
  focus() {
    const previous = this.focusState.current;
    if (previous === this) return;
    this.focusState.current = this;
    previous?.dispatch('blur');
  }
  dispatch(type, data = {}) {
    this.listeners.get(type)?.({ preventDefault() {}, pointerType: 'touch', button: 0, ...data });
  }
}

function fixture(enabled = () => true, focusState, callbacks = {}) {
  const element = new Element(focusState);
  const stick = { style: {} };
  const directions = [];
  let releases = 0;
  const joystick = new VirtualJoystick(element, stick, {
    onDirection: value => { directions.push(value); callbacks.onDirection?.(value); },
    onRelease: () => { ++releases; callbacks.onRelease?.(); },
    enabled,
  });
  return { element, stick, directions, joystick, releases: () => releases };
}

test('vector maps the four directions and uses different enter/leave neutral thresholds', () => {
  assert.equal(directionFromVector(0, -50, 100), 'forward');
  assert.equal(directionFromVector(0, 50, 100), 'backward');
  assert.equal(directionFromVector(-50, 0, 100), 'left');
  assert.equal(directionFromVector(50, 0, 100), 'right');
  assert.equal(directionFromVector(24, 0, 100), null);
  assert.equal(directionFromVector(20, 0, 100, 'right'), 'right');
  assert.equal(directionFromVector(16, 0, 100, 'right'), null);
});

test('dragging pixels in the same direction emits a single command', () => {
  const { element, directions } = fixture();
  element.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 50 });
  element.dispatch('pointermove', { pointerId: 1, clientX: 101, clientY: 40 });
  element.dispatch('pointermove', { pointerId: 1, clientX: 102, clientY: 30 });
  assert.deepEqual(directions, ['forward']);
});

test('pointerup and synchronous lost capture produce one STOP and return to neutral', () => {
  const { element, stick, directions, releases } = fixture();
  element.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 50 });
  element.dispatch('pointerup', { pointerId: 1 });
  element.dispatch('lostpointercapture', { pointerId: 1 });
  assert.deepEqual(directions, ['forward']);
  assert.equal(releases(), 1);
  assert.equal(element.dataset.direction, 'neutral');
  assert.equal(stick.style.transform, 'translate(0px, 0px)');
});

test('returning to center and then releasing the pointer sends STOP only once', () => {
  const { element, directions, releases } = fixture();
  element.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 50 });
  element.dispatch('pointermove', { pointerId: 1, clientX: 100, clientY: 100 });
  assert.equal(releases(), 1);
  element.dispatch('pointerup', { pointerId: 1 });
  assert.deepEqual(directions, ['forward']);
  assert.equal(releases(), 1);
});

test('another finger cannot steal the gesture; cancellation releases it once', () => {
  const { element, directions, releases } = fixture();
  element.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 50 });
  element.dispatch('pointerdown', { pointerId: 2, clientX: 160, clientY: 100 });
  element.dispatch('pointermove', { pointerId: 2, clientX: 160, clientY: 100 });
  element.dispatch('pointerup', { pointerId: 2 });
  assert.deepEqual(directions, ['forward']);
  assert.equal(releases(), 0);
  element.dispatch('pointercancel', { pointerId: 1 });
  assert.equal(releases(), 1);
});

test('disabled joystick never captures or sends a command', () => {
  const { element, directions, releases } = fixture(() => false);
  element.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 30 });
  element.dispatch('keydown', { key: 'ArrowUp' });
  assert.deepEqual(directions, []);
  assert.equal(releases(), 0);
  assert.equal(element.captured.size, 0);
});

test('keyboard auto-repeat is suppressed and keyup/blur release once', () => {
  const { element, directions, releases } = fixture();
  element.dispatch('keydown', { key: 'ArrowRight', repeat: false });
  element.dispatch('keydown', { key: 'ArrowRight', repeat: true });
  element.dispatch('keyup', { key: 'ArrowRight' });
  element.dispatch('blur');
  assert.deepEqual(directions, ['right']);
  assert.equal(releases(), 1);
});

test('focusing a second joystick does not cancel a captured touch on the first', () => {
  const focusState = { current: null };
  const first = fixture(() => true, focusState);
  const second = fixture(() => true, focusState);
  first.element.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 40 });
  second.element.dispatch('pointerdown', { pointerId: 2, clientX: 160, clientY: 100 });
  assert.equal(first.element.captured.has(1), true);
  assert.equal(second.element.captured.has(2), true);
  assert.equal(first.releases(), 0);
  assert.deepEqual(second.directions, ['right']);
  first.element.dispatch('pointerup', { pointerId: 1 });
  assert.equal(first.releases(), 1);
  assert.equal(second.releases(), 0);
  second.element.dispatch('pointercancel', { pointerId: 2 });
  assert.equal(second.releases(), 1);
});

test('a touch takes ownership before focus releases the keyboard on another joystick', () => {
  const focusState = { current: null };
  const commands = [];
  let stops = 0;
  const input = new ManualInput({
    move(command) { commands.push(command); return true; },
    stop() { ++stops; },
  });
  const keyboard = fixture(() => true, focusState, {
    onDirection: direction => input.request('keyboard', direction),
    onRelease: () => input.release('keyboard'),
  });
  const touch = fixture(() => true, focusState, {
    onDirection: direction => input.request('touch', direction),
    onRelease: () => input.release('touch'),
  });
  input.register('keyboard', () => keyboard.joystick.release(false));
  input.register('touch', () => touch.joystick.release(false));
  keyboard.element.focus();
  keyboard.element.dispatch('keydown', { key: 'ArrowUp' });
  touch.element.dispatch('pointerdown', { pointerId: 2, clientX: 160, clientY: 100 });
  assert.deepEqual(commands, ['forward', 'right']);
  assert.equal(stops, 0);
  assert.equal(keyboard.joystick.key, null);
  keyboard.element.dispatch('keyup', { key: 'ArrowUp' });
  assert.equal(stops, 0);
  touch.element.dispatch('pointerup', { pointerId: 2 });
  assert.equal(stops, 1);
});

test('keyboard input cannot replace an active captured pointer in the same joystick', () => {
  const { element, directions, releases } = fixture();
  element.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 40 });
  element.dispatch('keydown', { key: 'ArrowRight' });
  element.dispatch('keyup', { key: 'ArrowRight' });
  assert.deepEqual(directions, ['forward']);
  assert.equal(element.captured.has(1), true);
  assert.equal(releases(), 0);
  element.dispatch('pointerup', { pointerId: 1 });
  assert.equal(releases(), 1);
});

test('touch input cannot replace a held keyboard direction and blur releases that key once', () => {
  const { element, directions, releases } = fixture();
  element.focus();
  element.dispatch('keydown', { key: 'ArrowLeft' });
  element.dispatch('pointerdown', { pointerId: 1, clientX: 100, clientY: 40 });
  assert.deepEqual(directions, ['left']);
  assert.equal(element.captured.size, 0);
  element.dispatch('blur');
  element.dispatch('keyup', { key: 'ArrowLeft' });
  assert.equal(releases(), 1);
});
