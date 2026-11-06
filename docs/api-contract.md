# Contrato de integración de Control IoT

Fuente de este contrato: `vehiculo-iot-api/app` de la copia local, en particular `main.py`, `schemas.py`, los routers y `services/demo_runner.py`. No se modificó el backend. Después de la indicación de probar solo mediante simulaciones, no se realiza ninguna conexión al servidor.

## Transporte y disponibilidad

- Dirección conocida del despliegue anterior: `http://32.194.155.66:8000`. Las URLs del frontend permanecen vacías hasta disponer de HTTPS/WSS; esta dirección no se carga como configuración predeterminada.
- Canal actual: `ws://32.194.155.66:8000/ws/demos/{id_demo}`.
- El `run.py` actual escucha en el puerto 8000 sin certificado TLS y usa un solo worker. Las suscripciones y tareas de demo viven en memoria del proceso.
- GitHub Pages sirve por HTTPS. El navegador bloqueará peticiones HTTP y conexiones WS desde esa página. Los servicios detectan este caso antes de conectarse y devuelven un error `mixed-content`. Publicar el HTML no convierte la API en HTTPS; debe configurarse un servicio HTTPS/WSS real antes de controlar desde Pages.
- CORS del backend permite métodos y cabeceras con `*`, usa `allow_credentials=True` y lee orígenes de `ALLOWED_ORIGINS`, separados por comas. El valor predeterminado del código es `*`; el valor efectivo de despliegue no se verificó. Este cliente omite credenciales/cookies. CORS no elimina las restricciones de contenido mixto.
- No hay autenticación en estos routers. El frontend no incorpora claves, credenciales de RDS ni secretos.
- Hay **26 operaciones REST propias y un endpoint WebSocket**: nueve GET, nueve POST, cuatro PUT y cuatro DELETE. No se cuentan las páginas automáticas de documentación/OpenAPI.

## REST utilizado por el frontend

Todas las rutas son relativas a la base. Un error FastAPI puede responder `{"detail":"mensaje"}` o `{"detail":[...]}`; los datos inválidos se rechazan con 422. Las mutaciones usan POST y nunca se reintentan automáticamente.

| Método y ruta | Entrada | Respuesta aceptada |
| --- | --- | --- |
| `GET /health` | Sin cuerpo | 200: `{"status":"ok","db":"nombre"}` |
| `GET /vehiculos/{id_vehiculo}` | ID entero | 200: objeto vehículo; 404 si no existe |
| `GET /comandos/vehiculo/{id_vehiculo}` | ID entero | 200: arreglo de comandos |
| `GET /demos/vehiculo/{id_vehiculo}` | ID entero | 200: arreglo de filas de demos |
| `GET /demos/{id_demo}/movimientos` | ID entero | 200: arreglo de pasos; puede estar vacío |
| `GET /demos/{id_demo}/estado-ejecucion` | ID entero | 200: `{"id_demo":1,"id_vehiculo":1,"corriendo":false}`; 404 si no existe/está inactiva |
| `POST /vehiculos/{id_vehiculo}/comando-manual` | `{"id_comando":1,"origen":"MANUAL"}` | 201: respuesta manual descrita abajo; 400 para comando ajeno/inactivo |
| `POST /demos/{id_demo}/ejecutar` | Sin cuerpo | 202: respuesta de inicio descrita abajo; 404 demo inexistente/inactiva, 400 plan inválido/vacío, 409 ya en ejecución |
| `POST /demos/{id_demo}/detener` | Sin cuerpo | 200: `{"ok":true,"id_demo":1,"detenido":true,"estaba_corriendo":true}`; 404 demo inexistente/inactiva |

Vehículo (`VehiculoOut`): `id_vehiculo`, `nombre`, `modelo`, `descripcion`, `microcontrolador`, `fecha_registro`, `activo`. Los cuatro últimos campos de texto del modelo, salvo `nombre`, admiten null donde lo indica el esquema: `modelo`, `descripcion`, `microcontrolador`.

Comando (`ComandoOut`): `id_comando`, `id_vehiculo`, `nombre`, `codigo`, `descripcion` (nullable), `activo` (booleano). El catálogo filtra activos del vehículo seleccionado y nunca supone que ID y código sean iguales. Las direcciones se buscan por los nombres `AVANZAR`, `RETROCEDER`, `GIRAR_IZQUIERDA`, `GIRAR_DERECHA` y `DETENER`, normalizando mayúsculas, tildes, espacios y guiones. No se crean IDs de reserva. Una dirección ausente o ambigua queda en null; los otros comandos activos son auxiliares.

Las listas de demos y movimientos **no tienen `response_model`**: devuelven las filas del procedimiento almacenado tal cual. La lista de demos debe aportar como mínimo `id_demo` para seleccionarla; nombre/descripcion/activo dependen de esas filas. Para ejecutar, el runner requiere en cada paso `id_comando`, `orden`, `duracion_ms` (1–60000) y `pausa_ms` (0–60000, predeterminado 0); añade al evento el código y nombre consultados en el catálogo. No existe `GET /demos/{id_demo}`; el detalle se compone con la lista, movimientos y estado-ejecucion. No se han podido confirmar campos adicionales de los procedimientos mediante respuestas del despliegue.

Respuesta manual:

```json
{"ok":true,"id_vehiculo":1,"id_comando":1,"codigo":4,"nombre":"AVANZAR","origen":"MANUAL","id_evento":"00000000-0000-4000-8000-000000000001","estado":{"id_vehiculo":1,"vehiculo":"Excavadora","id_comando":1,"comando":"AVANZAR","codigo":4,"conectado":true,"fecha_actualizacion":"2026-11-06T12:00:00"}}
```

Los números del ejemplo son ilustrativos; se usan siempre los obtenidos del catálogo. Cada POST manual aceptado genera un UUID nuevo, aunque repita el mismo comando. Primero cancela y espera las demos activas del vehículo; después actualiza estado e historial y emite el evento MANUAL. `origen` del cuerpo etiqueta el historial; el evento siempre usa `MANUAL`. Un 201 confirma aceptación y publicación por la API, **no es un acuse físico del ESP8266**. Un timeout o cancelación del navegador tampoco demuestra que el servidor no haya recibido la orden.

Respuesta de inicio:

```json
{"ok":true,"id_demo":1,"id_vehiculo":1,"total_movimientos":3,"corriendo":true,"id_ejecucion":"00000000-0000-4000-8000-000000000002"}
```

La ejecución es asíncrona; no se espera a que terminen los pasos. Una demo nueva cancela otras del mismo vehículo. Cancelar una demo ya parada devuelve 200 y `estaba_corriendo:false`, pero no emite una nueva parada física. Para una parada manual se envía el comando `DETENER` del catálogo mediante `comando-manual`.

## WebSocket de observación

Se abre `/ws/demos/{id_demo}` para una demo activa que pertenezca al vehículo seleccionado. La primera trama debe ser:

```json
{"tipo":"bienvenida","origen":"TELEMETRIA","id_demo":1,"id_vehiculo":1,"corriendo":false,"estado":null}
```

`estado` puede ser null o el objeto de estado mostrado en el ejemplo manual. El backend envía bienvenida y registra al suscriptor bajo el mismo bloqueo; las órdenes deben habilitarse después de recibirla. La conexión abierta del navegador por sí sola no demuestra que la suscripción esté lista.

| `tipo` | `origen` | Campos |
| --- | --- | --- |
| `bienvenida` | `TELEMETRIA` | `id_demo`, `id_vehiculo`, `corriendo`, `estado` |
| `estado` manual | `MANUAL` | `id_vehiculo`, `id_evento` UUID, `estado` |
| `estado` de demo | `DEMO` | `id_vehiculo`, `id_ejecucion`, `estado` |
| `estado` de telemetría | `TELEMETRIA` | `id_vehiculo`, `estado` |
| `inicio` | `DEMO` | Metadatos de demo + `total_movimientos` |
| `comando` | `DEMO` | Metadatos + `orden`, `id_comando`, `codigo`, `nombre`, `duracion_ms` |
| `pausa` | `DEMO` | Metadatos + `orden`, `duracion_ms` de pausa |
| `fin`, `cancelado` | `DEMO` | Metadatos de demo |
| `error` | `DEMO` o `TELEMETRIA` | `detalle`; metadatos si procede de demo |
| `pong` | `TELEMETRIA` | Sin datos adicionales |

Metadatos de demo: `id_demo`, `id_vehiculo`, `id_ejecucion` UUID. Los snapshots `estado` de DEMO/TELEMETRIA describen estado; no representan una nueva orden manual. Los movimientos manuales llegan a todas las salas de demos activas del vehículo; los eventos de una demo se publican en su sala.

`DemoSocket` solo recibe: **nunca envía `accion:estado`**, que escribiría la BD. El backend también admite un ping JSON y responde pong, pero este cliente no lo necesita ni lo emite. No se inicia o cancela la demo mediante WS. La conexión se cierra con código 1008 si la demo no existe/está inactiva. La reconexión usa espera progresiva de 1 a 15 segundos con variación aleatoria, exige una bienvenida nueva e ignora callbacks de sesiones anteriores. Descarta tramas binarias, JSON inválido, objetos desconocidos, IDs de otro vehículo/demo y tramas de más de 64 KiB.

## Tres indicadores y límites de la información

1. **API HTTP**: `/health` responde. Este endpoint no ejecuta SQL ni ping a RDS.
2. **Canal WS**: se recibió bienvenida válida. Solo confirma la suscripción del navegador a la API.
3. **BD/RDS**: no hay `/ready`, `/readiness` ni endpoint específico de diagnóstico RDS. Una lectura de catálogo/vehículo satisfactoria permite indicar «lectura de BD correcta» con su momento de comprobación; no se debe presentar como supervisión independiente o continua de RDS. Un fallo de red/CORS tampoco identifica por sí solo un fallo de BD.

El campo `estado.conectado` no es un latido fiable del ESP8266: un POST manual y los pasos de demo escriben `conectado=true` en la API. El frontend puede mostrarlo como dato informado, sin convertirlo en confirmación de que el motor se movió o de que la placa está en línea.

## Módulos de servicios

- `createApi(config, {fetchImpl})`: `health()`, `vehicle()`, `commands()`, `demos()`, `movements(id)`, `demoStatus(id)`, `manual(id,{signal})`, `startDemo(id,{signal})`, `stopDemo(id,{signal})`.
- `ApiError`: propiedades `kind`, `status`; categorías `config`, `mixed-content`, `timeout`, `aborted`, `network`, `http`, `invalid-response`. Construir el cliente no conecta; los errores se rechazan al llamar a un método.
- `buildCatalog(commands, vehicleId)`: `{directions:{forward,backward,left,right,stop}, auxiliary, byId:Map}`.
- `DemoSocket(config,{WebSocketImpl,onStatus,onEvent,onReady})`: `connect(id)` devuelve booleano, `disconnect()`; estados `connecting`, `online`, `reconnecting`, `offline`. `onStatus(estado,detalle)` puede incluir `error` y `retryInMs`; `onReady(bienvenida)` se invoca solo tras validar vehículo y demo. La instancia no conecta al construirse.

Las pruebas de integración del frontend deben inyectar fetch/WebSocket simulados y no conectarse con vehículos reales.
