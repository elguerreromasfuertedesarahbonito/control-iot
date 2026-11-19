import { isStopMessage } from './contracts.js';

/** La IA propone; el mismo coordinador de CONTROL conserva la autoridad. */
export class ChatSession {
  constructor(api, control, { enabled = true, onMessage = () => {}, onBusy = () => {}, onConfirmation = () => {}, requestId = () => crypto.randomUUID() } = {}) {
    Object.assign(this, { api, control, enabled, onMessage, onBusy, onConfirmation, requestId });
    this.busy = false;
    this.generation = 0;
    this.flight = null;
    this.confirmation = null;
    this.confirming = false;
  }

  setBusy(value) { this.busy = value; this.onBusy(value); }
  clearConfirmation() { this.confirmation = null; this.onConfirmation(null); }
  interrupt() {
    if (this.confirming) this.onMessage('error', 'El cambio de catálogo ya se envió y puede completarse aunque cierres el chat. Verifica el catálogo antes de volver a solicitarlo.');
    ++this.generation;
    this.flight?.abort();
    this.flight = null;
    this.clearConfirmation();
    this.setBusy(false);
  }

  async submit(value, { entrada } = {}) {
    const message = value.trim();
    if (!message || message.length > 1000) return false;
    const stop = isStopMessage(message);
    if (this.busy && !stop) return false;
    if (!this.enabled) { this.onMessage('bot', 'El asistente necesita la API real. No ejecuta órdenes en el modo simulado.'); return false; }
    this.interrupt();
    const generation = this.generation;
    const expectedEpoch = this.control.version();
    const controller = new AbortController();
    this.flight = controller;
    this.onMessage('user', message);
    this.setBusy(true);
    try {
      if (stop) {
        const result = await this.control.executeAssistant({ tipo: 'detener' });
        if (generation === this.generation) this.onMessage('bot', result);
        return true;
      }
      const response = await this.api.interpret(message, this.requestId(), {
        signal: controller.signal, ...(entrada === 'voz' ? { entrada } : {}),
      });
      if (generation !== this.generation) return false;
      if (response.confirmacion) {
        if (!['crear_comando', 'eliminar_comando'].includes(response.accion.tipo)) throw new Error('La confirmación recibida no corresponde a un cambio de catálogo.');
        this.confirmation = { ...response.confirmacion, accion: response.accion, requestId: this.requestId(), expiresAt: Date.now() + response.confirmacion.expira_en_segundos * 1000 };
        this.onMessage('bot', response.mensaje);
        this.onConfirmation(this.confirmation);
      } else if (['crear_comando', 'eliminar_comando'].includes(response.accion.tipo)) {
        throw new Error('Crear o eliminar comandos requiere una confirmación explícita.');
      } else if (['comando', 'detener', 'demo'].includes(response.accion.tipo)) {
        const result = await this.control.executeAssistant(response.accion, { expectedEpoch, signal: controller.signal });
        if (generation === this.generation) this.onMessage('bot', result);
      } else this.onMessage('bot', response.mensaje);
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      const message = error.status === 404
        ? 'El asistente todavía no está instalado en la API. Actualiza el backend de EC2 con los archivos de esta entrega.'
        : error.status === 503 ? 'El servicio de IA o su conexión con los datos no está disponible temporalmente. No se envió ninguna orden; puedes intentarlo más tarde.'
          : error.status === 504 ? 'La interpretación tardó demasiado. No se envió ninguna orden; puedes intentarlo más tarde.'
        : error.message || 'No se pudo completar la petición.';
      this.onMessage('error', message);
      return false;
    } finally {
      if (generation === this.generation) { this.flight = null; this.setBusy(false); }
    }
  }

  async confirm(adminKey) {
    const pending = this.confirmation;
    if (!pending || this.busy || !adminKey) return false;
    if (Date.now() >= pending.expiresAt) {
      this.clearConfirmation(); this.onMessage('error', 'La propuesta caducó. Solicita de nuevo el cambio.'); return false;
    }
    const generation = this.generation;
    const controller = new AbortController();
    this.flight = controller;
    this.confirming = true;
    this.setBusy(true);
    try {
      const response = await this.api.confirmAssistant(pending.token, pending.requestId, adminKey, { signal: controller.signal });
      if (generation !== this.generation) return false;
      this.clearConfirmation();
      this.onMessage('bot', response.mensaje);
      // Refresca el catálogo real; crear un registro no define una salida física.
      await this.control.connect();
      return true;
    } catch (error) {
      if (generation === this.generation) this.onMessage('error', error.message || 'No se pudo confirmar el cambio.');
      return false;
    } finally {
      this.confirming = false;
      if (generation === this.generation) { this.flight = null; this.setBusy(false); }
    }
  }

  destroy() { this.interrupt(); }
}
