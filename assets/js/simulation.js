/** Doble de servidor exclusivamente para ?simulation=1. No abre red. */
export function createSimulation(config) {
  const names = ['AVANZAR', 'RETROCEDER', 'GIRAR_IZQUIERDA', 'GIRAR_DERECHA',
    'SUBIR_BRAZO', 'BAJAR_BRAZO', 'ABRIR_PALA', 'CERRAR_PALA', 'DETENER'];
  const commands = names.map((nombre, index) => ({ id_comando: index + 1,
    id_vehiculo: config.vehicleId, codigo: index + 1, nombre, descripcion: '', activo: true }));
  const subscribers = new Set();
  let running = false;
  let executionId = null;
  let timers = [];
  const trace = [];
  const wait = () => new Promise(resolve => setTimeout(resolve, 90));
  const state = { id_vehiculo: config.vehicleId, id_comando: 9, conectado: false };
  const emit = event => {
    for (const subscriber of subscribers) {
      if (event.id_demo === undefined || subscriber.demoId === event.id_demo) subscriber.callbacks.onEvent?.(structuredClone(event));
    }
  };
  const cancel = id => {
    const wasRunning = running;
    timers.forEach(clearTimeout); timers = []; running = false;
    if (wasRunning) emit({ tipo: 'cancelado', origen: 'DEMO', id_demo: id,
      id_vehiculo: config.vehicleId, id_ejecucion: executionId });
    return wasRunning;
  };
  const movements = [
    { id_comando: 1, orden: 1, comando: names[0], duracion_ms: 1100, pausa_ms: 300 },
    { id_comando: 3, orden: 2, comando: names[2], duracion_ms: 1100, pausa_ms: 300 },
    { id_comando: 2, orden: 3, comando: names[1], duracion_ms: 1100, pausa_ms: 0 },
  ];
  const api = {
    async health() { await wait(); return { status: 'ok', db: 'SIMULADO' }; },
    async vehicle() { await wait(); return { id_vehiculo: config.vehicleId,
      nombre: 'Excavadora IoT', modelo: 'Vista de prueba · Sin conexión a AWS', activo: true }; },
    async commands() { await wait(); return structuredClone(commands); },
    async demos() { await wait(); return [{ id_demo: 1, id_vehiculo: config.vehicleId,
      nombre: 'Recorrido de prueba (simulado)', descripcion: 'Tres eventos de ejemplo generados por el doble de pruebas. No consulta ni ejecuta una DEMO de RDS.', activo: true }]; },
    async movements() { await wait(); return structuredClone(movements); },
    async demoStatus(id) { await wait(); return { id_demo: id, id_vehiculo: config.vehicleId, corriendo: running }; },
    async manual(id) {
      trace.push({ method: 'POST', operation: 'manual', id });
      cancel(1);
      const command = commands.find(item => item.id_comando === id);
      if (!command) throw new Error('Comando de prueba desconocido.');
      const id_evento = crypto.randomUUID();
      Object.assign(state, { id_comando: id, comando: command.nombre, codigo: command.codigo,
        fecha_actualizacion: new Date().toISOString() });
      // Permite verificar el caso WS antes de respuesta HTTP.
      emit({ tipo: 'estado', origen: 'MANUAL', id_vehiculo: config.vehicleId,
        id_evento, estado: { ...state } });
      await wait();
      return { ok: true, id_vehiculo: config.vehicleId, id_comando: id,
        id_evento, codigo: command.codigo, nombre: command.nombre, estado: { ...state } };
    },
    async startDemo(id) {
      trace.push({ method: 'POST', operation: 'startDemo', id });
      if (running) throw Object.assign(new Error('DEMO ya en ejecución.'), { status: 409 });
      running = true; executionId = crypto.randomUUID();
      const metadata = { origen: 'DEMO', id_demo: id, id_vehiculo: config.vehicleId, id_ejecucion: executionId };
      emit({ ...metadata, tipo: 'inicio', total_movimientos: movements.length });
      let offset = 100;
      for (const movement of movements) {
        timers.push(setTimeout(() => emit({ ...metadata, tipo: 'comando', ...movement,
          nombre: movement.comando, codigo: movement.id_comando }), offset));
        offset += movement.duracion_ms;
        if (movement.pausa_ms) {
          timers.push(setTimeout(() => emit({ ...metadata, tipo: 'pausa', orden: movement.orden,
            duracion_ms: movement.pausa_ms }), offset));
          offset += movement.pausa_ms;
        }
      }
      timers.push(setTimeout(() => { running = false; emit({ ...metadata, tipo: 'fin' }); }, offset));
      await wait();
      return { ok: true, id_demo: id, id_vehiculo: config.vehicleId, corriendo: true,
        total_movimientos: movements.length, id_ejecucion: metadata.id_ejecucion };
    },
    async stopDemo(id) { trace.push({ method: 'POST', operation: 'stopDemo', id });
      const wasRunning = cancel(id); await wait();
      return { ok: true, id_demo: id, detenido: true, estaba_corriendo: wasRunning }; },
  };
  class SimulatedSocket {
    constructor(_config, callbacks) { this.callbacks = callbacks; this.generation = 0; }
    connect(id) {
      this.disconnect(false); this.demoId = id; const generation = ++this.generation;
      this.callbacks.onStatus?.('connecting');
      this.timer = setTimeout(() => {
        if (generation !== this.generation) return;
        subscribers.add(this);
        const event = { tipo: 'bienvenida', origen: 'TELEMETRIA', id_demo: id,
          id_vehiculo: config.vehicleId, corriendo: running, estado: { ...state } };
        this.callbacks.onStatus?.('online'); this.callbacks.onReady?.(event); this.callbacks.onEvent?.(event);
      }, 150);
      return true;
    }
    disconnect(notify = true) { this.generation++; clearTimeout(this.timer); subscribers.delete(this);
      if (notify) this.callbacks.onStatus?.('offline'); }
  }
  return { api, Socket: SimulatedSocket, trace, dispose() { cancel(1); subscribers.clear(); } };
}
