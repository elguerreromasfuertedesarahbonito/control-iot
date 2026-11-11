import { isStateResponse, isHistoryResponse } from './monitoring-validation.js';

/** Contrato HTTP de la API existente. No reintenta órdenes POST. */
export class ApiError extends Error {
  constructor(message, { kind = "network", status = null, cause } = {}) {
    super(message, { cause });
    this.name = "ApiError";
    this.kind = kind;
    this.status = status;
  }
}

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const positiveId = (value) => Number.isSafeInteger(value) && value > 0;
const uuid = (value) => typeof value === "string" && /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
const rows = (value) => Array.isArray(value) && value.every(object);

function requireId(value, label) {
  if (!positiveId(value)) {
    throw new ApiError(`${label} debe ser un entero positivo.`, { kind: "config" });
  }
  return value;
}

function apiUrl(config, path) {
  let base;
  try {
    base = new URL(config.apiBaseUrl);
  } catch {
    throw new ApiError("Configura una URL válida para la API.", { kind: "config" });
  }
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new ApiError("La URL de la API debe usar HTTP o HTTPS, sin credenciales ni parámetros.", { kind: "config" });
  }
  if (globalThis.location?.protocol === "https:" && base.protocol !== "https:") {
    throw new ApiError("Esta página HTTPS necesita una API HTTPS. El navegador bloquea HTTP como contenido mixto.", { kind: "mixed-content" });
  }
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || /[?#\\]/.test(path)) {
    throw new ApiError("La ruta de la API no es válida.", { kind: "config" });
  }
  return `${base.href.replace(/\/+$/, "")}${path}`;
}

function serverDetail(body) {
  if (!object(body)) return "";
  if (typeof body.detail === "string") return body.detail.slice(0, 240);
  if (Array.isArray(body.detail)) return "Revisa los datos enviados.";
  return "";
}

/** Construir el cliente no abre conexiones; cada método devuelve una promesa. */
export function createApi(config, { fetchImpl = globalThis.fetch } = {}) {
  async function request(path, { method = "GET", body, signal, validate = object } = {}) {
    const url = apiUrl(config, path);
    if (typeof fetchImpl !== "function") {
      throw new ApiError("Este navegador no permite realizar peticiones HTTP.", { kind: "config" });
    }
    if (signal?.aborted) {
      throw new ApiError("La petición fue cancelada.", { kind: "aborted" });
    }
    const controller = new AbortController();
    const duration = positiveId(config.requestTimeoutMs) ? config.requestTimeoutMs : 8000;
    let timedOut = false;
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, duration);
    try {
      const headers = { Accept: "application/json" };
      if (body !== undefined) headers["Content-Type"] = "application/json";
      const response = await fetchImpl(url, {
        method, headers, signal: controller.signal, credentials: "omit", cache: "no-store",
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      let data;
      try {
        data = await response.json();
      } catch (cause) {
        if (controller.signal.aborted) throw cause;
        if (!response.ok) {
          throw new ApiError(`La API rechazó la petición (HTTP ${response.status}).`, {
            kind: "http", status: response.status, cause,
          });
        }
        throw new ApiError("La API no devolvió JSON válido.", { kind: "invalid-response", status: response.status, cause });
      }
      if (!response.ok) {
        // Un error interno puede incluir rutas o informacion de dependencias.
        const detail = response.status < 500 ? serverDetail(data) : "";
        throw new ApiError(`La API rechazó la petición (HTTP ${response.status}).${detail ? ` ${detail}` : ""}`, {
          kind: "http", status: response.status,
        });
      }
      if (!validate(data)) {
        throw new ApiError("La respuesta de la API no coincide con el contrato esperado.", {
          kind: "invalid-response", status: response.status,
        });
      }
      return data;
    } catch (cause) {
      if (timedOut) {
        throw new ApiError("La API tardó demasiado en responder. Comprueba su disponibilidad.", { kind: "timeout", cause });
      }
      if (signal?.aborted || controller.signal.aborted) {
        throw new ApiError("La petición fue cancelada.", { kind: "aborted", cause });
      }
      if (cause instanceof ApiError) throw cause;
      throw new ApiError("No se pudo conectar con la API. Revisa la red, la URL y CORS.", { kind: "network", cause });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }

  const vehicleId = () => requireId(config.vehicleId, "El vehículo");
  const demoId = (value) => requireId(value, "La demo");

  return Object.freeze({
    async health({ signal } = {}) {
      return request(config.healthPath ?? "/health", { signal,
        validate: (value) => object(value) && value.status === "ok",
      });
    },
    async state({ signal } = {}) {
      return request(`/estado/${vehicleId()}`, { signal, validate: isStateResponse });
    },
    async history({ signal } = {}) {
      // El procedimiento real no acepta límite ni orden: se normaliza después de leer.
      return request(`/historial/${vehicleId()}`, { signal, validate: isHistoryResponse });
    },
    async vehicle() {
      const id = vehicleId();
      return request(`/vehiculos/${id}`, {
        validate: (value) => object(value) && value.id_vehiculo === id && typeof value.nombre === "string",
      });
    },
    async commands() {
      return request(`/comandos/vehiculo/${vehicleId()}`, { validate: rows });
    },
    async demos() {
      return request(`/demos/vehiculo/${vehicleId()}`, {
        validate: (value) => rows(value) && value.every((row) => positiveId(row.id_demo)),
      });
    },
    async movements(id) {
      return request(`/demos/${demoId(id)}/movimientos`, {
        validate: (value) => rows(value) && value.every((row) =>
          positiveId(row.id_comando) && positiveId(row.orden) &&
          Number.isInteger(row.duracion_ms) && row.duracion_ms >= 1 && row.duracion_ms <= 60000 &&
          (row.pausa_ms === undefined || (Number.isInteger(row.pausa_ms) && row.pausa_ms >= 0 && row.pausa_ms <= 60000))),
      });
    },
    async demoStatus(id) {
      const demo = demoId(id);
      const vehicle = vehicleId();
      return request(`/demos/${demo}/estado-ejecucion`, {
        validate: (value) => object(value) && value.id_demo === demo && value.id_vehiculo === vehicle && typeof value.corriendo === "boolean",
      });
    },
    async manual(commandId, { signal } = {}) {
      const vehicle = vehicleId();
      const command = requireId(commandId, "El comando");
      return request(`/vehiculos/${vehicle}/comando-manual`, {
        method: "POST", body: { id_comando: command, origen: "MANUAL" }, signal,
        validate: (value) => object(value) && value.ok === true && value.id_vehiculo === vehicle &&
          value.id_comando === command && uuid(value.id_evento) && object(value.estado),
      });
    },
    async startDemo(id, { signal } = {}) {
      const demo = demoId(id);
      const vehicle = vehicleId();
      return request(`/demos/${demo}/ejecutar`, {
        method: "POST", signal,
        validate: (value) => object(value) && value.ok === true && value.id_demo === demo &&
          value.id_vehiculo === vehicle && value.corriendo === true &&
          positiveId(value.total_movimientos) && uuid(value.id_ejecucion),
      });
    },
    async stopDemo(id, { signal } = {}) {
      const demo = demoId(id);
      return request(`/demos/${demo}/detener`, {
        method: "POST", signal,
        validate: (value) => object(value) && value.ok === true && value.id_demo === demo &&
          value.detenido === true && typeof value.estaba_corriendo === "boolean",
      });
    },
  });
}
