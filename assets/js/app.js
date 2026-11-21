import { CONFIG } from './config.js';
import { createApi } from './api.js';
import { DemoSocket } from './socket.js';
import { createControlView } from './control-view.js';
import { Connectivity } from './connectivity.js';
import { createNavigation } from './navigation.js';
import { MonitorModel } from './monitoring/monitor.js';
import { createMonitorView } from './monitoring/view.js';
import { createChatbot } from './chatbot/view.js';
import { createAccess } from './access.js';
import { createAdministration } from './administration.js';
import { installVisualEffects } from './visual-effects.js';

const simulation = new URLSearchParams(location.search).get('simulation') === '1';
const runtime = { ...CONFIG };
const auth = { token: null };
const mock = simulation ? (await import('./simulation.js')).createSimulation(CONFIG) : null;
const api = mock?.api ?? createApi(runtime, { getAccessToken: () => auth.token });
const Socket = mock?.Socket ?? DemoSocket;
const $ = id => document.getElementById(id);
let role = null;
let room = null;
let access;
let switching = false;
let wasOnline = false;
const visuals = installVisualEffects();
document.getElementById('developer-credit').textContent = `Desarrollado por ${CONFIG.developerName} · ${CONFIG.year}`;
const view = createMonitorView({ root: document.getElementById('monitor-view'), config: CONFIG });
const monitor = new MonitorModel(api, {
  vehicleId: simulation ? CONFIG.vehicleId : null, enabled: !simulation, onChange: snapshot => view.render(snapshot),
});
let socket;
const control = createControlView({
  config: runtime, api, simulation,
  selectRoom: id => {
    const next = simulation ? id : runtime.vehicleId;
    if (room === next) return;
    room = next;
    socket.connect(simulation ? id : null);
  },
  disconnectRoom: () => { room = null; socket.disconnect(); },
  onReconnect: async () => {
    if (!simulation && !access?.vehicle) { $('open-access').click(); return; }
    if (!room) await control.connect();
    else if (!wasOnline && !simulation) socket.connect(null);
    await connectivity.refresh();
  },
  onVehicle(vehicle) {
    document.getElementById('monitor-vehicle-name').textContent = vehicle.nombre;
  },
});
const connectivity = new Connectivity(api, CONFIG, {
  simulation, onApiStatus: (available, error) => control.setApiStatus(available, error),
});
// Es la única instancia WSS de esta página; no se recrea al cambiar de vista.
socket = new Socket(runtime, {
  getTicket: () => api.commercial('/auth/ws-ticket', { method: 'POST', body: { id_vehiculo: runtime.vehicleId } }),
  onStatus(status, detail) {
    connectivity.setSocketStatus(status);
    control.onSocketStatus(status, detail);
    monitor.setSocketStatus(status);
    if (!simulation && !switching && wasOnline && ['offline', 'reconnecting'].includes(status)) access?.lostConnection();
    if (status === 'online' || status === 'offline' || status === 'reconnecting') wasOnline = status === 'online';
  },
  onReady() { control.onReady(); },
  onEvent(event) { control.observe(event); monitor.observe(event); },
});
const administration = createAdministration({ api, onDemoChange: () => control.connect() });
const navigation = createNavigation({
  canOpen: name => name === 'control' || (['ADMIN', 'BUYER'].includes(role)),
  onChange(name) {
    control.setActive(name === 'control');
    void monitor.setActive(name === 'monitoreo');
    administration.setActive(name === 'administracion');
  },
});
document.getElementById('monitor-refresh').addEventListener('click', () => { void monitor.refresh(); });
const chatbot = createChatbot({ api, control, enabled: !simulation });
$('open-chat').hidden = true;
$('open-access').hidden = simulation;
if (!simulation) {
  access = createAccess({
    api, auth,
    stopBeforeRelease: () => control.beforeSwitch(),
    changePermissions(session, permit) {
      role = session?.role ?? null;
      control.setPermission(permit);
      $('nav-admin').textContent = role === 'BUYER' ? 'Mis demos' : 'Administración';
      $('open-chat').hidden = !['ADMIN', 'BUYER'].includes(role);
      administration.setRole(role);
      navigation.update();
    },
    async changeVehicle(unit) {
      switching = true;
      try {
        await control.beforeSwitch();
        room = null;
        socket.disconnect();
        control.resetVehicle();
        runtime.vehicleId = unit?.id_vehiculo ?? null;
        await monitor.setContext(api, runtime.vehicleId);
        administration.setVehicle(runtime.vehicleId);
        $('vehicle-name').textContent = unit?.nombre ?? 'Excavadora IoT';
        $('vehicle-model').textContent = unit?.modelo ?? 'Selecciona una unidad en Acceso';
        $('vehicle-id').textContent = runtime.vehicleId === null ? '–' : String(runtime.vehicleId).padStart(2, '0');
        $('monitor-vehicle-name').textContent = unit?.nombre ?? 'Sin unidad seleccionada';
        if (unit) await control.connect();
      } finally { switching = false; }
    },
  });
  control.setPermission(false);
}
view.render(monitor.snapshot());
void connectivity.refresh();
if (simulation) void control.connect();
window.addEventListener('pagehide', () => {
  navigation.destroy();
  connectivity.destroy();
  monitor.destroy();
  socket.disconnect();
  view.destroy();
  chatbot.destroy();
  access?.destroy();
  visuals?.destroy?.();
  mock?.dispose();
});
// BFCache puede restaurar el DOM después de liberar sus conexiones y listeners.
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
