// Configuracion publica: nunca agregar tokens de DuckDNS, AWS ni credenciales.
export const CONFIG = Object.freeze({
  apiBaseUrl: '', // Activar tras verificar https://excavadora-iot-rsc.duckdns.org
  wsUrlTemplate: '', // Activar tras verificar wss://excavadora-iot-rsc.duckdns.org/ws/demos/{id_demo}
  vehicleId: 1,
  defaultDemoId: 1,
  healthPath: '/health',
  healthIntervalMs: 30000,
  requestTimeoutMs: 8000,
  developerName: 'Ricardo de Jesus Serrano Cortes',
  year: 2026,
});
