/** Direcciones resueltas por nombre de catálogo; nunca se inventan IDs/códigos. */
const DIRECTION_NAMES = new Map([
  ["AVANZAR", "forward"],
  ["RETROCEDER", "backward"],
  ["GIRAR_IZQUIERDA", "left"],
  ["GIRAR_DERECHA", "right"],
  ["DETENER", "stop"],
]);

function normalizeName(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toUpperCase().replace(/[\s-]+/g, "_");
}

export function buildCatalog(commands, vehicleId) {
  const directions = { forward: null, backward: null, left: null, right: null, stop: null };
  const byId = new Map();
  const duplicateIds = new Set();
  if (!Array.isArray(commands) || !Number.isSafeInteger(vehicleId) || vehicleId <= 0) {
    return { directions, auxiliary: [], byId };
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
    const direction = DIRECTION_NAMES.get(normalizeName(command.nombre));
    if (!direction) {
      auxiliary.push(command);
    } else if (directions[direction] || ambiguous.has(direction)) {
      directions[direction] = null;
      ambiguous.add(direction);
    } else {
      directions[direction] = command;
    }
  }
  auxiliary.sort((a, b) => a.id_comando - b.id_comando);
  return { directions, auxiliary, byId };
}
