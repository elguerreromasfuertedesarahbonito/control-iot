import { CONFIG } from './config.js';
import { createApi } from './api.js';
import { buildCatalog } from './catalog.js';
import { DemoSocket } from './socket.js';
import { ControlCoordinator } from './coordinator.js';
import { VirtualJoystick } from './joystick.js';

const $ = id => document.getElementById(id);
const simulation = new URLSearchParams(location.search).get('simulation') === '1';
const mock = simulation ? (await import('./simulation.js')).createSimulation(CONFIG) : null;
const api = mock?.api ?? createApi(CONFIG);
const Socket = mock?.Socket ?? DemoSocket;
let apiAvailable = false;
let socketReady = false;
let catalog = null;
let demos = [];
let selectedDemo = null;
let definitionGeneration = 0;
let loading = false;
let healthTimer;
let healthGeneration = 0;
let readyForDemo = false;
const resetHolds = [];

$('developer-credit').textContent = `Desarrollado por ${CONFIG.developerName} · ${CONFIG.year}`;
$('vehicle-id').textContent = String(CONFIG.vehicleId).padStart(2, '0');
const feedback = text => { $('feedback').textContent = text; };
const status = (id, state, text) => {
  $(id).dataset.state = state;
  $(id).textContent = simulation && id !== 'rds-status' ? `Simulado · ${text}` : text;
};
status('rds-status', 'unverified', 'Sin verificar');
const coordinator = new ControlCoordinator(api, { onChange: render });
const joystick = new VirtualJoystick($('joystick'), $('joystick-stick'), {
  enabled: () => canMove(),
  onDirection: direction => requestDirection(direction),
  onRelease: () => { $('joystick-label').textContent = 'Neutral'; void coordinator.stop(); },
});
const socket = new Socket(CONFIG, {
  onStatus(state, detail = {}) {
    const wasReady = socketReady;
    socketReady = false;
    const labels = { connecting: 'Conectando', online: 'En línea', reconnecting: 'Reconectando', offline: 'Desconectado' };
    status('ws-status', state, labels[state] ?? 'Desconectado');
    if (detail.error) feedback(detail.error.message);
    updateReady();
    if (wasReady && state !== 'online' && ['manual', 'demo', 'demo-starting'].includes(coordinator.mode)) {
      joystick.release(false); void coordinator.stop();
    }
  },
  onReady() { socketReady = true; updateReady(); },
  onEvent(event) { coordinator.observe(event); },
});

function canMove() {
  return coordinator.ready && !['demo', 'demo-starting', 'stopping', 'uncertain'].includes(coordinator.mode);
}
function updateReady() {
  coordinator.setReady(Boolean(apiAvailable && socketReady && catalog?.directions.stop));
}
function render(snapshot = coordinator.snapshot()) {
  const movementAllowed = canMove();
  $('joystick').setAttribute('aria-disabled', String(!movementAllowed));
  for (const button of document.querySelectorAll('[data-direction]')) {
    if (button === $('joystick')) continue;
    const command = catalog?.directions[button.dataset.direction];
    button.disabled = !movementAllowed || !command;
  }
  for (const button of $('auxiliary-controls').querySelectorAll('button')) button.disabled = !movementAllowed;
  const demoBusy = ['demo', 'demo-starting', 'stopping', 'uncertain'].includes(snapshot.mode);
  $('demo-select').disabled = loading || demoBusy || !demos.length;
  $('start-demo').disabled = !snapshot.ready || snapshot.mode !== 'idle' || !readyForDemo || !selectedDemo;
  $('cancel-demo').disabled = !['demo', 'demo-starting'].includes(snapshot.mode);
  $('stop-button').classList.toggle('is-busy', snapshot.mode === 'stopping');
  $('stop-button').setAttribute('aria-busy', String(snapshot.mode === 'stopping'));
  $('action-name').textContent = snapshot.action.name.replaceAll('_', ' ');
  for (const [id, key] of [['action-requested', 'requested'], ['action-accepted', 'accepted'], ['action-received', 'received']]) {
    $(id).dataset.state = snapshot.action[key] ? 'success' : 'pending';
    const labels = { requested: 'Solicitada', accepted: 'Aceptada', received: 'Recibido' };
    $(id).textContent = snapshot.action[key] ? (simulation ? 'Simulado' : labels[key]) : 'Pendiente';
    $(id).setAttribute('aria-label', `${labels[key]}: ${snapshot.action[key] ? (simulation ? 'simulado' : 'confirmado') : 'pendiente'}`);
  }
  feedback(simulation ? `SIMULACIÓN · ${snapshot.message}` : snapshot.message);
}

function requestDirection(direction) {
  const command = catalog?.directions[direction];
  if (!command || !coordinator.move(command)) return;
  $('joystick-label').textContent = command.nombre.replaceAll('_', ' ');
}
function neutral() {
  joystick.release(false);
  resetHolds.forEach(reset => reset());
  $('joystick-label').textContent = 'Neutral';
  for (const button of document.querySelectorAll('.is-active')) {
    button.classList.remove('is-active'); button.setAttribute('aria-pressed', 'false');
  }
}
function bindHold(button, getCommand) {
  let activePointer = null;
  let activeKey = null;
  const reset = () => {
    activePointer = null; activeKey = null;
    button.classList.remove('is-active'); button.setAttribute('aria-pressed', 'false');
  };
  resetHolds.push(reset);
  const press = () => {
    if (button.disabled || activePointer !== null || activeKey !== null) return false;
    const command = getCommand();
    if (!command || !coordinator.move(command)) return false;
    button.classList.add('is-active'); button.setAttribute('aria-pressed', 'true');
    $('joystick-label').textContent = command.nombre.replaceAll('_', ' ');
    return true;
  };
  const release = () => {
    if (activePointer === null && activeKey === null) return;
    reset();
    $('joystick-label').textContent = 'Neutral'; void coordinator.stop();
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
  button.addEventListener('blur', release);
  // Activacion sintetica de lectores de pantalla: pulsacion breve y liberacion.
  button.addEventListener('click', event => {
    if (event.detail === 0 && press()) { activeKey = 'assistive'; setTimeout(release, 200); }
  });
}
for (const button of $('direction-controls').querySelectorAll('button')) {
  bindHold(button, () => catalog?.directions[button.dataset.direction]);
}
$('stop-button').addEventListener('click', () => { neutral(); void coordinator.stop(); });
$('global-stop').addEventListener('click', () => { neutral(); void coordinator.stop(); });
$('cancel-demo').addEventListener('click', () => { neutral(); void coordinator.stop(); });
$('start-demo').addEventListener('click', () => { neutral(); void coordinator.startDemo(selectedDemo); });
window.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); neutral(); void coordinator.stop(); } });
function leaveControl() {
  neutral();
  if (['manual', 'demo', 'demo-starting'].includes(coordinator.mode)) void coordinator.stop();
}
window.addEventListener('blur', leaveControl);
document.addEventListener('visibilitychange', () => { if (document.hidden) leaveControl(); });

async function selectDemo() {
  const generation = ++definitionGeneration;
  selectedDemo = Number($('demo-select').value) || null;
  readyForDemo = false; socketReady = false; updateReady();
  const demo = demos.find(item => item.id_demo === selectedDemo);
  $('demo-description').textContent = demo?.descripcion || 'Sin descripción adicional.';
  $('demo-summary').textContent = 'Consultando definición…';
  if (!demo) { socket.disconnect(); render(); return; }
  socket.connect(selectedDemo);
  try {
    const movements = await api.movements(selectedDemo);
    if (generation !== definitionGeneration) return;
    const ordered = [...movements].sort((a, b) => a.orden - b.orden);
    const total = ordered.reduce((sum, item) => sum + item.duracion_ms + (item.pausa_ms ?? 0), 0);
    readyForDemo = ordered.length > 0;
    $('demo-summary').textContent = `${ordered.length} movimientos · ${(total / 1000).toLocaleString('es-MX')} s de secuencia`;
  } catch (error) { if (generation === definitionGeneration) { $('demo-summary').textContent = 'Definición no disponible'; feedback(error.message); } }
  render();
}
$('demo-select').addEventListener('change', () => { void selectDemo(); });

async function checkHealth() {
  const generation = ++healthGeneration;
  clearTimeout(healthTimer);
  status('api-status', 'checking', 'Comprobando');
  try {
    await api.health();
    if (generation !== healthGeneration) return;
    apiAvailable = true; status('api-status', 'online', 'Disponible');
  }
  catch (error) {
    if (generation !== healthGeneration) return;
    apiAvailable = false;
    status('api-status', error.kind === 'config' ? 'unverified' : 'offline', error.kind === 'config' ? 'Sin configurar' : 'No disponible');
    feedback(error.message);
  }
  updateReady();
  healthTimer = setTimeout(checkHealth, CONFIG.healthIntervalMs);
}

async function connect() {
  if (loading) return;
  if (['manual', 'demo', 'demo-starting', 'stopping'].includes(coordinator.mode)) { await coordinator.stop(); }
  loading = true; socketReady = false; coordinator.setReady(false); render();
  if (!simulation && (!CONFIG.apiBaseUrl || !CONFIG.wsUrlTemplate)) {
    loading = false;
    status('api-status', 'unverified', 'Sin configurar'); status('ws-status', 'offline', 'Desconectado');
    $('vehicle-model').textContent = 'Conexión segura pendiente';
    $('connection-notice').textContent = 'Falta configurar HTTPS y WSS de la API. La página aún no conecta con AWS.';
    const link = document.createElement('a'); link.href = '?simulation=1'; link.textContent = ' Abrir prueba simulada';
    $('connection-notice').append(link);
    coordinator.message = 'Configura las URLs públicas seguras en assets/js/config.js. Puedes revisar primero la simulación.';
    render(); return;
  }
  $('connection-notice').textContent = simulation
    ? 'MODO SIMULADO · Todos los datos y eventos son de prueba. No se conecta con AWS, RDS ni con la excavadora.'
    : 'WebSocket verifica la sesión del navegador; /health verifica la API. RDS permanece sin verificar porque no hay diagnóstico de dependencias.';
  void checkHealth();
  try {
    const [vehicle, commands, availableDemos] = await Promise.all([api.vehicle(), api.commands(), api.demos()]);
    catalog = buildCatalog(commands, CONFIG.vehicleId); coordinator.configure(catalog);
    $('vehicle-name').textContent = vehicle.nombre;
    $('vehicle-model').textContent = vehicle.modelo || 'Control remoto mediante API';
    $('auxiliary-controls').replaceChildren();
    for (const command of catalog.auxiliary) {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = command.nombre.replaceAll('_', ' '); button.setAttribute('aria-pressed', 'false');
      button.dataset.commandId = String(command.id_comando); $('auxiliary-controls').append(button);
      bindHold(button, () => command);
    }
    demos = availableDemos.filter(item => item.activo !== false && item.activo !== 0
      && (item.id_vehiculo === undefined || item.id_vehiculo === CONFIG.vehicleId));
    $('demo-select').replaceChildren();
    for (const demo of demos) { const option = document.createElement('option'); option.value = String(demo.id_demo);
      option.textContent = typeof demo.nombre === 'string' ? demo.nombre : `DEMO ${demo.id_demo}`; $('demo-select').append(option); }
    if (demos.some(demo => demo.id_demo === CONFIG.defaultDemoId)) $('demo-select').value = String(CONFIG.defaultDemoId);
    if (!demos.length) {
      const option = document.createElement('option'); option.value = ''; option.textContent = 'No hay DEMO disponibles'; $('demo-select').append(option);
      // La API usa una sala de DEMO para difundir también los manuales.
      socket.connect(CONFIG.defaultDemoId);
    } else await selectDemo();
    if (Object.values(catalog.directions).some(command => command === null)) {
      coordinator.message = 'Faltan direcciones válidas en el catálogo. Sus controles están deshabilitados.';
    }
  } catch (error) { coordinator.message = error.message; }
  finally { loading = false; updateReady(); render(); }
}
$('reconnect-button').addEventListener('click', () => { void connect(); });
window.addEventListener('pagehide', () => { clearTimeout(healthTimer); socket.disconnect(); mock?.dispose(); });
void connect();
