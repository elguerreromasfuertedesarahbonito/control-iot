import { buildCatalog } from './catalog.js';
import { ControlCoordinator } from './coordinator.js';
import { VirtualJoystick } from './joystick.js';
import { ManualInput } from './manual-input.js';
import { AssistantPulse } from './chatbot/pulse.js';
import { bindDemoHold } from './visual-effects.js';

export function createControlView({ config, api, simulation = false, selectRoom, disconnectRoom, onReconnect, onVehicle = () => {} }) {
const CONFIG = config;
const $ = id => document.getElementById(id);
const accessoryButtons = [...$('accessory-controls').querySelectorAll('[data-accessory]')];
const accessoryStates = { light: 'unknown', sound: 'unknown' };
let pendingAccessory = null;
let active = true;
let apiAvailable = false;
let permitted = simulation;
let socketReady = false;
let catalog = null;
let demos = [];
let selectedDemo = null;
let definitionGeneration = 0;
let loading = false;
let readyForDemo = false;
let socketError = '';
let apiError = '';
let definitionError = '';
const auxiliarySources = [];

$('vehicle-id').textContent = String(CONFIG.vehicleId).padStart(2, '0');
const feedback = text => {
  $('feedback').textContent = text;
  $('feedback').title = text;
  if ($('feedback-detail')) $('feedback-detail').textContent = text;
};
const coordinator = new ControlCoordinator(api, { onChange: render });
const manualInput = new ManualInput({
  move: (command, options) => coordinator.move(command, options),
  stop: () => { void coordinator.stop(); },
});
const assistantPulse = new AssistantPulse(manualInput, coordinator);
const socketWaiters = new Set();
let assistantGeneration = 0;
let assistantDemoEpoch = null;
const joystick = createJoystick('drive', 'directions', 'joystick', 'joystick-stick', 'joystick-label');
const toolJoystick = createJoystick('tool', 'tools', 'tool-joystick', 'tool-joystick-stick', 'tool-joystick-label');

function createJoystick(source, group, elementId, stickId, labelId) {
  const control = new VirtualJoystick($(elementId), $(stickId), {
    enabled: () => canMove() && Object.values(catalog?.[group] ?? {}).some(Boolean),
    onDirection: direction => {
      const command = catalog?.[group]?.[direction];
      if (!command || !manualInput.request(source, command)) return false;
      $(labelId).textContent = command.nombre.replaceAll('_', ' ');
      return true;
    },
    onRelease: () => {
      if (manualInput.release(source)) $(labelId).textContent = 'Neutral';
    },
  });
  manualInput.register(source, () => { control.release(false); $(labelId).textContent = 'Neutral'; });
  return control;
}
function onSocketStatus(state, detail = {}) {
  const wasReady = socketReady;
  socketReady = false;
  if (detail.error) socketError = detail.error.message;
  if (state === 'online') socketError = '';
  updateReady();
  if (wasReady && state !== 'online' && ['manual', 'accessory', 'demo', 'demo-starting'].includes(coordinator.mode)) {
    neutral(); void coordinator.stop();
  }
}

function canMove() {
  return active && coordinator.ready &&
    !['accessory', 'demo', 'demo-starting', 'stopping', 'uncertain'].includes(coordinator.mode);
}
function updateReady() {
  coordinator.setReady(Boolean(permitted && apiAvailable && socketReady && catalog?.directions.stop));
}
function render(snapshot = coordinator.snapshot()) {
  const movementAllowed = canMove();
  $('joystick').setAttribute('aria-disabled', String(!movementAllowed || !Object.values(catalog?.directions ?? {}).some(Boolean)));
  $('tool-joystick').setAttribute('aria-disabled', String(!movementAllowed || !Object.values(catalog?.tools ?? {}).some(Boolean)));
  for (const button of $('direction-controls').querySelectorAll('button')) {
    const command = catalog?.directions[button.dataset.direction];
    button.disabled = !movementAllowed || !command;
  }
  for (const button of $('tool-controls').querySelectorAll('button')) {
    button.disabled = !movementAllowed || !catalog?.tools[button.dataset.toolDirection];
  }
  for (const button of accessoryButtons) {
    const accessory = button.dataset.accessory;
    const state = accessoryStates[accessory];
    const pending = pendingAccessory === accessory;
    button.disabled = !active || !snapshot.ready || snapshot.mode !== 'idle' ||
      pendingAccessory !== null || !catalog?.accessories[accessory];
    button.dataset.state = state;
    button.setAttribute('aria-pressed', String(state === 'on'));
    button.setAttribute('aria-busy', String(pending));
    button.querySelector('[data-accessory-status]').textContent = pending ? 'Enviando pulso'
      : { on: 'Encendido estimado', off: 'Apagado estimado', unknown: 'Sin confirmar' }[state];
  }
  for (const button of $('auxiliary-controls').querySelectorAll('button')) button.disabled = !movementAllowed;
  const demoBusy = ['demo', 'demo-starting', 'stopping', 'uncertain'].includes(snapshot.mode);
  $('demo-select').disabled = loading || demoBusy || !demos.length;
  $('start-demo').disabled = !active || !snapshot.ready || snapshot.mode !== 'idle' || !readyForDemo || !selectedDemo;
  $('cancel-demo').disabled = !['demo', 'demo-starting'].includes(snapshot.mode);
  $('stop-button').classList.toggle('is-busy', snapshot.mode === 'stopping');
  for (const id of ['stop-button', 'global-stop', 'details-stop', 'demo-dialog-stop']) $(id).disabled = !permitted;
  $('stop-button').setAttribute('aria-busy', String(snapshot.mode === 'stopping'));
  $('action-name').textContent = snapshot.action.name.replaceAll('_', ' ');
  for (const [id, key] of [['action-requested', 'requested'], ['action-accepted', 'accepted'], ['action-received', 'received']]) {
    $(id).dataset.state = snapshot.action[key] ? 'success' : 'pending';
    const labels = { requested: 'Solicitada', accepted: 'Aceptada', received: 'Recibido' };
    $(id).textContent = snapshot.action[key] ? (simulation ? 'Simulado' : labels[key]) : 'Pendiente';
    $(id).setAttribute('aria-label', `${labels[key]}: ${snapshot.action[key] ? (simulation ? 'simulado' : 'confirmado') : 'pendiente'}`);
  }
  const message = socketError || apiError || definitionError || snapshot.message;
  feedback(simulation ? `SIMULACIÓN · ${message}` : message);
}

function neutral() {
  manualInput.clear();
  for (const button of document.querySelectorAll('.is-active')) {
    button.classList.remove('is-active'); button.setAttribute('aria-pressed', 'false');
  }
}
function bindHold(button, getCommand, labelId = 'joystick-label') {
  let activePointer = null;
  let activeKey = null;
  const reset = () => {
    const pointer = activePointer;
    activePointer = null; activeKey = null;
    button.classList.remove('is-active'); button.setAttribute('aria-pressed', 'false');
    if (pointer !== null && button.hasPointerCapture(pointer)) button.releasePointerCapture(pointer);
  };
  manualInput.register(button, reset);
  const press = () => {
    if (button.disabled || activePointer !== null || activeKey !== null) return false;
    const command = getCommand();
    if (!command || !manualInput.request(button, command)) return false;
    button.classList.add('is-active'); button.setAttribute('aria-pressed', 'true');
    $(labelId).textContent = command.nombre.replaceAll('_', ' ');
    return true;
  };
  const release = () => {
    if (activePointer === null && activeKey === null) return;
    reset();
    if (manualInput.release(button)) $(labelId).textContent = 'Neutral';
  };
  button.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault(); if (press()) { activePointer = event.pointerId; button.setPointerCapture(event.pointerId); }
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, event => {
    if (event.pointerId === activePointer) release();
  });
  button.addEventListener('keydown', event => {
    if (![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault(); if (!event.repeat && press()) activeKey = event.key;
  });
  button.addEventListener('keyup', event => { if (event.key === activeKey) { event.preventDefault(); release(); } });
  button.addEventListener('blur', () => { if (activeKey !== null) release(); });
  // Activacion sintetica de lectores de pantalla: pulsacion breve y liberacion.
  button.addEventListener('click', event => {
    if (event.detail === 0 && press()) { activeKey = 'assistive'; setTimeout(release, 200); }
  });
}
for (const button of $('direction-controls').querySelectorAll('button')) {
  bindHold(button, () => catalog?.directions[button.dataset.direction]);
}
for (const button of $('tool-controls').querySelectorAll('button')) {
  bindHold(button, () => catalog?.tools[button.dataset.toolDirection], 'tool-joystick-label');
}
for (const button of accessoryButtons) {
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    const accessory = button.dataset.accessory;
    pendingAccessory = accessory;
    const label = $(button.getAttribute('aria-labelledby')).textContent;
    const accepted = await coordinator.tapAccessory(catalog.accessories[accessory], label);
    accessoryStates[accessory] = accepted ? (accessoryStates[accessory] === 'on' ? 'off' : 'on') : 'unknown';
    pendingAccessory = null;
    render();
  });
}
$('stop-button').addEventListener('click', () => { neutral(); void coordinator.stop(); });
$('global-stop').addEventListener('click', () => { neutral(); void coordinator.stop(); });
$('details-stop').addEventListener('click', () => { neutral(); void coordinator.stop(); });
$('demo-dialog-stop').addEventListener('click', () => { neutral(); void coordinator.stop(); });
$('cancel-demo').addEventListener('click', () => { neutral(); void coordinator.stop(); });
bindDemoHold($('start-demo'), () => { neutral(); void coordinator.startDemo(selectedDemo); });
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (!permitted) return;
    event.preventDefault(); neutral(); void coordinator.stop();
    if ($('details-dialog').open) $('details-dialog').close();
    if ($('demo-dialog').open) $('demo-dialog').close();
  }
});
function leaveControl() {
  neutral();
  if (['manual', 'accessory', 'demo', 'demo-starting'].includes(coordinator.mode)) void coordinator.stop();
}
window.addEventListener('blur', leaveControl);
document.addEventListener('visibilitychange', () => { if (document.hidden) leaveControl(); });
function releaseManualControl() {
  neutral();
  if (['manual', 'accessory'].includes(coordinator.mode)) void coordinator.stop();
}
$('open-details').addEventListener('click', () => { releaseManualControl(); $('details-dialog').showModal(); });
$('close-details').addEventListener('click', () => { releaseManualControl(); $('details-dialog').close(); });
$('details-dialog').addEventListener('close', releaseManualControl);
$('open-demo').addEventListener('click', () => { releaseManualControl(); $('demo-dialog').showModal(); });
$('close-demo').addEventListener('click', () => { releaseManualControl(); $('demo-dialog').close(); });
$('demo-dialog').addEventListener('close', releaseManualControl);

// El mismo selector y sus botones cambian de lugar; conservan estado y listeners.
const demoPanel = document.querySelector('.demo-panel');
const demoAnchor = document.createComment('Posición de DEMO en la consola');
demoPanel.before(demoAnchor);
const compactViewport = window.matchMedia('(max-height: 560px) and (orientation: portrait), (max-height: 600px) and (orientation: landscape)');
function placeDemoPanel() {
  releaseManualControl();
  if (compactViewport.matches) $('compact-demo-content').append(demoPanel);
  else {
    if ($('demo-dialog').open) $('demo-dialog').close();
    demoAnchor.after(demoPanel);
  }
}
compactViewport.addEventListener('change', placeDemoPanel);
placeDemoPanel();

async function selectDemo() {
  const generation = ++definitionGeneration;
  selectedDemo = Number($('demo-select').value) || null;
  readyForDemo = false;
  definitionError = '';
  const demo = demos.find(item => item.id_demo === selectedDemo);
  $('demo-description').textContent = demo ? demo.descripcion || 'Sin descripción adicional.' : '';
  $('demo-summary').textContent = demo ? 'Consultando definición…' : 'No hay demos disponibles para este acceso.';
  selectRoom(demo?.id_demo ?? CONFIG.defaultDemoId);
  render();
  if (!demo) return;
  try {
    const movements = await api.movements(selectedDemo);
    if (generation !== definitionGeneration) return;
    const ordered = [...movements].sort((a, b) => a.orden - b.orden);
    const total = ordered.reduce((sum, item) => sum + item.duracion_ms + (item.pausa_ms ?? 0), 0);
    readyForDemo = ordered.length > 0;
    $('demo-summary').textContent = `${ordered.length} movimientos · ${(total / 1000).toLocaleString('es-MX')} s de secuencia`;
  } catch (error) { if (generation === definitionGeneration) { $('demo-summary').textContent = 'Definición no disponible'; definitionError = error.message; } }
  render();
}
$('demo-select').addEventListener('change', () => { void selectDemo(); });

async function connect() {
  if (loading) return;
  loading = true; // Bloquea también mientras se espera una parada previa.
  if (['manual', 'accessory', 'demo', 'demo-starting', 'stopping'].includes(coordinator.mode)) { await coordinator.stop(); }
  neutral();
  socketError = ''; apiError = ''; definitionError = '';
  readyForDemo = false; coordinator.setReady(false); render();
  if (!simulation && (!CONFIG.apiBaseUrl || !CONFIG.wsUrlTemplate)) {
    loading = false;
    $('vehicle-model').textContent = 'Conexión segura pendiente';
    $('connection-notice').textContent = 'Falta configurar HTTPS y WSS de la API. La página aún no conecta con AWS.';
    const link = document.createElement('a'); link.href = '?simulation=1'; link.textContent = ' Abrir prueba simulada';
    $('connection-notice').append(link);
    coordinator.message = 'Configura las URLs públicas seguras en assets/js/config.js. Puedes revisar primero la simulación.';
    render(); return;
  }
  $('connection-notice').textContent = simulation
    ? 'MODO SIMULADO · Todos los datos y eventos son de prueba. No se conecta con AWS, RDS ni con la excavadora.'
    : 'WebSocket verifica la sesión del navegador. La API y RDS se comprueban por separado.';
  try {
    const [vehicle, commands, availableDemos] = await Promise.all([api.vehicle(), api.commands(), api.demos()]);
    catalog = buildCatalog(commands, CONFIG.vehicleId); coordinator.configure(catalog);
    onVehicle(vehicle);
    $('vehicle-name').textContent = vehicle.nombre;
    $('vehicle-id').textContent = String(vehicle.id_vehiculo).padStart(2, '0');
    $('vehicle-model').textContent = vehicle.modelo || 'Control remoto mediante API';
    for (const source of auxiliarySources.splice(0)) manualInput.unregister(source);
    $('auxiliary-controls').replaceChildren();
    for (const command of catalog.auxiliary) {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = command.nombre.replaceAll('_', ' '); button.setAttribute('aria-pressed', 'false');
      button.dataset.commandId = String(command.id_comando); $('auxiliary-controls').append(button);
      bindHold(button, () => command, 'tool-joystick-label');
      auxiliarySources.push(button);
    }
    demos = availableDemos.filter(item => item.activo !== false && item.activo !== 0
      && (item.id_vehiculo === undefined || item.id_vehiculo === CONFIG.vehicleId));
    $('demo-select').replaceChildren();
    for (const demo of demos) { const option = document.createElement('option'); option.value = String(demo.id_demo);
      option.textContent = typeof demo.nombre === 'string' ? demo.nombre : `DEMO ${demo.id_demo}`; $('demo-select').append(option); }
    if (demos.some(demo => demo.id_demo === CONFIG.defaultDemoId)) $('demo-select').value = String(CONFIG.defaultDemoId);
    if (!demos.length) {
      const option = document.createElement('option'); option.value = ''; option.textContent = 'Sin demos'; $('demo-select').append(option);
    }
    await selectDemo();
    if (Object.values(catalog.directions).some(command => command === null)) {
      coordinator.message = 'Faltan direcciones válidas en el catálogo. Sus controles están deshabilitados.';
    }
  } catch (error) {
    coordinator.message = error.message;
    disconnectRoom();
  }
  finally { loading = false; updateReady(); render(); }
}
$('reconnect-button').addEventListener('click', () => { void onReconnect(); });
return {
  connect,
  setPermission(value) { permitted = Boolean(value); updateReady(); },
  async beforeSwitch() {
    neutral();
    if (coordinator.stopTask) await coordinator.stopTask;
    else if (permitted && ['manual', 'accessory', 'demo', 'demo-starting'].includes(coordinator.mode)) {
      await coordinator.stop();
    }
  },
  resetVehicle() {
    ++definitionGeneration;
    neutral();
    socketReady = false;
    catalog = null;
    demos = [];
    selectedDemo = null;
    readyForDemo = false;
    coordinator.configure(null);
    coordinator.reset();
    $('demo-select').replaceChildren();
    $('auxiliary-controls').replaceChildren();
    $('demo-summary').textContent = 'Sin unidad seleccionada';
    updateReady();
  },
  onSocketStatus,
  onReady() { socketReady = true; updateReady(); for (const ready of socketWaiters) ready(); },
  observe(event) { coordinator.observe(event); },
  setApiStatus(available, error = '') { apiAvailable = available; apiError = error; updateReady(); },
  version() { return coordinator.epoch; },
  prepareAssistant() { releaseManualControl(); },
  async stopAssistant() {
    ++assistantGeneration;
    if (assistantDemoEpoch !== null && assistantDemoEpoch === coordinator.epoch) { neutral(); await coordinator.stop(); }
    await assistantPulse.stop();
  },
  async executeAssistant(action, { expectedEpoch, signal } = {}) {
    const generation = ++assistantGeneration;
    const checkCurrent = () => {
      if (signal?.aborted || generation !== assistantGeneration) throw new Error('Petición del asistente cancelada.');
      if (expectedEpoch !== undefined && coordinator.epoch !== expectedEpoch) throw new Error('Otro control intervino mientras se interpretaba la petición. Envía una solicitud nueva.');
    };
    if (action.tipo === 'detener') {
      neutral(); await coordinator.stop();
      if (coordinator.mode !== 'idle') throw new Error(coordinator.message);
      return 'DETENER aceptado por la API. La ejecución física requiere verificación del dispositivo.';
    }
    checkCurrent();
    if (action.tipo === 'comando') {
      const command = catalog?.byId.get(action.id_comando);
      if (!command || command === catalog.directions.stop) throw new Error('El movimiento no pertenece al catálogo activo.');
      const result = await assistantPulse.start(command, action.duracion_ms);
      if (result.interrupted) return 'Pulsación interrumpida por otro control o por DETENER.';
      if (result.error) throw new Error(result.error);
      if (result.timed) {
        const seconds = new Intl.NumberFormat('es-MX').format(action.duracion_ms / 1000);
        return `${command.nombre.replaceAll('_', ' ')}: la API aceptó la orden de ${seconds} s. El dispositivo controla la duración.`;
      }
      if (!result.stopped) throw new Error('No se confirmó la parada. Usa DETENER y comprueba la API.');
      return `${command.nombre.replaceAll('_', ' ')}: pulsación de ${action.duracion_ms} ms finalizada y DETENER aceptado por la API. No confirma movimiento físico.`;
    }
    if (action.tipo === 'demo') {
      if (!demos.some(item => item.id_demo === action.id_demo)) throw new Error('La DEMO no pertenece al vehículo activo.');
      if (coordinator.mode !== 'idle') throw new Error('Hay una acción en curso. Solicita DETENER antes de iniciar otra DEMO.');
      if (selectedDemo !== action.id_demo) {
        $('demo-select').value = String(action.id_demo);
        await selectDemo();
      }
      checkCurrent();
      if (!socketReady) await new Promise((resolve, reject) => {
        const ready = () => { clearTimeout(timer); socketWaiters.delete(ready); resolve(); };
        const timer = setTimeout(() => { socketWaiters.delete(ready); reject(new Error('No se confirmó la sesión WSS de la DEMO.')); }, CONFIG.requestTimeoutMs);
        socketWaiters.add(ready);
      });
      checkCurrent();
      if (!readyForDemo) throw new Error('La definición de DEMO no está disponible.');
      const operation = coordinator.startDemo(action.id_demo);
      assistantDemoEpoch = coordinator.epoch;
      try { if (!await operation) throw new Error(coordinator.message); }
      finally { assistantDemoEpoch = null; }
      return 'DEMO aceptada por la API. Los pasos y su finalización se observan por WSS.';
    }
    throw new Error('Esta acción no es una orden de control admitida.');
  },
  setActive(value) {
    if (!value && active) releaseManualControl();
    active = Boolean(value);
    $('open-demo').hidden = !active;
    if (!active && $('demo-dialog').open) $('demo-dialog').close();
    render();
  },
};
}
