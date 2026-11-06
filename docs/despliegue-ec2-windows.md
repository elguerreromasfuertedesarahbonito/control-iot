# Preparar HTTPS/WSS en EC2 Windows con DuckDNS y Caddy

Esta guía prepara la integración elegida; **no se ejecutaron cambios en EC2, DNS, firewall ni CORS desde el asistente**. El usuario registró `excavadora-iot-rsc.duckdns.org`; la consulta DNS realizada desde el equipo de trabajo devuelve `32.194.155.66`. El certificado HTTPS todavía no se ha comprobado. El frontend sigue en pruebas simuladas.

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

El dominio registrado es `excavadora-iot-rsc.duckdns.org` y su registro A devuelve `32.194.155.66`. Confirma que esa siga siendo la IPv4 pública de tu EC2. Un cambio de IP requiere actualizar DNS; una IP elástica puede tener costos según la cuenta y el uso.

El método de validación HTTP de esta configuración no necesita el token de DuckDNS. No lo copies al frontend ni al archivo de Caddy.

## 2. Preparar el acceso a Caddy

Todo lo que sigue se realiza **dentro de EC2 Windows mediante Escritorio remoto**. Descarga Caddy para Windows amd64 desde [su sitio oficial](https://caddyserver.com/download), extrae el ejecutable y guárdalo como `C:\Caddy\caddy.exe`. Verifica que ninguna otra aplicación esté usando los puertos requeridos.

En AWS abre EC2 → Instancias → tu instancia → Seguridad → grupo de seguridad → Reglas de entrada → Editar. Agrega HTTP TCP **80** y HTTPS TCP **443**, con origen IPv4 `0.0.0.0/0`, para recibir las visitas y la validación pública del certificado. La [documentación de AWS](https://repost.aws/knowledge-center/connect-http-https-ec2) describe este acceso.

En PowerShell **como administrador dentro de EC2**, crea una regla de firewall limitada al ejecutable de Caddy:

```powershell
New-NetFirewallRule -DisplayName "Caddy Web IoT" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow -Program "C:\Caddy\caddy.exe"
```

La [documentación de Microsoft](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule) explica estos parámetros. No se han aplicado estas reglas desde el asistente.

El puerto 80 permite los desafíos/redirects previstos por la configuración automática habitual y el 443 sirve HTTPS/WSS. No expongas RDS al navegador ni cambies sus credenciales para habilitar el frontend.

## 3. Conservar el backend y añadir el proxy

Mantén la API existente y su entorno privado. En este servidor Windows debe conservarse `python run.py`, el bucle `asyncio:SelectorEventLoop` ya corregido y **un único worker**: las DEMO y suscripciones están en memoria del proceso.

Copia el archivo preparado `deploy/Caddyfile` a `C:\Caddy\Caddyfile`, **sin extensión `.txt`**. Su contenido es:

```caddyfile
excavadora-iot-rsc.duckdns.org {
    reverse_proxy 127.0.0.1:8000
}
```

En otra terminal de PowerShell dentro de EC2, manteniendo la terminal de FastAPI abierta:

```powershell
cd C:\Caddy
.\caddy.exe validate --config .\Caddyfile --adapter caddyfile
.\caddy.exe run --config .\Caddyfile --adapter caddyfile
```

`validate` comprueba la configuración, pero no demuestra que ya exista un certificado. Al ejecutar `run`, Caddy intentará obtenerlo y renovarlo automáticamente si DNS y los accesos públicos son correctos. Mantén abierto ese proceso durante esta primera comprobación; después se podrá instalar como servicio persistente. No uses un certificado autofirmado ni desactives la validación TLS en el navegador.

El [proxy de Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) maneja la actualización WebSocket. No hace falta crear otra ruta FastAPI ni ejecutar un segundo backend. Las URLs esperadas, todavía pendientes de verificar, serán:

```text
https://excavadora-iot-rsc.duckdns.org/health
https://excavadora-iot-rsc.duckdns.org/docs
wss://excavadora-iot-rsc.duckdns.org/ws/demos/1
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
apiBaseUrl: 'https://excavadora-iot-rsc.duckdns.org',
wsUrlTemplate: 'wss://excavadora-iot-rsc.duckdns.org/ws/demos/{id_demo}',
```

No añadas `:8000` a la URL pública de Caddy si utilizas el puerto HTTPS estándar. Conserva los IDs y rutas reales del contrato. El cliente no debe obtener ninguna credencial de RDS.

`GET /health` del backend actual devuelve estado de API y nombre de BD, pero no verifica una conexión con RDS. Por tanto, Amazon RDS debe seguir en **Sin verificar**; no inventes un endpoint `/ready` ni interpretes un nombre de BD como comprobación de disponibilidad.

Después de autorizar pruebas reales, completa la guía [pruebas.md](pruebas.md) desde la página publicada y un cliente WSS externo. Un cambio de configuración no cuenta como una prueba superada.
