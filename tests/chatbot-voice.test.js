import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceInput } from "../assets/js/chatbot/voice.js";

class Surface {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, detail = {}) {
    const event = { type, preventDefault() { this.defaultPrevented = true; }, ...detail };
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
    return event;
  }
  listenerCount() { return [...this.listeners.values()].reduce((sum, group) => sum + group.size, 0); }
}

class Clock extends Surface {
  time = 0;
  serial = 0;
  timers = new Map();
  performance = { now: () => this.time };
  setTimeout(callback, delay) {
    const id = ++this.serial;
    this.timers.set(id, { due: this.time + delay, callback });
    return id;
  }
  clearTimeout(id) { this.timers.delete(id); }
  tick(duration) {
    const target = this.time + duration;
    while (true) {
      const next = [...this.timers].filter(([, timer]) => timer.due <= target)
        .sort((a, b) => a[1].due - b[1].due)[0];
      if (!next) break;
      this.time = next[1].due;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.time = target;
  }
}

function fixture({ supported = true, startError = false } = {}) {
  const clock = new Clock();
  const document = new Surface();
  document.defaultView = clock;
  document.hidden = false;
  document.visibilityState = "visible";
  const button = new Surface();
  button.ownerDocument = document;
  button.dataset = {};
  button.attributes = new Map();
  button.setAttribute = (key, value) => button.attributes.set(key, value);
  button.captured = new Set();
  button.setPointerCapture = (id) => button.captured.add(id);
  button.hasPointerCapture = (id) => button.captured.has(id);
  button.releasePointerCapture = (id) => {
    button.captured.delete(id);
    button.emit("lostpointercapture", { pointerId: id });
  };
  const instances = [];
  class Recognition {
    constructor() { this.starts = 0; this.stops = 0; this.aborts = 0; instances.push(this); }
    start() {
      ++this.starts;
      if (startError) throw new Error("simulated start rejection");
      this.onstart?.();
    }
    stop() { ++this.stops; }
    abort() { ++this.aborts; }
    results(entries, index = 0) {
      this.onresult?.({ resultIndex: index, results: entries.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal })) });
    }
    end() { this.onend?.(); }
    error(code) { this.onerror?.({ error: code }); }
  }
  const transcripts = [], statuses = [], errors = [];
  const voice = createVoiceInput({
    button, Recognition: supported ? Recognition : null,
    onTranscript: (value) => transcripts.push(value),
    onStatus: (...value) => statuses.push(value), onError: (value) => errors.push(value),
  });
  const down = (id = 1) => button.emit("pointerdown", { pointerId: id, button: 0, isPrimary: true });
  const up = (id = 1) => button.emit("pointerup", { pointerId: id });
  const tap = () => { down(); clock.tick(40); up(); button.emit("click", { detail: 1 }); };
  return { voice, clock, document, button, instances, transcripts, statuses, errors, down, up, tap };
}

test("un toque empieza inmediatamente y mantiene la escucha hasta el segundo toque", () => {
  const f = fixture();
  assert.equal(f.instances.length, 0, "crear el módulo no pide micrófono");
  f.down();
  const r = f.instances[0];
  assert.equal(r.starts, 1);
  assert.equal(r.lang, "es-MX");
  assert.equal(r.continuous, true);
  assert.equal(r.interimResults, true);
  assert.equal(f.button.attributes.get("aria-pressed"), "true");
  f.clock.tick(279); f.up();
  assert.equal(r.stops, 0);
  f.button.emit("click", { detail: 1 });
  f.down(); f.up();
  assert.equal(r.stops, 1);
  assert.equal(f.instances.length, 1);
  assert.equal(f.button.dataset.voiceState, "processing");
  r.end();
  assert.equal(f.button.dataset.voiceState, "idle");
  assert.equal(f.button.attributes.get("aria-pressed"), "false");
  f.voice.destroy();
});

test("mantener 280 ms conserva las primeras palabras y detener espera finales tardíos", () => {
  const f = fixture();
  f.down();
  const r = f.instances[0];
  r.results([["avanzar", false]]);
  assert.deepEqual(f.transcripts, []);
  f.clock.tick(280); f.up();
  assert.equal(r.stops, 1);
  r.results([["Avanzar", true], ["despacio", true]]);
  assert.deepEqual(f.transcripts, []);
  r.end(); r.end();
  assert.deepEqual(f.transcripts, ["Avanzar despacio"]);
  assert.equal(f.clock.timers.size, 0);
  f.voice.destroy();
});

test("agrega finales por índice una sola vez y no envía resultados parciales", () => {
  const f = fixture(); f.tap();
  const r = f.instances[0];
  r.results([["subir", true], ["pal", false]]);
  r.results([["subir", true], ["pala", true]], 1);
  r.results([["subir", true], ["pala", true]], 0);
  r.end();
  assert.deepEqual(f.transcripts, ["subir pala"]);
  f.clock.tick(800); f.tap();
  f.instances[1].results([["esto es parcial", false]]);
  f.instances[1].end();
  assert.deepEqual(f.transcripts, ["subir pala"]);
  f.voice.destroy();
});

test("la transcripción normaliza espacios y limita el texto final a 1000 caracteres", () => {
  const f = fixture(); f.tap();
  f.instances[0].results([[`  avanzar\n\t${"a".repeat(1100)}`, true]]);
  f.instances[0].end();
  assert.equal(f.transcripts[0].length, 1000);
  assert.ok(f.transcripts[0].startsWith("avanzar a"));
  assert.ok(!f.transcripts[0].includes("\n"));
  f.voice.destroy();
});

test("Enter y Espacio alternan sin repetición ni doble click generado por teclado", () => {
  const f = fixture();
  f.button.emit("keydown", { key: "Enter", repeat: false });
  f.button.emit("keydown", { key: "Enter", repeat: true });
  f.button.emit("keydown", { key: "Enter", repeat: false });
  f.button.emit("click", { detail: 0 });
  f.button.emit("keyup", { key: "Enter" });
  f.button.emit("click", { detail: 0 });
  assert.equal(f.instances.length, 1);
  assert.equal(f.instances[0].stops, 0);
  f.clock.tick(701);
  f.button.emit("keydown", { key: " ", repeat: false });
  assert.equal(f.instances[0].stops, 1);
  f.button.emit("keyup", { key: " " });
  f.instances[0].end();
  f.voice.destroy();
});

test("click asistido sin pointer permite alternar y no reinicia mientras procesa", () => {
  const f = fixture();
  f.button.emit("click", { detail: 0 });
  f.button.emit("click", { detail: 0 });
  f.button.emit("click", { detail: 0 });
  assert.equal(f.instances.length, 1);
  assert.equal(f.instances[0].stops, 1);
  f.instances[0].end();
  f.button.emit("click", { detail: 0 });
  assert.equal(f.instances.length, 2);
  f.voice.destroy();
});

test("permiso denegado y otros errores descartan texto final y no reinician", () => {
  const f = fixture(); f.tap();
  const r = f.instances[0];
  r.results([["avanzar", true]]);
  const oldEnd = r.onend;
  r.error("not-allowed"); oldEnd();
  f.clock.tick(40000);
  assert.deepEqual(f.transcripts, []);
  assert.equal(f.errors.length, 1);
  assert.equal(f.errors[0].code, "not-allowed");
  assert.equal(r.aborts, 1);
  assert.equal(f.instances.length, 1);
  assert.equal(f.button.dataset.voiceState, "idle");
  f.voice.destroy();
});

for (const event of ["pointercancel", "lostpointercapture"]) {
  test(`${event} descarta y libera captura sin publicar`, () => {
    const f = fixture(); f.down();
    f.instances[0].results([["avanzar", true]]);
    f.button.emit(event, { pointerId: 1 });
    f.instances[0].end();
    assert.deepEqual(f.transcripts, []);
    assert.equal(f.instances[0].aborts, 1);
    assert.equal(f.button.captured.size, 0);
    assert.equal(f.clock.timers.size, 0);
    f.voice.destroy();
  });
}

for (const action of ["blur", "hidden", "escape", "external"]) {
  test(`${action} descarta una sesión incluida la espera del resultado final`, () => {
    const f = fixture(); f.tap();
    const r = f.instances[0]; r.results([["avanzar", true]]);
    f.voice.stop();
    if (action === "blur") f.clock.emit("blur");
    if (action === "hidden") { f.document.hidden = true; f.document.emit("visibilitychange"); }
    if (action === "escape") f.button.emit("keydown", { key: "Escape" });
    if (action === "external") f.voice.stop({ discard: true });
    r.end();
    assert.deepEqual(f.transcripts, []);
    assert.equal(r.aborts, 1);
    assert.equal(f.clock.timers.size, 0);
    f.voice.destroy();
  });
}

test("el límite de 30 segundos detiene la sesión y espera su último resultado", () => {
  const f = fixture(); f.tap();
  const r = f.instances[0];
  f.clock.tick(29959); assert.equal(r.stops, 0);
  f.clock.tick(1); assert.equal(r.stops, 1);
  r.results([["detener", true]]); r.end();
  assert.deepEqual(f.transcripts, ["detener"]);
  assert.equal(f.clock.timers.size, 0);
  f.voice.destroy();
});

test("un motor que nunca termina se aborta tras la espera y no envía", () => {
  const f = fixture(); f.tap();
  const r = f.instances[0]; r.results([["avanzar", true]]);
  f.voice.stop(); f.voice.stop();
  f.clock.tick(1999); assert.equal(r.aborts, 0);
  f.clock.tick(1); assert.equal(r.aborts, 1);
  assert.equal(r.stops, 1);
  assert.deepEqual(f.transcripts, []);
  assert.equal(f.errors[0].code, "end-timeout");
  assert.equal(f.clock.timers.size, 0);
  f.voice.destroy();
});

test("destroy elimina eventos, temporizadores y callbacks antiguos de manera idempotente", () => {
  const f = fixture(); f.tap();
  const r = f.instances[0], oldEnd = r.onend, oldResult = r.onresult;
  f.voice.destroy(); f.voice.destroy();
  oldResult({ results: [Object.assign([{ transcript: "avanzar" }], { isFinal: true })], resultIndex: 0 });
  oldEnd(); f.tap(); f.button.emit("click", { detail: 0 });
  assert.deepEqual(f.transcripts, []);
  assert.equal(r.aborts, 1);
  assert.equal(f.instances.length, 1);
  assert.equal(f.clock.timers.size, 0);
  assert.equal(f.button.listenerCount() + f.clock.listenerCount() + f.document.listenerCount(), 0);
});

test("sin soporte deshabilita el botón y explica la alternativa escrita", () => {
  const f = fixture({ supported: false });
  assert.equal(f.voice.supported, false);
  assert.equal(f.button.disabled, true);
  assert.match(f.button.title, /escribir/i);
  f.tap(); assert.equal(f.instances.length, 0);
  f.voice.destroy();
});

test("una excepción al iniciar limpia la sesión y los temporizadores", () => {
  const f = fixture({ startError: true }); f.tap();
  assert.equal(f.errors[0].code, "start-failed");
  assert.deepEqual(f.transcripts, []);
  assert.equal(f.clock.timers.size, 0);
  assert.equal(f.button.dataset.voiceState, "idle");
  f.voice.destroy();
});
