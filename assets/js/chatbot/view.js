import { ChatSession } from './session.js';
import { createVoiceInput } from './voice.js';
import { createRecordedRecognition } from './voice-capture.js';
import { isStopMessage } from './contracts.js';

export function createChatbot({ api, control, enabled = true }) {
  const find = id => document.getElementById(id);
  const dialog = find('chat-dialog');
  const launcher = find('open-chat');
  const log = find('chat-messages');
  const form = find('chat-form');
  const input = find('chat-input');
  const send = find('chat-send');
  const mic = find('chat-mic');
  const status = find('chat-status');
  const voiceHelp = find('chat-voice-help');
  const confirmationForm = find('chat-confirmation');
  const admin = find('chat-admin-key');
  let expiryTimer;
  let busy = false;
  let voice;
  const listeners = [];
  const listen = (target, event, callback, options) => {
    target.addEventListener(event, callback, options);
    listeners.push(() => target.removeEventListener(event, callback, options));
  };
  function append(role, text) {
    const item = document.createElement('li');
    item.className = `chat-message chat-message--${role}`;
    const label = document.createElement('span');
    label.className = 'chat-message-author';
    label.textContent = role === 'user' ? 'Tú' : role === 'error' ? 'Aviso' : 'Terra AI';
    const body = document.createElement('p');
    body.textContent = text;
    item.append(label, body);
    log.append(item);
    while (log.children.length > 40) log.firstElementChild.remove();
    item.scrollIntoView({ block: 'nearest' });
  }
  function setBusy(value) {
    busy = value;
    send.disabled = value && !isStopMessage(input.value);
    mic.disabled = value || !voice?.supported || Boolean(session.confirmation);
    find('chat-confirm').disabled = value;
    find('chat-cancel-confirm').disabled = value && session.confirming;
    status.textContent = value ? 'Procesando petición… DETENER sigue disponible.'
      : voice?.supported ? 'Listo para escribir o dictar.' : 'Voz no disponible en este navegador. Puedes escribir.';
    form.setAttribute('aria-busy', String(value));
  }
  const session = new ChatSession(api, control, {
    enabled, onMessage: append, onBusy: setBusy,
    onConfirmation(value) {
      clearTimeout(expiryTimer);
      confirmationForm.hidden = !value;
      admin.value = '';
      if (voice) { voice.stop({ discard: true }); mic.disabled = Boolean(value) || busy || !voice.supported; }
      if (!value) return;
      find('chat-confirm-summary').textContent = value.resumen;
      expiryTimer = setTimeout(() => {
        if (session.confirming) { append('bot', 'La confirmación ya está en curso. Espera su resultado y verifica el catálogo si se pierde la conexión.'); return; }
        session.clearConfirmation(); append('bot', 'La propuesta caducó; no se modificó el catálogo.');
      }, value.expira_en_segundos * 1000);
      admin.focus();
    },
  });
  voice = createVoiceInput({
    button: mic,
    RecordedRecognition: enabled && typeof api.transcribeVoice === 'function'
      ? createRecordedRecognition({ transcribe: (audio, options) => api.transcribeVoice(audio, options) })
      : null,
    onTranscript(text) {
      if (!dialog.open || busy || session.confirmation) return;
      void session.submit(text, { entrada: 'voz' });
    },
    onStatus(state, detail = {}) {
      voiceHelp.dataset.mode = detail.mode;
      voiceHelp.textContent = detail.mode === 'recorded'
        ? 'Toca para alternar o mantén y suelta. Al terminar, la grabación se envía a Gemini para transcribirla.'
        : 'Voz: toca para alternar o mantén y suelta. El reconocimiento puede usar el servicio de voz del navegador.';
      if (busy) return;
      if (state === 'listening') {
        status.textContent = detail.starting ? 'Activando micrófono…' : detail.transcript || 'Escuchando… suelta o toca para terminar.';
      } else if (state === 'processing') {
        status.textContent = detail.mode === 'recorded' ? 'Transcribiendo con Gemini…' : 'Finalizando reconocimiento…';
      } else {
        status.textContent = detail.supported ? 'Listo para escribir o dictar.' : 'Voz no disponible en este navegador. Puedes escribir.';
      }
    },
    onError(error) { append('error', error.message); },
  });
  function open() {
    control.prepareAssistant();
    dialog.showModal();
    launcher.setAttribute('aria-expanded', 'true');
    input.focus();
  }
  function close() {
    voice.stop({ discard: true });
    session.interrupt();
    void control.stopAssistant();
    if (dialog.open) dialog.close();
    launcher.setAttribute('aria-expanded', 'false');
  }
  function interrupt() { voice.stop({ discard: true }); session.interrupt(); }
  listen(launcher, 'click', open);
  listen(find('chat-close'), 'click', close);
  listen(dialog, 'cancel', () => { interrupt(); void control.stopAssistant(); });
  listen(dialog, 'close', () => { interrupt(); void control.stopAssistant(); launcher.setAttribute('aria-expanded', 'false'); });
  listen(form, 'submit', event => {
    event.preventDefault();
    voice.stop({ discard: true });
    const text = input.value;
    if (!text.trim() || (busy && !isStopMessage(text))) return;
    input.value = '';
    void session.submit(text);
  });
  listen(input, 'keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
  });
  listen(input, 'input', () => { send.disabled = busy && !isStopMessage(input.value); });
  listen(find('chat-stop'), 'click', () => { interrupt(); void session.submit('detener'); });
  // Captura la parada existente antes de que una respuesta IA tardía pueda actuar.
  for (const id of ['global-stop', 'stop-button', 'details-stop', 'demo-dialog-stop', 'cancel-demo']) listen(find(id), 'click', interrupt, true);
  listen(window, 'keydown', event => { if (event.key === 'Escape') { interrupt(); if (dialog.open) close(); } }, true);
  listen(window, 'blur', interrupt);
  listen(document, 'visibilitychange', () => { if (document.hidden) interrupt(); });
  listen(confirmationForm, 'submit', event => {
    event.preventDefault();
    voice.stop({ discard: true });
    const key = admin.value;
    admin.value = '';
    void session.confirm(key);
  });
  listen(find('chat-cancel-confirm'), 'click', () => { session.clearConfirmation(); append('bot', 'Cambio cancelado. No se modificó el catálogo.'); input.focus(); });
  setBusy(false);
  return { destroy() { clearTimeout(expiryTimer); voice.destroy(); session.destroy(); void control.stopAssistant(); for (const remove of listeners) remove(); } };
}
