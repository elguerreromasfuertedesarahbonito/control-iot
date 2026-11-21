# Asistente de texto y voz

El asistente añade una conversación sobre las funciones existentes de Terra. El texto reconocido o escrito se interpreta en el backend; una respuesta estructurada se valida antes de utilizar el coordinador de CONTROL o consultar los recursos de MONITOREO. El navegador no recibe la clave del proveedor de IA y no ejecuta código, SQL ni direcciones arbitrarias propuestos por el modelo.

La tabla siguiente corresponde a la primera validación local del asistente, el **18 de noviembre de 2026**. La ampliación de duración por voz se documenta en las secciones de uso y despliegue.

| Comprobación de esta actualización | Resultado y alcance |
| --- | --- |
| Pruebas frontend | **132/132 aprobadas**, con transportes, reconocimiento y temporizadores sustituidos; no utilizan micrófono ni hardware reales. |
| Pruebas backend | **57/57 aprobadas**, incluidas 24 del asistente, con dobles de BD y proveedor. |
| Interfaz local | Chat revisado en 320×480, 390×844, 844×390, 915×240 y 1280×900 CSS px. El documento cabe exactamente en el viewport, el diálogo queda dentro y los controles de cerrar, DETENER, micrófono y enviar tienen al menos 44 px. La consulta normal no muestra el formulario administrativo. |
| API local con RDS real | El proceso local en el puerto 8001 arrancó y `GET /estado/1` devolvió el estado real DETENER. Esta lectura no genera una orden. |
| Modelo configurado | La consulta real de metadatos devolvió HTTP 200 para `gemini-3.5-flash`. Una llamada real `generateContent` con un catálogo **de prueba** devolvió HTTP 200, `finishReason=STOP` y la acción validada `comando`, ID 42 y 1000 ms para «avanza». No se ejecutó esa acción ni se escribió en BD. |
| Contexto completo de integración | Algunos intentos de interpretación con el catálogo/estado completos devolvieron indisponibilidad 503 o agotaron el tiempo de espera del proveedor. La configuración de pensamiento mínimo y el esquema final están implementados; esos fallos no demuestran una clave incorrecta ni invalidan la identificación del modelo. |
| Producción | OpenAPI de EC2 respondió HTTP 200, pero no incluye todavía `/asistente/interpretar`. Se requiere desplegar el backend actualizado. No se hizo commit/push de esta etapa. |

La revisión de tamaños de navegador no equivale a un teléfono físico. El micrófono real, los permisos de un dispositivo concreto, una operación física y el asistente desplegado siguen pendientes. El resultado de integración completa es provisional hasta registrar su verificación final.

## Uso y alcance

Abrir el panel del asistente y escribir una solicitud concreta sobre el vehículo seleccionado. La voz es una entrada alternativa: el resultado reconocido se muestra como texto y utiliza la misma lógica que el formulario.

### Respaldo de voz en computadora

El chat intenta primero el reconocimiento del navegador. Si este reporta un error de red o de disponibilidad, el chat pide pulsar nuevamente el micrófono. Ese siguiente gesto inicia una grabación con `MediaRecorder`. Se puede tocar para iniciar y terminar o mantener pulsado y soltar. Si el navegador carece de reconocimiento nativo, el chat muestra directamente la opción de grabación.

Al finalizar la grabación, FastAPI recibe el audio en `POST /asistente/transcribir` y Gemini devuelve el texto. La clave sigue en EC2. El chat cancela la grabación al cerrar el cuadro, usar DETENER o cambiar de pestaña.

Para instalar la corrección sobre una instalación que ya usa el chatbot, copia `app/routers/asistente.py` y `app/services/assistant_audio.py` a la API de EC2 y reinicia FastAPI. Luego actualiza GitHub Pages con los archivos modificados en `assets/`. Verifica que `POST /asistente/transcribir` aparezca en Swagger antes de probar el micrófono. En la computadora, dicta «estado» y comprueba que aparezca la respuesta del vehículo.

Ejemplos de intención, sujetos al catálogo real:

- «Avanza un segundo» o «sube el brazo» para solicitar un movimiento admitido.
- Por voz, «avanza durante cinco segundos» para pedir una duración explícita de hasta diez segundos en un vehículo habilitado.
- «Detén la excavadora» para solicitar la parada prioritaria.
- «¿Qué comandos hay?» o «¿Cuál es el último estado?» para consultar la información disponible.
- «Ejecuta la demo 1» para solicitar una DEMO existente.
- «Crea un comando…» o «Elimina el comando…» para preparar una propuesta administrativa que deberá confirmarse.

Los ejemplos no crean nombres, IDs ni capacidades nuevas. Si el catálogo no permite identificar la función o la solicitud es ambigua, el asistente debe pedir precisión o rechazarla. La IA no convierte una frase en prueba de ejecución física.

Las tres evidencias siguen siendo distintas: **solicitud enviada**, **aceptación HTTP** y **evento WebSocket recibido**. El estado informado, la publicación del evento y una explicación del bot no prueban que se movió un motor.

## Arquitectura

```text
Texto o transcripción final
  → POST /asistente/interpretar
  → backend: catálogo real + atajo exacto o Gemini + validación
  → acción estructurada admitida
  → frontend: coordinador de CONTROL o consulta de MONITOREO

Propuesta de creación/eliminación
  → resumen visible y confirmación explícita
  → POST /asistente/confirmar con sesión de administrador
  → validación y escritura autorizada en el backend
```

El panel reutiliza el vehículo configurado y los servicios existentes. Los movimientos y las DEMO no se ejecutan enviando frases por WebSocket. El canal WSS conserva su función de notificación; el texto del modelo no sustituye los eventos del servidor.

```text
control-iot/assets/js/chatbot/
  contracts.js    acciones admitidas, validación y STOP explícito
  session.js      conversación, peticiones, confirmación y respuestas tardías
  view.js         diálogo, mensajes como texto y formularios
  voice.js        entrada de voz y ciclo de permisos/cancelación
  pulse.js        pulsación manual acotada y propiedad del control

vehiculo-iot-api/app/
  assistant_schemas.py     contratos estrictos de solicitud y acción
  routers/asistente.py    interpretar y confirmar
  services/assistant.py   proveedor, catálogo real y confirmaciones acotadas
```

La salida solicitada a Gemini utiliza un esquema plano compatible con el proveedor; el backend vuelve a validar el resultado contra la unión estricta de acciones Pydantic. La forma externa de la respuesta al navegador sigue siendo la descrita abajo. No se aceptan herramientas ni alias de acciones inventados por el modelo.

## Contrato añadido a la API

### Interpretación

`POST /asistente/interpretar` recibe un mensaje y un UUID de solicitud. Para una transcripción de voz, el frontend añade `"entrada": "voz"`.

```json
{
  "id_vehiculo": 1,
  "mensaje": "Avanza un segundo",
  "request_id": "3f5d80ef-8096-45b2-949a-5e8435c06e54"
}
```

El mensaje admite entre 1 y 2000 caracteres. La respuesta conserva `request_id`, aporta un mensaje para el usuario y una `accion` con un `tipo` permitido. Los IDs deben pertenecer a los datos reales del vehículo.

| `accion.tipo` | Datos y efecto autorizado |
| --- | --- |
| `comando` | `id_comando` real y `duracion_ms`. El valor predeterminado es 1000 ms. La voz permite hasta 10 000 ms con una duración explícita y un vehículo habilitado. |
| `detener` | ID real de DETENER; utiliza la parada prioritaria. |
| `demo` | `id_demo` real; solicita la ejecución mediante el coordinador. |
| `estado`, `historial`, `catalogo` | Consulta el recurso correspondiente del vehículo. |
| `respuesta` | Explicación o petición de precisión, sin actuación. |
| `crear_comando` | Propuesta `comando` con vehículo, nombre, código y descripción opcional; necesita confirmación. |
| `eliminar_comando` | Propuesta con `id_comando`; necesita confirmación. |

No todos los campos aparecen en todas las respuestas. Cada petición produce como máximo una acción; el bot no inventa secuencias ejecutadas por el navegador. Crear o eliminar son propuestas durante la interpretación; solo la confirmación autorizada puede escribirlas. Una solicitud ambigua puede responder con una pregunta sin preparar una operación.

Una solicitud administrativa puede añadir:

```json
{
  "confirmacion": {
    "token": "TOKEN-OPACO-GENERADO-POR-EL-BACKEND",
    "resumen": "Resumen exacto de la operación pendiente",
    "expira_en_segundos": 120
  }
}
```

El texto del token es ilustrativo. El cliente utiliza el valor devuelto por el servidor y no fabrica una confirmación. La implementación prepara propuestas con vigencia de **120 segundos**; recibir la propuesta no significa que la escritura se haya realizado.

### Confirmación administrativa

`POST /asistente/confirmar` recibe el token pendiente, el ID de solicitud y la sesión autenticada de un administrador en la cabecera `Authorization`.

```json
{
  "token": "TOKEN-OPACO-RECIBIDO",
  "request_id": "fa23568a-d1ec-4da5-8655-a51f58d80dca"
}
```

Antes de confirmar, revisa el resumen del objeto, vehículo y operación. Cancelar o dejar vencer una propuesta evita la escritura. El token de confirmación caduca y se usa una sola vez.

Una vez enviado el POST de confirmación, cerrar el diálogo o abortar Fetch **no deshace la escritura**. El panel advierte esa posibilidad; no debe declarar «no se modificó» por un cierre, un timeout o un 503 cuyo resultado sea incierto. Durante la confirmación se deshabilita Cancelar y, si vence la propuesta mientras el POST ya está en curso, se espera su resultado. Ante pérdida de conexión, consultar el catálogo antes de volver a crear o eliminar.

Consultar, mover, detener y solicitar una DEMO siguen las reglas de acceso y reserva de la unidad. La confirmación adicional se limita a crear o eliminar comandos.

Una propuesta administrativa requiere intención explícita de creación o eliminación. Una negación no debe abrir el formulario de clave. Los mensajes que parecen contener una clave o contraseña se rechazan antes de consultar Gemini/BD; la clave solo se introduce en su campo específico y nunca por voz o en la conversación.

El `request_id` permite deduplicar la misma solicitud dentro de la retención del backend. Para reintentar una operación incierta se conserva la identidad anterior; una intención nueva utiliza otra. Los resultados y confirmaciones se conservan durante **120 segundos**, con cachés acotadas a **256 entradas**. El límite predeterminado es **15 peticiones por IP y minuto** y como máximo **3 interpretaciones del proveedor concurrentes**. Son protecciones en memoria del proceso y se pierden al reiniciarlo: no equivalen a idempotencia persistente entre servidores.

## Movimiento, duración y prioridad de parada

El asistente no controla las salidas directamente. Una intención válida se entrega al mismo coordinador que usan joysticks y botones:

- Solo puede quedar activa una función lógica admitida del catálogo.
- Las órdenes del asistente sin duración conservan el pulso de **1000 ms**. Para una orden de voz extendida, la API envía `duracion_ms` en el evento WSS y el ESP8266 libera las salidas al vencer su temporizador local. Las DEMO usan las duraciones de sus pasos.
- Una orden nueva, una cancelación y la parada deben respetar la exclusión y la propiedad de la entrada manual.
- **DETENER y Escape tienen prioridad** sobre la conversación, una respuesta del modelo pendiente o una transcripción tardía.
- Una respuesta antigua no puede iniciar otra acción después de detener, cerrar o invalidar esa interacción.

El temporizador del ESP8266 empieza cuando aplica la salida y conserva el intervalo de liberación entre órdenes. Para una orden extendida, la espera visual del navegador empieza con la aceptación HTTP y su vencimiento solo actualiza la interfaz. La aceptación HTTP confirma que la API recibió y procesó la solicitud. La ejecución física requiere una comprobación en la placa.

Abortar una petición del navegador no revierte una operación ya aceptada por FastAPI. Si el estado de una orden queda incierto, el panel debe indicar esa incertidumbre y permitir la parada; no declarar «cancelado» únicamente porque se canceló Fetch.

## Voz y micrófono

La entrada de voz requiere una función de reconocimiento compatible en el navegador y el permiso del micrófono. Utilizar HTTPS en la página publicada; en desarrollo local pueden aplicarse las excepciones de contexto seguro del navegador.

El módulo `assets/js/chatbot/voice.js` usa `SpeechRecognition` o su variante `webkitSpeechRecognition` cuando está disponible:

- Al pulsar empieza a escuchar para no perder las primeras palabras.
- Un toque de menos de **280 ms** mantiene la escucha; otro toque la termina.
- Mantener pulsado al menos **280 ms** y soltar termina la escucha. Enter o Espacio permiten alternarla por teclado.
- Al finalizar se entrega una sola transcripción agregada de resultados **finales**, en `es-MX` y con un máximo de **1000 caracteres**. Los fragmentos provisionales no envían comandos.
- A los **30 segundos** se solicita el fin de la escucha. Si el navegador no cierra en **2 segundos**, se aborta sin enviar una transcripción incierta.

Soltar después de dictar finaliza la escucha y permite interpretar el texto final; cancelar el gesto descarta la transcripción. Esta interacción no sustituye el botón DETENER ni el límite de la pulsación manual.

Al cancelar la escucha, perder el foco, ocultar la pestaña o solicitar DETENER se deben invalidar los resultados antiguos. Si el navegador no ofrece reconocimiento o el usuario deniega el micrófono, el formulario de texto continúa disponible. No se debe mostrar una transcripción simulada como si procediera del micrófono.

La compatibilidad y el comportamiento de permiso varían entre navegadores y dispositivos. El reconocimiento puede depender de un servicio del navegador; esta implementación no debe describirse como transcripción totalmente local u operación sin conexión salvo verificación específica.

## Configuración privada del backend

La API carga `.env` y después el archivo privado `.env.gemini`, separado del frontend y excluido de Git. Las variables son:

```text
GEMINI_API_KEY=CLAVE-PRIVADA-DEL-PROVEEDOR
GEMINI_MODEL=gemini-3.5-flash
GEMINI_THINKING_LEVEL=minimal
ASSISTANT_ADMIN_KEY=CLAVE-ADMINISTRATIVA-PRIVADA
GEMINI_TIMEOUT_SECONDS=20
ASSISTANT_RATE_LIMIT_PER_MINUTE=15
ASSISTANT_MAX_CONCURRENT=3
```

Las claves anteriores son marcadores, no credenciales. Los demás valores corresponden a los predeterminados de la implementación. La consulta de metadatos indicada al inicio no garantiza cuotas ni disponibilidad en cada petición. Mantener la configuración pública de `control-iot/assets/js/config.js` libre de estas variables.

`GEMINI_THINKING_LEVEL` admite `minimal`, `low`, `medium` o `high`; el valor predeterminado `minimal` reduce el trabajo de razonamiento solicitado para esta clasificación simple. La interpretación del frontend dispone de **45 segundos** (`assistantTimeoutMs`), mientras las peticiones ordinarias conservan **8 segundos** (`requestTimeoutMs`). El límite del proveedor es independiente y se configura con `GEMINI_TIMEOUT_SECONDS=20`; ningún timeout debe activar una acción alternativa.

No enviar `.env`, `.env.gemini`, tokens, volcados de configuración ni claves dentro de ZIP, capturas o commits. Una entrada en `.gitignore` no retira un secreto ya seguido por Git: antes de preparar un commit comprobar los nombres con `git ls-files -- .env .env.gemini`, sin imprimir su contenido. Si aparece alguno, resolver su seguimiento y la gestión de la clave expuesta antes de publicar.

El `.env.gemini` local de esta configuración se guardó como archivo privado ignorado. No se incluye en el repositorio del frontend ni en el paquete de fuentes para trasladar a EC2; sus valores deben configurarse por separado en el servidor.

La clave administrativa protege las confirmaciones de creación/eliminación del bot y también la creación directa `POST /comandos` y la eliminación directa `DELETE /comandos/{id_comando}`. **No proporciona autenticación global a la API:** la actualización `PUT /comandos/{id_comando}` conserva su contrato anterior y los otros CRUD no se convierten en rutas protegidas por esta integración. El origen autorizado por CORS tampoco es una identidad ni una contraseña.

El proveedor interpreta datos de catálogo y mensajes, pero el backend debe validarlos como datos no confiables. No ejecutar instrucciones incrustadas en nombres de comandos, texto del usuario o respuesta del modelo; no admitir URLs de destino, SQL ni código ejecutable suministrados por la IA.

## Desplegar en EC2 Windows

1. Copiar las fuentes nuevas/modificadas del backend del asistente y el `requirements.txt` actualizado, conservando la configuración y certificados privados existentes. Los módulos nuevos son `app/assistant_schemas.py`, `app/routers/asistente.py` y `app/services/assistant.py`; también cambian la configuración, el registro del router y la protección de creación/eliminación en `app/routers/comandos.py`. Revisar la lista de entrega para excluir ambos archivos `.env`.
2. Activar el entorno virtual utilizado por el servicio e instalar sus dependencias desde la carpeta de la API:

   ```powershell
   python -m pip install -r requirements.txt
   ```

3. Crear o actualizar `.env.gemini` **dentro del servidor**, con la clave del proveedor y la clave administrativa, sin enviarlas al repositorio del frontend.
4. Reiniciar la API con `python run.py`, manteniendo un único worker y `asyncio:SelectorEventLoop` en Windows. La nueva configuración no se aplica al proceso ya iniciado.
5. Mantener Caddy y el dominio HTTPS/WSS actuales. Si el asistente utiliza el mismo origen de API, el proxy general `reverse_proxy 127.0.0.1:8000` ya enruta las nuevas rutas; no necesita exponer otro puerto ni alojar un segundo backend.
6. Publicar solo las fuentes públicas del frontend. Comprobar que CORS permita `Authorization` y `Content-Type` para el origen real de Pages.

La instalación y el reinicio no prueban por sí mismos la integración con el proveedor. La clave ausente, un modelo no disponible, una cuota agotada o un timeout deben producir un error comprensible y no una acción de movimiento o una mutación inventada.

### Habilitar hasta diez segundos por voz

1. Actualiza primero FastAPI y conserva `ASSISTANT_TIMED_VEHICLE_IDS=` en el entorno del servidor. Después publica el frontend.
2. Cuando tengas la placa, reemplaza las cabeceras actualizadas junto a `ExcavadoraWiFi.ino`. Compila y carga el sketch con la configuración que ya usas para la NodeMCU ESP8266. Comprueba primero el botón DETENER con la excavadora inmovilizada.
3. En la configuración privada de EC2, establece `ASSISTANT_TIMED_VEHICLE_IDS=1` para el vehículo 1 y reinicia FastAPI. Dicta «avanza durante dos segundos» y comprueba la liberación. Después verifica diez segundos y una parada anticipada con DETENER.
4. Para deshabilitar la ampliación, deja el valor vacío y reinicia FastAPI.

## Integración local sin modificar las URLs públicas

Para utilizar expresamente el backend local que ya esté ejecutándose en el puerto 8001, abrir:

```text
http://localhost:4173/?localApi=1
```

El selector solo se admite cuando el frontend se sirve desde `localhost` o `127.0.0.1`. Cambia la base a `http://127.0.0.1:8001` y el canal a `ws://127.0.0.1:8001/ws/demos/{id_demo}`. Desde GitHub Pages, `localApi=1` se ignora y se conservan las URLs públicas HTTPS/WSS. Este modo **no es una simulación**: puede utilizar RDS y el proveedor reales, y los controles pueden enviar órdenes; usarlo solo en una sesión de prueba autorizada.

`?simulation=1` continúa siendo distinto: sustituye los servicios de CONTROL y el asistente indica que necesita la API real. No debe fingir una respuesta generada por Gemini.

Los errores esperados incluyen **403** para una clave administrativa ausente/incorrecta, **409** si se reutiliza un UUID con otro contenido o cambia el catálogo de una propuesta, **410** para una confirmación expirada/consumida, **429** por límite o cuota y **503** cuando una dependencia o configuración necesaria no está disponible. Una escritura con resultado incierto no debe repetirse a ciegas: consultar primero el catálogo.

Crear un comando en RDS **no añade su función física al firmware**. El catálogo y las máscaras de `ControlExcavadora.h` siguen requiriendo correspondencia con el circuito. No ofrecer movimiento físico para un comando recién creado sin esa integración y validación.

## Escenarios de aceptación y pendientes físicos

| Caso | Resultado que debe observarse |
| --- | --- |
| Orden de texto conocida | Una acción validada; misma coordinación de CONTROL, sin repetir el POST por texto provisional. |
| Solicitud ambigua o función inexistente | Petición de precisión o rechazo; ninguna orden inventada. |
| Respuesta lenta y DETENER/Escape | Parada prioritaria; la respuesta tardía no vuelve a activar el vehículo. |
| Pulso de voz extendido | Las órdenes de 5 y 10 segundos liberan la salida localmente. Una solicitud de 11 segundos se rechaza. DETENER puede interrumpirlas. |
| Vehículo sin firmware habilitado | Las solicitudes de más de un segundo se rechazan y las órdenes habituales siguen disponibles. |
| Transcripción final repetida | Una sola intención de ese gesto; no se duplica por eventos de voz. |
| Permiso denegado o navegador sin voz | Mensaje claro y alternativa de texto funcional. |
| Crear/eliminar sin clave o sin confirmación | No se ejecuta la mutación. |
| Token expirado o ya consumido | Rechazo sin segunda escritura. |
| Mismo `request_id` | Reutilización segura del resultado dentro de la retención, sin duplicar la operación. |
| Clave ausente, cuota o proveedor caído | Error acotado, sin secretos expuestos ni acción alternativa inventada. |
| Catálogo actualizado | UI resincronizada; ninguna promesa de soporte físico automático. |

Los resultados automatizados y de navegador indicados al inicio corresponden a la primera validación local. La consulta canónica «estado» respondió por HTTP con el estado real de RDS en la API local. Su respuesta está en `artifacts/chatbot-live-reading.json`. Gemini se probó con un catálogo aislado. Con el catálogo real se observaron errores 503 y timeout del proveedor. La duración extendida se comprobó localmente con datos de prueba. La verificación con micrófono, firmware cargado y hardware queda pendiente para esta ampliación.

## Referencias técnicas

- [Modelo Gemini 3.5 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash): referencia del identificador configurado; su disponibilidad efectiva depende del servicio y la cuenta.
- [Salida estructurada de Gemini](https://ai.google.dev/gemini-api/docs/structured-output): formato JSON y esquema del proveedor, complementado aquí por validación estricta en el backend.
- [Configuración de pensamiento de Gemini](https://ai.google.dev/gemini-api/docs/thinking): ajuste solicitado mediante `thinkingConfig`.
- [SpeechRecognition en MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition): compatibilidad y funcionamiento de la entrada de voz del navegador.


## Resultados de la primera implementación

- Frontend: **132/132 pruebas aprobadas**. Backend: **57/57**, incluidas las comprobaciones de espera de lecturas bloqueadas. Los transportes, micrófonos y escrituras de estas suites son dobles de prueba.
- El backend es híbrido: las frases exactas «avanza», «retrocede», «abre pala», «estado», «catálogo», «historial» y «ejecuta demo 1» se resuelven contra el catálogo actual sin esperar al proveedor. No se interpretan por coincidencias parciales. Las peticiones libres y las propuestas administrativas usan Gemini.
- Las lecturas del asistente tienen un límite configurable mediante `ASSISTANT_DATABASE_TIMEOUT_SECONDS=8`; una dependencia bloqueada no debe dejar una interpretación esperando indefinidamente. Gemini tiene su límite propio de 20 segundos; el cliente del asistente permite hasta 45 segundos. No se reintentan automáticamente movimientos o mutaciones.
- Durante la comprobación, la API local pudo leer el estado real; posteriormente también se observaron demoras de catálogo tanto en la API local como en la pública. Por ello no se atribuye al navegador una disponibilidad continua de RDS ni se afirma que toda demora provenga de Gemini.
- Esta ampliación permanece en los archivos locales: **no se hicieron commits ni push de estos cambios**. La activación requiere aplicar el backend en EC2 y publicar el frontend en el mismo Pages. La clave privada de Gemini se conserva en `.env.gemini`, ignorada y excluida del paquete.
- No se probó el micrófono físico, no se enviaron órdenes de movimiento reales y no se crearon/eliminaron comandos reales. Esas verificaciones quedan para una sesión operativa autorizada.
