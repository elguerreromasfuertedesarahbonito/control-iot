/** Direcciones resueltas por nombre de catálogo; nunca se inventan IDs/códigos. */
const DIRECTION_NAMES = new Map([
  ["AVANZAR", "forward"],
  ["RETROCEDER", "backward"],
  ["GIRAR_IZQUIERDA", "left"],
  ["GIRAR_DERECHA", "right"],
  ["DETENER", "stop"],
]);
const TOOL_NAMES = new Map([
  ["SUBIR_BRAZO", "forward"],
  ["BAJAR_BRAZO", "backward"],
  ["ABRIR_PALA", "left"],
  ["CERRAR_PALA", "right"],
]);

function normalizeName(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toUpperCase().replace(/[\s-]+/g, "_");
}

export function buildCatalog(commands, vehicleId) {
  const directions = { forward: null, backward: null, left: null, right: null, stop: null };
  const tools = { forward: null, backward: null, left: null, right: null };
  const byId = new Map();
  const duplicateIds = new Set();
  if (!Array.isArray(commands) || !Number.isSafeInteger(vehicleId) || vehicleId <= 0) {
    return { directions, tools, auxiliary: [], byId };
  }
  for (const command of commands) {
    if (!command || typeof command !== "object" || Array.isArray(command) ||
        !Number.isSafeInteger(command.id_comando) || command.id_comando <= 0 ||
        command.id_vehiculo !== vehicleId || command.activo !== true ||
        !Number.isSafeInteger(command.codigo) || typeof command.nombre !== "string" ||
        !command.nombre.trim()) continue;
    if (byId.has(command.id_comando)) duplicateIds.add(command.id_comando);
    byId.set(command.id_comando, Object.freeze({ ...command }));
  }
  // Una respuesta ambigua no debe escoger silenciosamente un canal de salida.
  for (const id of duplicateIds) byId.delete(id);
  const auxiliary = [];
  const ambiguous = new Set();
  for (const command of byId.values()) {
    const name = normalizeName(command.nombre);
    const driveDirection = DIRECTION_NAMES.get(name);
    const toolDirection = TOOL_NAMES.get(name);
    const direction = driveDirection ?? toolDirection;
    const group = driveDirection ? directions : tools;
    const key = `${driveDirection ? 'drive' : 'tool'}:${direction}`;
    if (!direction) {
      auxiliary.push(command);
    } else if (group[direction] || ambiguous.has(key)) {
      group[direction] = null;
      ambiguous.add(key);
    } else {
      group[direction] = command;
    }
  }
  auxiliary.sort((a, b) => a.id_comando - b.id_comando);
  return { directions, tools, auxiliary, byId };
}
