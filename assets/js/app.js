import { CONFIG } from './config.js';
import { createApi } from './api.js';
import { DemoSocket } from './socket.js';
import { createControlView } from './control-view.js';
import { Connectivity } from './connectivity.js';
import { createNavigation } from './navigation.js';
import { MonitorModel } from './monitoring/monitor.js';
import { createMonitorView } from './monitoring/view.js';

const simulation = new URLSearchParams(location.search).get('simulation') === '1';
const mock = simulation ? (await import('./simulation.js')).createSimulation(CONFIG) : null;
const api = mock?.api ?? createApi(CONFIG);
const Socket = mock?.Socket ?? DemoSocket;
document.getElementById('developer-credit').textContent = `Desarrollado por ${CONFIG.developerName} · ${CONFIG.year}`;
const view = createMonitorView({ root: document.getElementById('monitor-view'), config: CONFIG });
const monitor = new MonitorModel(api, {
  vehicleId: CONFIG.vehicleId, enabled: !simulation, onChange: snapshot => view.render(snapshot),
});
let socket;
const control = createControlView({
  config: CONFIG, api, simulation,
  selectRoom: id => socket.connect(id),
  disconnectRoom: () => socket.disconnect(),
  onReconnect: async () => { await Promise.all([connectivity.refresh(), control.connect()]); },
  onVehicle(vehicle) {
    document.getElementById('monitor-vehicle-name').textContent = vehicle.nombre;
  },
});
const connectivity = new Connectivity(api, CONFIG, {
  simulation, onApiStatus: (available, error) => control.setApiStatus(available, error),
});
// Es la única instancia WSS de esta página; no se recrea al cambiar de vista.
socket = new Socket(CONFIG, {
  onStatus(status, detail) {
    connectivity.setSocketStatus(status);
    control.onSocketStatus(status, detail);
    monitor.setSocketStatus(status);
  },
  onReady() { control.onReady(); },
  onEvent(event) { control.observe(event); monitor.observe(event); },
});
const navigation = createNavigation({ onChange(name) {
  control.setActive(name === 'control');
  void monitor.setActive(name === 'monitoreo');
} });
document.getElementById('monitor-refresh').addEventListener('click', () => { void monitor.refresh(); });
view.render(monitor.snapshot());
void connectivity.refresh();
void control.connect();
window.addEventListener('pagehide', () => {
  navigation.destroy();
  connectivity.destroy();
  monitor.destroy();
  socket.disconnect();
  view.destroy();
  mock?.dispose();
});
// BFCache puede restaurar el DOM después de liberar sus conexiones y listeners.
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
