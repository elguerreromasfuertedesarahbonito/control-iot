# Preparar HTTPS/WSS en EC2 Windows con DuckDNS y Caddy

Esta guía prepara la integración elegida; **no se ejecutaron cambios en EC2, DNS, firewall ni CORS**. El subdominio DuckDNS aún no fue proporcionado. El frontend sigue en pruebas simuladas.

## Por qué hace falta

GitHub Pages cifra la descarga del frontend. La página realiza otra conexión hacia la API de EC2 y abre un WebSocket independiente: ambos también necesitan transporte seguro. La dirección HTTP/WS utilizada anteriormente no obtiene un certificado al publicar el frontend.

[DuckDNS](https://www.duckdns.org/faqs.jsp) proporciona un nombre gratuito. [Caddy](https://caddyserver.com/docs/quick-starts/https) puede gestionar el certificado y actuar como proxy hacia el FastAPI existente. Esto no elimina los posibles costos de la instancia EC2 ya utilizada.

```text
GitHub Pages HTTPS
  → API pública HTTPS / canal WSS
  → Caddy en EC2, puerto 443
  → FastAPI existente, http://127.0.0.1:8000
  → RDS mediante la configuración privada existente
```

## 1. Registrar el nombre y verificar DNS

Entra en DuckDNS, inicia sesión y registra un subdominio disponible. Asócialo a la IP pública **actual** de EC2. La IP usada antes fue `32.194.155.66`; compruébala en AWS antes de configurarla. Un cambio de IP requiere actualizar DNS; una IP elástica puede tener costos según la cuenta y el uso.

No pegues el token de DuckDNS en el frontend, el repositorio, una captura ni este documento. Para continuar basta compartir el nombre público completo, por ejemplo `TU-SUBDOMINIO.duckdns.org`, reemplazando el marcador por el nombre realmente registrado.

## 2. Preparar el acceso a Caddy

Descarga Caddy para Windows desde [su sitio oficial](https://caddyserver.com/download). En EC2, verifica que ninguna otra aplicación esté usando los puertos requeridos. Configura el grupo de seguridad de AWS y el firewall de Windows para que Caddy pueda recibir tráfico público TCP en **80 y 443**, siguiendo las políticas de tu instancia. Estos cambios deben hacerse en el servidor; esta guía no los ha realizado.

El puerto 80 permite los desafíos/redirects previstos por la configuración automática habitual y el 443 sirve HTTPS/WSS. No expongas RDS al navegador ni cambies sus credenciales para habilitar el frontend.

## 3. Conservar el backend y añadir el proxy

Mantén la API existente y su entorno privado. En este servidor Windows debe conservarse `python run.py`, el bucle `asyncio:SelectorEventLoop` ya corregido y **un único worker**: las DEMO y suscripciones están en memoria del proceso.

Copia `deploy/Caddyfile.example` a un archivo llamado `Caddyfile` junto al ejecutable de Caddy. En la terminal de EC2, reemplaza el marcador por el nombre registrado:

```powershell
$env:IOT_HOSTNAME = 'TU-SUBDOMINIO.duckdns.org'
.\caddy.exe validate --config .\Caddyfile --adapter caddyfile
.\caddy.exe run --config .\Caddyfile --adapter caddyfile
```

La variable debe existir también en la cuenta del servicio si luego configuras Caddy como servicio persistente. Guarda sus certificados/datos de forma persistente para permitir la renovación. No uses un certificado autofirmado ni desactives la validación TLS en el navegador.

El [proxy de Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) maneja la actualización WebSocket. No hace falta crear otra ruta FastAPI ni ejecutar un segundo backend. Las URLs esperadas, todavía pendientes de verificar, serán:

```text
https://HOST-REAL/health
https://HOST-REAL/docs
wss://HOST-REAL/ws/demos/1
```

Verifica HTTPS/WSS antes de ajustar la exposición del puerto 8000. Una vez funcionando el proxy, restringe el acceso público directo a 8000 conforme al despliegue previsto; el tráfico público debe entrar por Caddy. Ten en cuenta cualquier cliente antiguo que todavía use HTTP/WS antes de retirar ese acceso. Esta actividad no conecta el microcontrolador.

## 4. Autorizar el origen del frontend en CORS

La configuración existente del backend lee `ALLOWED_ORIGINS`. El origen no contiene la subruta del repositorio. La propuesta para este proyecto es:

```text
ALLOWED_ORIGINS=https://elguerreromasfuertedesarahbonito.github.io,http://localhost:4173,http://127.0.0.1:4173
```

Aplica el valor en la configuración privada de EC2 y reinicia el proceso de la API cuando autorices esa etapa. No copies el `.env` de EC2 al repositorio. Revisa que POST y la cabecera `Content-Type` estén permitidos por la configuración existente; CORS no proporciona autenticación ni sustituye HTTPS.

## 5. Configurar el frontend

Cuando el nombre público y el certificado se hayan verificado, modifica únicamente las URLs públicas de `assets/js/config.js`:

```js
apiBaseUrl: 'https://HOST-REAL',
wsUrlTemplate: 'wss://HOST-REAL/ws/demos/{id_demo}',
```

No añadas `:8000` a la URL pública de Caddy si utilizas el puerto HTTPS estándar. Conserva los IDs y rutas reales del contrato. El cliente no debe obtener ninguna credencial de RDS.

`GET /health` del backend actual devuelve estado de API y nombre de BD, pero no verifica una conexión con RDS. Por tanto, Amazon RDS debe seguir en **Sin verificar**; no inventes un endpoint `/ready` ni interpretes un nombre de BD como comprobación de disponibilidad.

Después de autorizar pruebas reales, completa la guía [pruebas.md](pruebas.md) desde la página publicada y un cliente WSS externo. Un cambio de configuración no cuenta como una prueba superada.
