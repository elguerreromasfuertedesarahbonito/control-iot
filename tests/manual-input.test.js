import test from 'node:test';
import assert from 'node:assert/strict';
import { ManualInput } from '../assets/js/manual-input.js';

const travel = { id_comando: 10, nombre: 'AVANZAR' };
const arm = { id_comando: 35, nombre: 'SUBIR_BRAZO' };

function fixture(move = () => true) {
  const commands = [];
  let stops = 0;
  const input = new ManualInput({
    move(command) { commands.push(command); return move(command); },
    stop() { ++stops; },
  });
  return { input, commands, stops: () => stops };
}

test('a newer joystick resets the previous gesture and its late release cannot stop the owner', () => {
  const { input, commands, stops } = fixture();
  const resets = [];
  input.register('travel', () => resets.push('travel'));
  input.register('tool', () => resets.push('tool'));

  assert.equal(input.request('travel', travel), true);
  assert.equal(input.request('tool', arm), true);
  assert.deepEqual(commands, [travel, arm]);
  assert.deepEqual(resets, ['tool', 'travel']);
  assert.equal(input.release('travel'), false);
  assert.equal(stops(), 0);
  assert.equal(input.release('tool'), true);
  assert.equal(input.release('tool'), false, 'pointerup plus lost capture stops once');
  assert.equal(stops(), 1);
  assert.equal(input.owner, null, 'an older held gesture is not resumed');
});

test('button and joystick sources share ownership, including resets that release an old capture', () => {
  const { input, stops } = fixture();
  const button = {};
  input.register(button, () => input.release(button));
  input.register('joystick', () => input.release('joystick'));

  input.request(button, travel);
  input.request('joystick', arm);
  assert.strictEqual(input.owner, 'joystick');
  assert.equal(stops(), 0, 'the new owner is installed before resetting other sources');
  assert.equal(input.release(button), false);
  assert.equal(input.release('joystick'), true);
  assert.equal(stops(), 1);
});

test('an absent or rejected command cannot steal the current gesture or reset its control', () => {
  const { input, commands, stops } = fixture(command => command !== arm);
  let travelResets = 0;
  input.register('travel', () => ++travelResets);
  input.request('travel', travel);

  assert.equal(input.request('tool', null), false);
  assert.equal(input.request('tool', arm), false);
  assert.deepEqual(commands, [travel, arm], 'missing commands never reach move');
  assert.equal(travelResets, 0);
  assert.equal(input.release('tool'), false);
  assert.equal(input.release('travel'), true);
  assert.equal(stops(), 1);
});

test('global neutral resets every source without issuing STOP and ignores delayed releases', () => {
  const { input, stops } = fixture();
  const resets = [];
  input.register('travel', () => { resets.push('travel'); input.release('travel'); });
  input.register('tool', () => { resets.push('tool'); input.release('tool'); });
  input.request('travel', travel);
  resets.length = 0;

  input.clear();
  assert.deepEqual(resets, ['travel', 'tool']);
  assert.equal(stops(), 0);
  assert.equal(input.release('travel'), false);
  assert.equal(input.release('tool'), false);
  input.request('tool', arm);
  assert.equal(input.release('travel'), false);
  assert.equal(stops(), 0);
  assert.equal(input.release('tool'), true);
  assert.equal(stops(), 1);
});

test('changing direction within the owning control keeps its gesture active', () => {
  const { input, commands, stops } = fixture();
  let resets = 0;
  input.register('travel', () => ++resets);
  input.request('travel', travel);
  input.request('travel', arm);
  assert.deepEqual(commands, [travel, arm]);
  assert.equal(resets, 0);
  assert.equal(stops(), 0);
  assert.equal(input.release('travel'), true);
  assert.equal(stops(), 1);
});

test('removing an auxiliary button discards its reset and ownership without stopping', () => {
  const { input, stops } = fixture();
  const removedButton = {};
  let resets = 0;
  input.register(removedButton, () => ++resets);
  input.request(removedButton, arm);
  input.unregister(removedButton);
  input.clear();
  input.request('travel', travel);
  assert.equal(resets, 0, 'reconnection must not keep resetting a removed DOM button');
  assert.equal(input.release(removedButton), false);
  assert.equal(stops(), 0);
  assert.equal(input.release('travel'), true);
  assert.equal(stops(), 1);
});
