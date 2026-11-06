# Verificación de la actividad 4.1

## Alcance actual

El usuario autorizó por ahora **solo pruebas simuladas** del frontend. El 6 de noviembre de 2026 confirmó que HTTPS y WSS funcionan en `excavadora-iot-rsc.duckdns.org`; las URLs públicas ya están configuradas en el cliente. Esa confirmación no sustituye las pruebas A–E desde el frontend publicado. Este documento describe las pruebas locales y las comprobaciones reales todavía pendientes; no acredita disponibilidad de RDS, publicación de GitHub Pages ni uso de un teléfono físico.

Ejecutar desde la carpeta `control-iot`:

```powershell
node --test tests/*.test.js
node tools/serve.mjs
```

Abrir `http://localhost:4173/?simulation=1`. La interfaz debe identificar la simulación y no mostrar los servicios simulados como conexiones reales verificadas. Conservar los resultados efectivos de la ejecución; no completar un resultado esperado como si hubiera sido observado.

## Casos locales

| Caso | Procedimiento | Resultado requerido |
| --- | --- | --- |
| Joystick | Arrastrar dentro de una misma dirección, pasar a otra y soltar fuera del círculo. | Una solicitud por cambio efectivo; retorno neutral y DETENER al terminar el gesto. |
| Cancelación del gesto | Repetir con `pointercancel`, pérdida de captura, pérdida de foco u ocultación de la pestaña. | Ninguna dirección visualmente sostenida; no multiplicar STOP por los eventos de cierre del mismo gesto. |
| Botones | Operar controles alternativos y auxiliares mediante toque, mouse y teclado. | Reutilizan el coordinador; nombres y códigos pertenecen al catálogo admitido. |
| Prioridad DETENER | Mantener una respuesta de movimiento pendiente, cambiar de dirección y pulsar DETENER. Resolver después la respuesta antigua. | Neutral inmediato; la dirección pendiente se descarta y ninguna respuesta tardía reactiva la interfaz. |
| DEMO pendiente | Solicitar una DEMO y DETENER antes de recibir su aceptación; entregar luego el 202 o evento de inicio. | Conservar la intención de detener y reconciliar mediante la cancelación real del contrato. |
| Inicio duplicado | Accionar dos veces Ejecutar DEMO rápidamente. | Una única solicitud de inicio mientras está pendiente o ejecutándose. |
| Eventos adelantados | Entregar el evento MANUAL antes de resolver el HTTP 201 correspondiente. | Se correlaciona por `id_evento` cuando llega la respuesta; no se pierde la evidencia. |
| Datos inválidos | Usar un catálogo incompleto, otra identificación de vehículo o texto con etiquetas HTML. | No inventar IDs; deshabilitar direcciones no disponibles y representar el texto sin ejecutarlo. |
| Red y errores | Simular timeout, JSON no válido, HTTP 409/422/500 y cierre WebSocket. | Mensaje comprensible, estados independientes y recuperación controlada; no reintentar movimientos automáticamente. |
| Reconexión | Reconectar y entregar después un cierre de la sesión antigua. | El callback viejo no modifica la sesión nueva; se exige nueva bienvenida. |
| Contenido mixto | Simular página HTTPS con configuración HTTP/WS. | Se bloquea la integración insegura antes de crear la conexión. |
| Responsive | Revisar 360 px vertical, móvil horizontal, tableta y escritorio. | Sin desbordamientos ni créditos superpuestos; controles táctiles de tamaño suficiente y foco visible. |
| Rutas | Servir bajo una subruta y revisar favicon, CSS e importaciones. | Ninguna dependencia de rutas absolutas desde la raíz del dominio. |

## Etapa real pendiente: condiciones previas

1. Tener HTTPS/WSS funcionando en EC2, configuración pública correcta y CORS para el origen de Pages.
2. Publicar el frontend y abrirlo desde su URL de GitHub Pages.
3. Mantener la ESP8266 apagada o desconectada de este canal durante estas pruebas. La práctica se limita a REST y a los eventos del backend.
4. Autorizar expresamente la ejecución de solicitudes contra la API real. Sus POST pueden modificar estado e historial aunque el vehículo esté desconectado.
5. Abrir en Postman, Thunder Client o una extensión WebSocket una **segunda sesión WSS independiente** a la misma DEMO. No enviar `accion:estado`, porque escribe estado en BD.

El navegador de la aplicación mantiene su propia sesión; el cliente externo no la sustituye. Para la DEMO 1 configurada, usar `wss://excavadora-iot-rsc.duckdns.org/ws/demos/1` y comprobar la trama `bienvenida`. Si se selecciona otra DEMO, ambos clientes deben usar su identificador real.

## Pruebas obligatorias A–E, todavía pendientes

| Prueba | Acción desde la página publicada | Evidencia que debe conservarse |
| --- | --- | --- |
| A · Movimiento individual | Solicitar AVANZAR desde un móvil. | URL publicada, control accionado, POST exitoso y evento MANUAL externo con vehículo/comando e `id_evento` correspondiente. |
| B · Cambio y detención | Cambiar de dirección y soltar el joystick; probar DETENER durante una solicitud pendiente. | Nuevo movimiento y STOP; ausencia de ráfagas por píxel y de reactivación visual por respuestas antiguas. |
| C · DEMO | Seleccionar una DEMO consultada, iniciar, observar sus N pasos y finalizar o cancelar. | Inicio, orden/duración/pausa, final o cancelación; sin secuencia fija en el navegador ni doble inicio. |
| D · Conectividad | Interrumpir y recuperar por separado WSS y HTTPS mediante herramientas de prueba autorizadas. | Los dos indicadores cambian de forma independiente; RDS permanece «Sin verificar» sin diagnóstico específico. |
| E · Responsividad | Usar móvil físico vertical/horizontal y escritorio. | Capturas legibles de controles, créditos al pie y favicon en la pestaña, sin superposición. |

Una respuesta HTTP exitosa demuestra aceptación de la API. Un mensaje WebSocket demuestra publicación del evento. Ninguno confirma movimiento físico. El campo `conectado` tampoco es un latido fiable del dispositivo en este backend.

## Registro de resultados

Para cada comprobación real, anotar fecha, URL, navegador/dispositivo, acción, resultado observado y nombre de la captura. Si no pudo ejecutarse, conservar el estado **Pendiente** y la causa. No usar capturas simuladas para acreditar las pruebas A–D ni afirmar que una API disponible valida sus 21 servicios completos.
