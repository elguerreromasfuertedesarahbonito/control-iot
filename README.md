# Terra · Control IoT

Aplicación web de CONTROL de la excavadora para la actividad práctica 4.1. HTML semántico, CSS, Bootstrap 5.3.8 y módulos JavaScript nativos; reutiliza la API FastAPI existente y no incorpora otro backend.

Desarrollado por **Ricardo de Jesus Serrano Cortes · 2026**.

## Estado de esta entrega

El frontend está implementado, con **29 pruebas simuladas aprobadas** y revisión visual de escritorio/móvil. El usuario confirmó que **HTTPS y WSS funcionan** en `excavadora-iot-rsc.duckdns.org` con Caddy en EC2 Windows; esta disponibilidad fue informada por el usuario y no verificada de forma independiente por el asistente. Las URLs HTTPS/WSS ya están activadas en el cliente. **No se han enviado órdenes POST a AWS desde estas comprobaciones, no se ha probado movimiento físico ni se ha publicado o verificado GitHub Pages.** No se deben presentar capturas del modo simulado como evidencias de AWS, RDS, WebSocket real o movimiento físico. El alcance comprobado está en [validacion-local.md](docs/validacion-local.md).

## Ejecutar localmente

Requiere Node.js 24 o una versión compatible con `package.json`. No necesita instalar paquetes.

```powershell
cd control-iot
node tools/serve.mjs
```

Abre `http://localhost:4173/?simulation=1` para la simulación identificada en pantalla. Este modo no debe enviar solicitudes al servidor real.

Para ejecutar las pruebas automáticas:

```powershell
node --test tests/*.test.js
```

Las direcciones públicas ya están configuradas en `assets/js/config.js`: API `https://excavadora-iot-rsc.duckdns.org` y WebSocket `wss://excavadora-iot-rsc.duckdns.org/ws/demos/{id_demo}`. Abrir `http://localhost:4173/` sin el parámetro de simulación utiliza esos servicios reales; los controles pueden enviar órdenes al backend. Las pruebas locales documentadas se realizaron con servicios simulados.

## Arquitectura y archivos

```text
Control táctil/teclado
  → coordinador de órdenes y prioridad DETENER
  → Fetch / API FastAPI existente en EC2
  → respuesta HTTP y eventos WebSocket del backend
  → evidencia de la última acción en la interfaz
```

```text
control-iot/
  index.html                       interfaz y controles semánticos
  assets/
    favicon.svg                    favicon original del proyecto
    css/styles.css                 diseño Mobile First y estados accesibles
    vendor/bootstrap.min.css       Bootstrap local, sin depender de un CDN al operar
    js/
      app.js                       composición de módulos y representación del DOM
      config.js                    configuración pública, sin secretos
      api.js                       Fetch, contratos, errores y límites de espera
      catalog.js                   catálogo real y correspondencia de direcciones
      socket.js                    sesión WebSocket y reconexión
      coordinator.js               exclusión de operaciones y prioridad DETENER
      joystick.js                  Pointer Events, teclado y retorno a neutral
      simulation.js                servicios simulados, separados de la integración real
  tools/serve.mjs                   servidor estático de desarrollo
  tests/                           pruebas locales con servicios sustituidos
  deploy/Caddyfile                 configuración del proxy HTTPS/WSS del dominio
  docs/
    api-contract.md                contrato comprobado en las fuentes del backend
    pruebas.md                     pruebas A–E y comprobación externa WebSocket
    despliegue-ec2-windows.md       preparación de DuckDNS y Caddy en EC2 Windows
    entrega.md                     plantilla de contenido para el informe institucional
  .github/workflows/pages.yml       pruebas y publicación del frontend
```

El joystick y los botones utilizan el mismo coordinador. Este descarta movimientos pendientes al solicitar DETENER y evita que una respuesta antigua restaure la indicación de movimiento. Si una operación ya estaba en vuelo, puede necesitar una cancelación o una parada final: abortar Fetch no cancela una operación aceptada en el servidor. No se reintentan automáticamente los movimientos.

Las DEMO se consultan e inician en el backend; el navegador no reproduce una secuencia fija ni crea registros individuales de sus pasos. No hay pantallas de historial, gráficas, administración ni edición de catálogos.

## Configuración de la API

El contrato completo está en [docs/api-contract.md](docs/api-contract.md). El proyecto conserva por separado:

| Indicador | Qué permite afirmar |
| --- | --- |
| WebSocket del navegador | La sesión recibió una bienvenida válida del vehículo y la DEMO seleccionados. No demuestra presencia del ESP8266. |
| API AWS · 21 servicios | La operación de salud configurada respondió; no significa que se probaron todas las operaciones. |
| Amazon RDS | **Sin verificar**: el `/health` actual devuelve `status` y el nombre de la BD, pero no consulta RDS. |

El texto «21 servicios» corresponde al enunciado. La copia actual del backend contiene 26 operaciones REST propias, según la auditoría del contrato; el frontend utiliza solo las necesarias para CONTROL.

GitHub Pages proporciona HTTPS al frontend, pero no convierte las direcciones `http://` y `ws://` de EC2 en conexiones seguras. El cliente ya utiliza la API HTTPS y el canal WSS cuya disponibilidad confirmó el usuario. La configuración de DuckDNS y Caddy, junto con el ajuste de CORS que debe comprobarse para Pages, se explica en [despliegue-ec2-windows.md](docs/despliegue-ec2-windows.md).

No agregues tokens de DuckDNS, claves AWS, credenciales RDS ni secretos a `config.js`. El navegador no se conecta directamente a MySQL. Los datos remotos se representan como texto, no como HTML ejecutable. CORS no equivale a autenticación; la API actual no contiene autenticación en sus routers.

## Git y GitHub Pages

Usa un repositorio independiente para este frontend; no subas la carpeta completa del proyecto IoT ni el backend. El nombre propuesto es `control-iot` bajo la cuenta `elguerreromasfuertedesarahbonito`. El [repositorio de API indicado por el alumno](https://github.com/elguerreromasfuertedesarahbonito/Vehiculo-iot-api) se mantiene separado.

Cuando las pruebas locales estén listas, crea el repositorio frontend en GitHub, configura su remoto y sube los commits. En **Settings → Pages → Build and deployment**, selecciona **GitHub Actions**. El workflow incluido prueba el código y publica únicamente `index.html`, `assets/` y `.nojekyll`.

La URL propuesta, todavía **no publicada ni verificada**, es `https://elguerreromasfuertedesarahbonito.github.io/control-iot/`. Todas las referencias de recursos son relativas para funcionar bajo esa subruta. La guía oficial de [workflows de GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages) explica la configuración de publicación.

Antes de presentar la práctica, completa las [pruebas y evidencias](docs/pruebas.md), confirma la página desde un teléfono real y prepara el Word/PDF siguiendo [la plantilla de entrega](docs/entrega.md). Ya se proporcionaron los datos institucionales: Instituto Tecnológico de Pachuca (ITP), Ingeniería en Sistemas Computacionales, docente Víctor Pinedo Fernández, fecha de entrega 10/11/2026 y logotipo. El informe sigue siendo un borrador, con evidencias reales pendientes.
