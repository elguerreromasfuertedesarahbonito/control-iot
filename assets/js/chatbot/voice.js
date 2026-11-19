/** Entrada por voz del navegador. Solo una interacción explícita abre el micrófono. */
const MAX_SESSION_MS = 30000;
const END_TIMEOUT_MS = 2000;
const MAX_TRANSCRIPT = 1000;

const ERROR_MESSAGES = {
  "not-allowed": "No se autorizó el micrófono. Revisa los permisos del navegador.",
  "service-not-allowed": "El navegador no permite usar el reconocimiento de voz.",
  "audio-capture": "No se encontró un micrófono disponible.",
  "no-speech": "No se detectó voz. Puedes intentarlo de nuevo.",
  network: "El servicio de reconocimiento de voz no está disponible.",
  "language-not-supported": "El reconocimiento de voz no admite el idioma solicitado.",
  aborted: "Se canceló el reconocimiento de voz.",
};

const cleanText = (value) => String(value).replace(/\s+/g, " ").trim();

export function createVoiceInput({
  button,
  onTranscript = () => {},
  onStatus = () => {},
  onError = () => {},
  Recognition = globalThis.window?.SpeechRecognition ?? globalThis.window?.webkitSpeechRecognition,
  holdDelayMs = 280,
} = {}) {
  if (!button?.addEventListener || !button?.setAttribute) {
    throw new TypeError("La entrada por voz necesita un botón.");
  }
  const document = button.ownerDocument;
  const view = document?.defaultView ?? globalThis.window ?? globalThis;
  const setTimer = (callback, delay) => (view.setTimeout ?? globalThis.setTimeout).call(view, callback, delay);
  const clearTimer = (timer) => {
    if (timer !== null) (view.clearTimeout ?? globalThis.clearTimeout).call(view, timer);
  };
  const now = () => view.performance?.now?.() ?? Date.now();
  const holdDelay = Number.isFinite(holdDelayMs) && holdDelayMs >= 0 ? holdDelayMs : 280;
  const supported = typeof Recognition === "function";
  const listeners = [];
  const pressedKeys = new Set();
  let session = null;
  let pointer = null;
  let destroyed = false;
  let suppressClickUntil = -1;
  let phase = "idle";

  function notify(callback, ...args) {
    try { callback(...args); } catch { /* Un error de la vista no mantiene abierto el micrófono. */ }
  }

  function status(value, detail = {}) {
    phase = value;
    button.setAttribute("aria-pressed", String(value === "listening"));
    if (button.dataset) {
      button.dataset.listening = String(value === "listening");
      button.dataset.voiceState = value;
    }
    notify(onStatus, value, detail);
  }

  function releasePointer() {
    const previous = pointer;
    pointer = null;
    if (previous && button.hasPointerCapture?.(previous.id)) {
      try { button.releasePointerCapture(previous.id); } catch { /* El navegador pudo liberarla antes. */ }
    }
  }

  function finalText(current) {
    return cleanText([...current.final.entries()].sort(([a], [b]) => a - b)
      .map(([, value]) => value).join(" ")).slice(0, MAX_TRANSCRIPT).trim();
  }

  function finish(current, { discard = false, reason = "ended" } = {}) {
    if (session !== current) return;
    session = null;
    clearTimer(current.limitTimer);
    clearTimer(current.endTimer);
    releasePointer();
    current.recognition.onstart = null;
    current.recognition.onresult = null;
    current.recognition.onerror = null;
    current.recognition.onend = null;
    const transcript = discard || current.discard ? "" : finalText(current);
    status("idle", { reason, supported });
    if (transcript) notify(onTranscript, transcript);
  }

  function abort(current, reason) {
    current.discard = true;
    finish(current, { discard: true, reason });
    try { current.recognition.abort(); } catch { /* Puede haber terminado ya. */ }
  }

  function recognitionError(current, code, cause) {
    if (session !== current) return;
    abort(current, "error");
    notify(onError, { code, message: ERROR_MESSAGES[code] ?? "No se pudo reconocer la voz. Inténtalo de nuevo.", ...(cause ? { cause } : {}) });
  }

  function stop({ discard = false } = {}) {
    releasePointer();
    const current = session;
    if (!current) return;
    if (discard) {
      abort(current, "discarded");
      return;
    }
    if (current.stopping) return;
    current.stopping = true;
    clearTimer(current.limitTimer);
    current.limitTimer = null;
    status("processing", { supported });
    // Algunos motores entregan sus últimos resultados después de stop().
    current.endTimer = setTimer(() => {
      if (session !== current) return;
      abort(current, "end-timeout");
      notify(onError, { code: "end-timeout", message: "El reconocimiento no terminó a tiempo. No se envió la transcripción." });
    }, END_TIMEOUT_MS);
    try { current.recognition.stop(); } catch (cause) {
      recognitionError(current, "stop-failed", cause);
    }
  }

  function start() {
    if (destroyed || !supported || button.disabled || session) return;
    let recognition;
    try { recognition = new Recognition(); } catch (cause) {
      notify(onError, { code: "start-failed", message: "No se pudo iniciar el reconocimiento de voz.", cause });
      return;
    }
    const current = {
      recognition, final: new Map(), stopping: false, discard: false,
      limitTimer: null, endTimer: null,
    };
    session = current;
    recognition.lang = "es-MX";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      if (session === current && !current.stopping) status("listening", { supported });
    };
    recognition.onresult = (event) => {
      if (session !== current || current.discard) return;
      const results = event?.results;
      if (!results || !Number.isInteger(results.length) || results.length < 0 || results.length > MAX_TRANSCRIPT) return;
      const first = Number.isInteger(event.resultIndex) && event.resultIndex >= 0 ? event.resultIndex : 0;
      const interim = [];
      for (let index = first; index < results.length; ++index) {
        const result = results[index];
        const transcript = result?.[0]?.transcript;
        if (typeof transcript !== "string") continue;
        const value = cleanText(transcript).slice(0, MAX_TRANSCRIPT);
        if (result.isFinal === true) current.final.set(index, value);
        else interim.push(value);
      }
      const transcript = cleanText(`${finalText(current)} ${interim.join(" ")}`).slice(0, MAX_TRANSCRIPT).trim();
      status(current.stopping ? "processing" : "listening", { transcript, supported });
    };
    recognition.onerror = (event) => recognitionError(current, event?.error ?? "unknown");
    recognition.onend = () => finish(current);
    current.limitTimer = setTimer(() => {
      if (session === current) stop();
    }, MAX_SESSION_MS);
    status("listening", { supported });
    try { recognition.start(); } catch (cause) {
      recognitionError(current, "start-failed", cause);
    }
  }

  function toggle() {
    if (phase === "listening") stop();
    else if (phase === "idle") start();
  }

  function listen(target, name, handler) {
    if (!target?.addEventListener) return;
    target.addEventListener(name, handler);
    listeners.push(() => target.removeEventListener(name, handler));
  }

  if (!supported) {
    button.disabled = true;
    button.setAttribute("aria-disabled", "true");
    button.title = "Este navegador no admite reconocimiento de voz. Puedes escribir el mensaje.";
    status("idle", { supported: false, reason: "unsupported" });
  } else {
    status("idle", { supported: true });
    listen(button, "pointerdown", (event) => {
      if (destroyed || button.disabled || pointer || event.isPrimary === false || (event.button !== undefined && event.button !== 0)) return;
      event.preventDefault();
      suppressClickUntil = now() + 700;
      if (phase !== "idle") {
        toggle();
        return;
      }
      pointer = { id: event.pointerId, started: now() };
      try { button.setPointerCapture?.(event.pointerId); } catch { /* Sigue disponible el modo toque. */ }
      start();
    });
    listen(button, "pointerup", (event) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      event.preventDefault();
      const held = now() - pointer.started >= holdDelay;
      suppressClickUntil = now() + 700;
      releasePointer();
      if (held) stop();
    });
    const pointerCancelled = (event) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      stop({ discard: true });
    };
    listen(button, "pointercancel", pointerCancelled);
    listen(button, "lostpointercapture", pointerCancelled);
    listen(button, "keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        stop({ discard: true });
        return;
      }
      const key = event.key === "Spacebar" ? " " : event.key;
      if (key !== "Enter" && key !== " ") return;
      event.preventDefault();
      if (event.repeat || pressedKeys.has(key)) return;
      pressedKeys.add(key);
      suppressClickUntil = now() + 700;
      toggle();
    });
    listen(button, "keyup", (event) => {
      const key = event.key === "Spacebar" ? " " : event.key;
      if (key !== "Enter" && key !== " ") return;
      event.preventDefault();
      pressedKeys.delete(key);
      suppressClickUntil = now() + 700;
    });
    listen(button, "click", (event) => {
      event.preventDefault();
      // Los clicks del puntero/teclado ya se atendieron en sus eventos propios.
      if (event.detail !== 0 || pressedKeys.size || now() <= suppressClickUntil) return;
      toggle();
    });
    listen(view, "blur", () => {
      pressedKeys.clear();
      stop({ discard: true });
    });
    listen(document, "visibilitychange", () => {
      if (document.hidden || document.visibilityState === "hidden") {
        pressedKeys.clear();
        stop({ discard: true });
      }
    });
  }

  return {
    supported,
    stop,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop({ discard: true });
      pressedKeys.clear();
      for (const remove of listeners.splice(0)) remove();
    },
  };
}
