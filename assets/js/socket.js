import { ApiError } from "./api.js";

const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, limit = 240) => typeof value === "string" && value.length <= limit;
const uuid = (value) => typeof value === "string" && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
const MAX_FRAME_BYTES = 64 * 1024;

function socketUrl(config, demoId) {
  if (!positiveId(demoId) || !positiveId(config.vehicleId)) {
    throw new ApiError("Selecciona un vehículo y una demo válidos.", { kind: "config" });
  }
  const template = config.wsUrlTemplate;
  if (typeof template !== "string" || template.split("{id_demo}").length !== 2) {
    throw new ApiError("Configura la URL WebSocket con {id_demo}.", { kind: "config" });
  }
  let url;
  try {
    url = new URL(template.replace("{id_demo}", String(demoId)));
  } catch {
    throw new ApiError("La URL WebSocket no es válida.", { kind: "config" });
  }
  if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
    throw new ApiError("El canal debe usar WS o WSS, sin credenciales ni parámetros.", { kind: "config" });
  }
  if (globalThis.location?.protocol === "https:" && url.protocol !== "wss:") {
    throw new ApiError("Esta página HTTPS necesita WSS. El navegador bloquea WS como contenido mixto.", { kind: "mixed-content" });
  }
  return url.href;
}

function stateCopy(state, vehicleId) {
  if (state === null) return null;
  if (!object(state) || state.id_vehiculo !== vehicleId ||
      !(state.id_comando === null || positiveId(state.id_comando)) || typeof state.conectado !== "boolean") return undefined;
  const result = { id_vehiculo: vehicleId, id_comando: state.id_comando, conectado: state.conectado };
  for (const key of ["vehiculo", "comando", "fecha_actualizacion"]) {
    if (state[key] !== undefined) {
      if (state[key] !== null && !text(state[key])) return undefined;
      result[key] = state[key];
    }
  }
  if (state.codigo !== undefined) {
    if (state.codigo !== null && !Number.isSafeInteger(state.codigo)) return undefined;
    result.codigo = state.codigo;
  }
  return result;
}

/** Copia solo campos conocidos. Una trama desconocida nunca vuelve listo el control. */
function normalizeEvent(value, demoId, vehicleId) {
  if (!object(value) || !["MANUAL", "DEMO", "TELEMETRIA"].includes(value.origen)) return null;
  const event = { tipo: value.tipo, origen: value.origen };
  if (value.id_demo !== undefined) {
    if (value.id_demo !== demoId) return null;
    event.id_demo = demoId;
  }
  if (value.id_vehiculo !== undefined) {
    if (value.id_vehiculo !== vehicleId) return null;
    event.id_vehiculo = vehicleId;
  }
  if (value.id_ejecucion !== undefined) {
    if (!uuid(value.id_ejecucion)) return null;
    event.id_ejecucion = value.id_ejecucion;
  }
  if (value.tipo === "bienvenida") {
    if (value.origen !== "TELEMETRIA" || value.id_demo !== demoId || value.id_vehiculo !== vehicleId ||
        typeof value.corriendo !== "boolean") return null;
    event.corriendo = value.corriendo;
    event.estado = stateCopy(value.estado, vehicleId);
    return event.estado === undefined ? null : event;
  }
  if (value.tipo === "estado") {
    if (value.id_vehiculo !== vehicleId) return null;
    event.estado = stateCopy(value.estado, vehicleId);
    if (event.estado === undefined) return null;
    if (value.origen === "MANUAL") {
      if (!uuid(value.id_evento)) return null;
      event.id_evento = value.id_evento;
    }
    return event;
  }
  if (value.tipo === "pong") return value.origen === "TELEMETRIA" ? event : null;
  if (value.tipo === "error") {
    if (!text(value.detalle)) return null;
    event.detalle = value.detalle;
    return event;
  }
  if (!["inicio", "comando", "pausa", "fin", "cancelado"].includes(value.tipo) ||
      value.origen !== "DEMO" || value.id_demo !== demoId || value.id_vehiculo !== vehicleId ||
      !uuid(value.id_ejecucion)) return null;
  if (value.tipo === "inicio") {
    if (!positiveId(value.total_movimientos)) return null;
    event.total_movimientos = value.total_movimientos;
  }
  if (value.tipo === "comando" || value.tipo === "pausa") {
    if (!positiveId(value.orden) || !Number.isInteger(value.duracion_ms) ||
        value.duracion_ms < 1 || value.duracion_ms > 60000) return null;
    event.orden = value.orden;
    event.duracion_ms = value.duracion_ms;
  }
  if (value.tipo === "comando") {
    if (!positiveId(value.id_comando) || !Number.isSafeInteger(value.codigo) || !text(value.nombre)) return null;
    event.id_comando = value.id_comando;
    event.codigo = value.codigo;
    event.nombre = value.nombre;
  }
  return event;
}

/** Observador: nunca publica estado, órdenes ni POST. */
export class DemoSocket {
  constructor(config, { WebSocketImpl = globalThis.WebSocket, onStatus = () => {}, onEvent = () => {}, onReady = () => {} } = {}) {
    this.config = config;
    this.WebSocketImpl = WebSocketImpl;
    this.onStatus = onStatus;
    this.onEvent = onEvent;
    this.onReady = onReady;
    this._generation = 0;
    this._socket = null;
    this._wanted = false;
    this._ready = false;
    this._attempt = 0;
    this._retryTimer = null;
    this._welcomeTimer = null;
  }

  _emit(callback, ...args) {
    try { callback(...args); } catch { /* Un fallo de la vista no altera la sesión. */ }
  }

  _status(status, detail = {}) { this._emit(this.onStatus, status, detail); }

  _clearTimers() {
    clearTimeout(this._retryTimer);
    clearTimeout(this._welcomeTimer);
    this._retryTimer = null;
    this._welcomeTimer = null;
  }

  connect(demoId) {
    this._reset();
    try {
      this._url = socketUrl(this.config, demoId);
      if (typeof this.WebSocketImpl !== "function") {
        throw new ApiError("Este navegador no admite WebSocket.", { kind: "config" });
      }
    } catch (error) {
      this._status("offline", { error });
      return false;
    }
    this._demoId = demoId;
    this._wanted = true;
    this._open(this._generation);
    return true;
  }

  _reset() {
    ++this._generation;
    this._wanted = false;
    this._ready = false;
    this._attempt = 0;
    this._clearTimers();
    const previous = this._socket;
    this._socket = null;
    try { previous?.close(1000, "Cambio de sesion"); } catch { /* Ya cerrado. */ }
  }

  disconnect() {
    this._reset();
    this._status("offline");
  }

  _retry(generation, error) {
    if (!this._wanted || generation !== this._generation || this._retryTimer !== null) return;
    this._ready = false;
    clearTimeout(this._welcomeTimer);
    this._welcomeTimer = null;
    const base = Math.min(15000, 1000 * (2 ** Math.min(this._attempt, 4)));
    const delay = Math.min(15000, Math.max(1000, Math.round(base * (0.8 + Math.random() * 0.4))));
    ++this._attempt;
    this._status("reconnecting", { error, retryInMs: delay });
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this._open(generation);
    }, delay);
  }

  _open(generation) {
    if (!this._wanted || generation !== this._generation) return;
    this._status(this._attempt ? "reconnecting" : "connecting");
    let socket;
    try {
      socket = new this.WebSocketImpl(this._url);
    } catch (cause) {
      this._retry(generation, new ApiError("No se pudo abrir el canal WebSocket.", { kind: "network", cause }));
      return;
    }
    this._socket = socket;
    const current = () => this._wanted && generation === this._generation && this._socket === socket;
    const fail = (error) => {
      if (!current()) return;
      this._socket = null;
      try { socket.close(); } catch { /* No conectado. */ }
      this._retry(generation, error);
    };
    const timeout = positiveId(this.config.requestTimeoutMs) ? this.config.requestTimeoutMs : 8000;
    this._welcomeTimer = setTimeout(() => fail(new ApiError("No se recibió la bienvenida del canal.", { kind: "timeout" })), timeout);
    socket.onmessage = ({ data }) => {
      if (!current() || typeof data !== "string" || data.length > MAX_FRAME_BYTES) return;
      if (typeof TextEncoder !== "undefined" && new TextEncoder().encode(data).byteLength > MAX_FRAME_BYTES) return;
      let parsed;
      try { parsed = JSON.parse(data); } catch { return; }
      const event = normalizeEvent(parsed, this._demoId, this.config.vehicleId);
      if (!event || (!this._ready && event.tipo !== "bienvenida")) return;
      if (event.tipo === "bienvenida") {
        if (this._ready) return;
        this._ready = true;
        this._attempt = 0;
        clearTimeout(this._welcomeTimer);
        this._welcomeTimer = null;
        this._status("online");
        this._emit(this.onReady, event);
      }
      this._emit(this.onEvent, event);
    };
    socket.onerror = () => fail(new ApiError("Se perdió el canal WebSocket.", { kind: "network" }));
    socket.onclose = ({ code }) => fail(new ApiError(
      code === 1008 ? "La demo no existe o está inactiva." : "El canal WebSocket se cerró.", { kind: "network" },
    ));
  }
}
