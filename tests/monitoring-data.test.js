import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBackendDateTime, isBackendDateTime, timestampOrderKey } from '../assets/js/date-time.js';
import { isStateResponse, isHistoryResponse, normalizeHistory } from '../assets/js/monitoring-validation.js';

const state = changes => ({ id_vehiculo: 1, vehiculo: 'Excavadora IoT', id_comando: 9,
  comando: 'DETENER', codigo: 9, conectado: true, fecha_actualizacion: '2026-11-11T23:33:01', ...changes });
const history = (id, changes = {}) => ({ id_historial: id, id_vehiculo: 1, comando: 'DETENER',
  codigo: 9, fecha_hora: '2026-11-11T23:33:01', origen: 'MANUAL', ...changes });

test('monitoring contracts accept real state/history and nullable LEFT JOIN fields without inventing command IDs', () => {
  assert.equal(isStateResponse(state()), true);
  assert.equal(isStateResponse(state({ id_comando: null, comando: null, codigo: null })), true);
  assert.equal(isHistoryResponse([history(537), history(538, { comando: null, codigo: null })]), true);
  assert.equal(isHistoryResponse([]), true);
  assert.equal('id_comando' in normalizeHistory([history(537)], 1)[0], false);
});

test('monitoring rejects missing fields, wrong scalar types, impossible dates and invalid response shapes', () => {
  for (const change of [{ id_vehiculo: '1' }, { id_comando: 0 }, { vehiculo: '' },
    { comando: 9 }, { codigo: '9' }, { conectado: 1 }, { fecha_actualizacion: '2026-02-30T23:33:01' }]) {
    assert.equal(isStateResponse(state(change)), false);
  }
  const missing = state(); delete missing.comando;
  assert.equal(isStateResponse(missing), false);
  for (const value of [null, {}, [history(0)], [history(1, { id_vehiculo: '1' })],
    [history(1, { origen: '' })], [history(1, { origen: 'x'.repeat(31) })],
    [history(1, { fecha_hora: '2026-11-11T24:00:00' })], [history(1, { codigo: undefined })]]) {
    assert.equal(isHistoryResponse(value), false);
    assert.throws(() => normalizeHistory(value, 1), TypeError);
  }
  assert.throws(() => normalizeHistory([], 0), TypeError);
  assert.throws(() => normalizeHistory([], 1, 0), TypeError);
});

test('history retains repeated commands, filters only vehicle, deduplicates persisted IDs and sorts ties by ID descending', () => {
  const input = [history(9, { origen: 'SEGURIDAD' }), history(10, { origen: 'WORKBENCH' }),
    history(12, { id_vehiculo: 2 }), history(10, { origen: 'WORKBENCH' }),
    history(11, { fecha_hora: '2026-11-11T23:33:02' }), history(12, { origen: 'APP_MOVIL' })];
  assert.equal(isHistoryResponse(input), true, 'a foreign vehicle is valid before filtering');
  const output = normalizeHistory(input, 1);
  assert.deepEqual(output.map(row => row.id_historial), [11, 12, 10, 9]);
  assert.deepEqual(output.map(row => row.origen), ['MANUAL', 'APP_MOVIL', 'WORKBENCH', 'SEGURIDAD']);
  assert.equal(output.filter(row => row.fecha_hora === '2026-11-11T23:33:01').length, 3);
});

test('history sorts unsorted copies before choosing at most ten and keeps remote strings as plain data', () => {
  const malicious = '<img src=x onerror=alert(1)>';
  const input = Array.from({ length: 14 }, (_, i) => history(i + 1, {
    fecha_hora: `2026-11-11T23:33:${String(i).padStart(2, '0')}`,
    comando: malicious, ignored: '<script>unused</script>',
  })).reverse();
  [input[1], input[10]] = [input[10], input[1]];
  const before = structuredClone(input);
  const output = normalizeHistory(input, 1, 50);
  assert.deepEqual(output.map(row => row.id_historial), [14, 13, 12, 11, 10, 9, 8, 7, 6, 5]);
  assert.deepEqual(input, before, 'sorting and normalization never mutate server data');
  assert.equal(output[0].comando, malicious, 'the renderer must use textContent');
  assert.equal('ignored' in output[0], false);
  assert.notStrictEqual(output[0], input.find(row => row.id_historial === 14));
  assert.equal(normalizeHistory(input, 1, 3).length, 3);
  assert.deepEqual(normalizeHistory(input, 2), []);
});

test('datetime validation rejects rollover and accepts Gregorian leap years, fractions and explicit offsets', () => {
  for (const value of ['2024-02-29T23:59:59', '2000-02-29T00:00:00Z', '0001-01-01T00:00:00',
    '2026-11-11T23:33:01.123456', '2026-11-11T17:33:01-06:00']) assert.equal(isBackendDateTime(value), true, value);
  for (const value of [null, '', '2026-11-11', '0000-01-01T00:00:00', '1900-02-29T00:00:00',
    '2026-02-30T00:00:00', '2026-13-01T00:00:00', '2026-11-00T00:00:00',
    '2026-11-11T24:00:00', '2026-11-11T23:60:00', '2026-11-11T23:59:60',
    '2026-11-11T23:33:01+24:00', '2026-11-11T23:33:01-06:60', '2026-11-11T23:33:01\n']) {
    assert.equal(isBackendDateTime(value), false, String(value));
    assert.equal(timestampOrderKey(value), null);
  }
});

test('unknown naive time preserves its original calendar values without invoking Date.parse', t => {
  t.mock.method(Date, 'parse', () => { throw new Error('Naive dates must not be parsed as local time'); });
  const iso = '2026-11-11T23:33:01.123456';
  assert.deepEqual(formatBackendDateTime(iso), { date: '11/11/2026', time: '23:33:01',
    zoneLabel: 'Zona del backend sin confirmar', iso });
  for (const value of [null, undefined, '2026-02-30T23:33:01']) {
    const output = formatBackendDateTime(value);
    assert.equal(output.date, '—'); assert.equal(output.time, '—');
  }
});

test('confirmed UTC and explicit ISO zones convert to Mexico, including date rollover and source-zone precedence', () => {
  const options = { sourceTimeZone: 'UTC', displayTimeZone: 'America/Mexico_City' };
  const result = formatBackendDateTime('2026-11-11T02:33:01', options);
  assert.deepEqual(result, { date: '10/11/2026', time: '20:33:01', zoneLabel: 'America/Mexico_City', iso: '2026-11-11T02:33:01' });
  assert.equal(formatBackendDateTime('2026-11-11T23:33:01', options).time, '17:33:01');
  assert.equal(formatBackendDateTime('2026-11-11T23:33:01Z', { sourceTimeZone: 'America/Mexico_City' }).time, '17:33:01');
  assert.equal(formatBackendDateTime('2026-11-11T17:33:01-06:00').time, '17:33:01');
  assert.equal(formatBackendDateTime('2026-11-11T23:33:01', { sourceTimeZone: 'America/Mexico_City' }).time, '23:33:01');
  assert.equal(formatBackendDateTime('2026-11-11T23:33:01', { sourceTimeZone: 'UTC', displayTimeZone: 'Invalid/Zone' }).time, '23:33:01');
  assert.equal(formatBackendDateTime('1969-12-31T23:59:59.999999Z', { displayTimeZone: 'UTC' }).time, '23:59:59');
});

test('UTC backend ordering compares naive, Z and offsets consistently and retains sub-millisecond precision', () => {
  const iso = '2026-11-11T23:33:01';
  assert.equal(timestampOrderKey(iso), timestampOrderKey(`${iso}Z`), 'MySQL naive values have confirmed UTC semantics');
  assert.equal(timestampOrderKey(iso), timestampOrderKey('2026-11-11T17:33:01-06:00'));
  assert.equal(timestampOrderKey('1970-01-01T00:00:00Z'), 0n);
  assert.equal(timestampOrderKey('0001-01-01T00:00:00'), -62_135_596_800_000_000_000n);
  assert.ok(timestampOrderKey('0001-01-01T00:00:00') < timestampOrderKey('0099-01-01T00:00:00'));
  const rows = [history(8, { fecha_hora: `${iso}.000001` }), history(9, { fecha_hora: `${iso}.000000Z` }),
    history(7, { fecha_hora: '2026-11-11T17:33:01.000002-06:00' })];
  assert.deepEqual(normalizeHistory(rows, 1).map(row => row.id_historial), [7, 8, 9]);
});
