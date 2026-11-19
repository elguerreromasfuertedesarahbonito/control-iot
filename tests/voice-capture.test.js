import test from 'node:test';
import assert from 'node:assert/strict';
import { createRecordedRecognition } from '../assets/js/chatbot/voice-capture.js';

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

function fixture({ transcribe, permission, maxBytes, formats = ['audio/webm;codecs=opus'] } = {}) {
  const devices = [];
  const recorders = [];
  const events = [];
  const uploads = [];
  const track = { stops: 0, stop() { this.stops += 1; } };
  const stream = { getTracks: () => [track] };
  const mediaDevices = {
    getUserMedia(constraints) {
      devices.push(constraints);
      return permission ? permission() : Promise.resolve(stream);
    },
  };
  class Recorder {
    static isTypeSupported(type) { return formats.includes(type); }
    constructor(_stream, options) {
      this.options = options;
      this.mimeType = options.mimeType ?? 'audio/webm';
      this.state = 'inactive';
      this.stops = 0;
      recorders.push(this);
    }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.stops++; }
    emit(value, type = this.mimeType) { this.ondataavailable?.({ data: new Blob([value], { type }) }); }
    end() { this.state = 'inactive'; this.onstop?.(); }
  }
  const Recognition = createRecordedRecognition({ mediaDevices, MediaRecorderImpl: Recorder, maxBytes,
    async transcribe(blob, options) {
      uploads.push({ blob, ...options, micClosed: track.stops > 0 });
      return transcribe ? transcribe(blob, options) : '  avanza  ';
    },
  });
  const recognition = new Recognition();
  recognition.onstart = () => events.push('start');
  recognition.onerror = event => events.push(event.error);
  recognition.onresult = event => {
    assert.equal(event.resultIndex, 0);
    assert.equal(event.results.length, 1);
    assert.equal(event.results[0].isFinal, true);
    events.push(event.results[0][0].transcript);
  };
  recognition.onend = () => events.push('end');
  return { recognition, devices, recorders, events, uploads, track, stream };
}

test('el respaldo solicita audio solo al iniciar y envía un único resultado final tras soltar', async () => {
  const f = fixture();
  assert.deepEqual(f.devices, []);
  assert.ok(f.recognition.constructor.endTimeoutMs > 2000);
  f.recognition.lang = 'es-MX';
  f.recognition.start();
  f.recognition.start();
  assert.deepEqual(f.devices, [{ audio: true, video: false }]);
  await flush();
  const recorder = f.recorders[0];
  assert.match(recorder.options.mimeType, /^audio\/webm/);
  recorder.emit('uno');
  assert.deepEqual(f.events, ['start']);
  assert.deepEqual(f.uploads, []);
  f.recognition.stop();
  f.recognition.stop();
  assert.equal(recorder.stops, 1);
  assert.equal(f.track.stops, 1);
  recorder.emit('dos');
  recorder.end();
  recorder.end();
  await flush();
  assert.deepEqual(f.events, ['start', 'avanza', 'end']);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.uploads[0].language, 'es-MX');
  assert.equal(f.uploads[0].micClosed, true);
  assert.equal(f.uploads[0].blob.type, 'audio/webm');
  assert.equal(await f.uploads[0].blob.text(), 'unodos');
});

test('al liberar mientras se espera permiso, se apaga cualquier micrófono autorizado tarde', async () => {
  const permission = deferred();
  const f = fixture({ permission: () => permission.promise });
  f.recognition.start();
  f.recognition.stop();
  permission.resolve(f.stream);
  await flush();
  assert.deepEqual(f.events, ['no-speech', 'end']);
  assert.equal(f.track.stops, 1);
  assert.deepEqual(f.recorders, []);
  assert.deepEqual(f.uploads, []);
});

test('descartar durante la transcripción aborta la petición e ignora una respuesta tardía', async () => {
  const reply = deferred();
  const f = fixture({ transcribe: () => reply.promise });
  f.recognition.start();
  await flush();
  const recorder = f.recorders[0];
  recorder.emit('audio');
  f.recognition.stop();
  recorder.end();
  assert.equal(f.uploads.length, 1);
  assert.equal(f.uploads[0].signal.aborted, false);
  f.recognition.abort();
  reply.resolve('avanza');
  await flush();
  assert.deepEqual(f.events, ['start', 'end']);
  assert.equal(f.uploads[0].signal.aborted, true);
  assert.equal(f.track.stops, 1);
});

test('denegar permisos comunica el error de micrófono sin enviar audio', async () => {
  const f = fixture({ permission: async () => { throw Object.assign(new Error(), { name: 'NotAllowedError' }); } });
  f.recognition.start();
  await flush();
  assert.deepEqual(f.events, ['not-allowed', 'end']);
  assert.deepEqual(f.uploads, []);
});

test('se descarta una grabación que supera el límite o cambia de formato', async () => {
  for (const [value, type, code] of [['largo', 'audio/webm', 'audio-too-large'], ['u', 'video/webm', 'audio-format']]) {
    const f = fixture({ maxBytes: 4 });
    f.recognition.start();
    await flush();
    f.recorders[0].emit(value, type);
    f.recorders[0].end();
    assert.deepEqual(f.events, ['start', code, 'end']);
    assert.deepEqual(f.uploads, []);
    assert.equal(f.track.stops, 1);
  }
});

test('la desconexión del micrófono antes de soltar no envía audio ni una orden', async () => {
  const f = fixture();
  f.recognition.start();
  await flush();
  f.recorders[0].emit('audio');
  f.recorders[0].end();
  assert.deepEqual(f.events, ['start', 'audio-capture', 'end']);
  assert.deepEqual(f.uploads, []);
  assert.equal(f.track.stops, 1);
});

test('el formato MP4 admitido por el navegador se conserva al enviar el audio', async () => {
  const f = fixture({ formats: ['audio/mp4'] });
  f.recognition.start();
  await flush();
  const recorder = f.recorders[0];
  assert.equal(recorder.options.mimeType, 'audio/mp4');
  recorder.emit('audio', 'audio/mp4;codecs=mp4a.40.2');
  f.recognition.stop();
  recorder.end();
  await flush();
  assert.equal(f.uploads[0].blob.type, 'audio/mp4');
  assert.deepEqual(f.events, ['start', 'avanza', 'end']);
});

test('una respuesta vacía o un error del proveedor nunca se publica como orden', async () => {
  for (const [transcribe, code] of [[async () => ' ', 'no-speech'], [async () => { throw new Error('proveedor'); }, 'transcription-unavailable']]) {
    const f = fixture({ transcribe });
    f.recognition.start();
    await flush();
    f.recorders[0].emit('audio');
    f.recognition.stop();
    f.recorders[0].end();
    await flush();
    assert.deepEqual(f.events, ['start', code, 'end']);
    assert.equal(f.track.stops, 1);
  }
});

test('una ruta antigua, cuota agotada o audio rechazado produce un error específico sin reintento', async () => {
  const errors = [[404, 'transcription-not-installed'], [413, 'audio-too-large'],
    [415, 'audio-format'], [429, 'transcription-rate-limit']];
  for (const [status, code] of errors) {
    const f = fixture({ transcribe: async () => { throw Object.assign(new Error('API'), { status }); } });
    f.recognition.start();
    await flush();
    f.recorders[0].emit('audio');
    f.recognition.stop();
    f.recorders[0].end();
    await flush();
    assert.deepEqual(f.events, ['start', code, 'end']);
    assert.equal(f.uploads.length, 1);
  }
});

test('si faltan APIs de captura o transcripción, el respaldo se declara no disponible', () => {
  assert.equal(createRecordedRecognition({ mediaDevices: null }), null);
  assert.equal(createRecordedRecognition({ MediaRecorderImpl: null, transcribe: async () => '' }), null);
});
