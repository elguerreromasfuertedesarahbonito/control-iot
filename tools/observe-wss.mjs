import { CONFIG } from '../assets/js/config.js';
import { mkdir, writeFile } from 'node:fs/promises';

// Cliente externo de solo recepción. No envía POST ni mensajes WSS.
const frames = [];
const channel = new WebSocket(CONFIG.wsUrlTemplate.replace('{id_demo}', CONFIG.defaultDemoId));
const timeout = setTimeout(() => finish('timeout'), 55000);
let finished = false;
async function finish(reason) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  channel.close();
  await mkdir(new URL('../artifacts/', import.meta.url), { recursive: true });
  await writeFile(new URL('../artifacts/live-wss.json', import.meta.url), JSON.stringify({
    observedAt: new Date().toISOString(), reason, frames,
  }, null, 2));
  console.log(`Observación terminada: ${reason}; ${frames.length} eventos reales.`);
}
channel.addEventListener('message', ({ data }) => {
  let frame;
  try { frame = JSON.parse(data); } catch { return; }
  frames.push(frame);
  console.log(JSON.stringify(frame));
  if (frames.filter(item => item.origen === 'MANUAL').length >= 2) void finish('two-manual-events');
});
channel.addEventListener('error', () => { void finish('connection-error'); });
channel.addEventListener('close', () => { void finish('closed'); });
