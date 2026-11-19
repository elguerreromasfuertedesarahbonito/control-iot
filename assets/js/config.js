// Configuracion publica: nunca agregar tokens de DuckDNS, AWS ni credenciales.
// Prueba de integración local explícita; este selector no funciona desde Pages.
const localApi = ['127.0.0.1', 'localhost'].includes(globalThis.location?.hostname)
  && new URLSearchParams(globalThis.location?.search ?? '').get('localApi') === '1';
export const CONFIG = Object.freeze({
  apiBaseUrl: localApi ? 'http://127.0.0.1:8001' : 'https://excavadora-iot-rsc.duckdns.org',
  wsUrlTemplate: localApi ? 'ws://127.0.0.1:8001/ws/demos/{id_demo}' : 'wss://excavadora-iot-rsc.duckdns.org/ws/demos/{id_demo}',
  vehicleId: 1,
  defaultDemoId: 1,
  healthPath: '/health',
  healthIntervalMs: 30000,
  requestTimeoutMs: 8000,
  assistantTimeoutMs: 45000,
  sourceTimeZone: 'UTC', // Confirmada mediante NOW(), UTC_TIMESTAMP() y variables de MySQL.
  displayTimeZone: 'America/Mexico_City',
  developerName: 'Ricardo de Jesús Serrano Cortés',
  year: 2026,
});
