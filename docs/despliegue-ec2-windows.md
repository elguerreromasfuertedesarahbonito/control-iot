# HTTPS/WSS en EC2 Windows con DuckDNS y Caddy

El usuario confirmó que **HTTPS y WSS funcionan** en `excavadora-iot-rsc.duckdns.org` con Caddy en EC2 Windows. Es una confirmación del usuario, no una verificación independiente del asistente. Una consulta DNS previa desde el equipo de trabajo devolvió `32.194.155.66`. Las URLs seguras ya están activadas en el frontend; sus pruebas documentadas siguen siendo simuladas. **El asistente no ejecutó cambios en EC2, DNS, firewall ni CORS, ni envió órdenes POST a AWS o probó movimiento físico. GitHub Pages sigue sin publicar ni verificar.** Esta guía conserva los pasos para reproducir la configuración y completar CORS.

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

El dominio registrado es `excavadora-iot-rsc.duckdns.org` y en la consulta previa su registro A devolvió `32.194.155.66`. Si se reproduce el despliegue, confirma que esa siga siendo la IPv4 pública de tu EC2. Un cambio de IP requiere actualizar DNS; una IP elástica puede tener costos según la cuenta y el uso.

La validación automática del dominio de esta configuración no necesita el token de DuckDNS. No lo copies al frontend ni al archivo de Caddy.

## 2. Preparar el acceso a Caddy

Todo lo que sigue se realiza **dentro de EC2 Windows mediante Escritorio remoto**. Descarga Caddy para Windows amd64 desde [su sitio oficial](https://caddyserver.com/download) y extrae el ejecutable. `C:\Caddy` es una carpeta de ejemplo; también funciona una carpeta del Escritorio. En la configuración realizada por el usuario, el ejecutable se llama `caddy_windows_amd64.exe`: conserva ese nombre en los comandos y en la ruta de la regla del firewall, o renómbralo de forma coherente. Los ejemplos siguientes conservan su nombre real. Verifica que ninguna otra aplicación esté usando los puertos requeridos.

En AWS abre EC2 → Instancias → tu instancia → Seguridad → grupo de seguridad → Reglas de entrada → Editar. Agrega HTTP TCP **80** y HTTPS TCP **443**, con origen IPv4 `0.0.0.0/0`, para recibir las visitas y la validación pública del certificado. La [documentación de AWS](https://repost.aws/knowledge-center/connect-http-https-ec2) describe este acceso.

En PowerShell **como administrador dentro de EC2**, crea una regla de firewall limitada al ejecutable de Caddy:

```powershell
New-NetFirewallRule -DisplayName "Caddy Web IoT" -Direction Inbound -Protocol TCP -LocalPort 80,443 -Action Allow -Program "C:\Caddy\caddy_windows_amd64.exe"
```

Sustituye la ruta de `-Program` por la ubicación real del ejecutable si está en el Escritorio. La [documentación de Microsoft](https://learn.microsoft.com/en-us/powershell/module/netsecurity/new-netfirewallrule) explica estos parámetros. No se han aplicado estas reglas desde el asistente.

El puerto 80 permite los desafíos/redirects previstos por la configuración automática habitual y el 443 sirve HTTPS/WSS. No expongas RDS al navegador ni cambies sus credenciales para habilitar el frontend.

## 3. Conservar el backend y añadir el proxy

Mantén la API existente y su entorno privado. En este servidor Windows debe conservarse `python run.py`, el bucle `asyncio:SelectorEventLoop` ya corregido y **un único worker**: las DEMO y suscripciones están en memoria del proceso.

Copia el archivo preparado `deploy/Caddyfile` a la carpeta del ejecutable, por ejemplo `C:\Caddy\Caddyfile`. Usa el nombre **`Caddyfile` sin extensión** y activa la visualización de extensiones en el Explorador para comprobarlo. Si lo guardas como `Caddyfile.txt` u otro nombre, debes pasar ese nombre exacto en `--config`. Su contenido es:

```caddyfile
excavadora-iot-rsc.duckdns.org {
    reverse_proxy 127.0.0.1:8000
}
```

En otra terminal de PowerShell dentro de EC2, manteniendo la terminal de FastAPI abierta:

```powershell
cd C:\Caddy
.\caddy_windows_amd64.exe validate --config .\Caddyfile --adapter caddyfile
.\caddy_windows_amd64.exe run --config .\Caddyfile --adapter caddyfile
```

Si el ejecutable está en el Escritorio, cambia primero a esa carpeta y usa el mismo nombre de archivo. `--adapter caddyfile` indica que la configuración es texto con sintaxis Caddyfile; permite leerla aunque se haya guardado con otro nombre o extensión, siempre que `--config` apunte al archivo exacto. Por ejemplo, para `Caddyfile.txt`, usa `--config .\Caddyfile.txt --adapter caddyfile` en ambos comandos.

`validate` comprueba la configuración, pero no demuestra que ya exista un certificado. Al ejecutar `run`, Caddy obtiene y renueva el certificado automáticamente si DNS y los accesos públicos son correctos. Mantén abierto ese proceso durante la operación; después se podrá instalar como servicio persistente. No uses un certificado autofirmado ni desactives la validación TLS en el navegador.

El [proxy de Caddy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) maneja la actualización WebSocket. No hace falta crear otra ruta FastAPI ni ejecutar un segundo backend. Las direcciones del despliegue cuya disponibilidad HTTPS/WSS confirmó el usuario son:

```text
https://excavadora-iot-rsc.duckdns.org/health
https://excavadora-iot-rsc.duckdns.org/docs
wss://excavadora-iot-rsc.duckdns.org/ws/demos/1
```

Con el proxy funcionando, revisa la exposición del puerto 8000 y restringe su acceso público directo conforme al despliegue previsto; el tráfico público debe entrar por Caddy. Ten en cuenta cualquier cliente antiguo que todavía use HTTP/WS antes de retirar ese acceso. Este ajuste no se ha realizado desde el asistente y esta actividad no conecta el microcontrolador.

## 4. Autorizar el origen del frontend en CORS

La configuración existente del backend lee `ALLOWED_ORIGINS`. En la configuración privada de EC2, agrega el origen de Pages **`https://elguerreromasfuertedesarahbonito.github.io`**, sin `/control-iot/` ni otra subruta. Para permitir también el servidor local, el valor es:

```text
ALLOWED_ORIGINS=https://elguerreromasfuertedesarahbonito.github.io,http://localhost:4173,http://127.0.0.1:4173
```

Guarda el valor en el `.env` o configuración privada que carga la API en EC2. Detén su proceso actual y vuelve a ejecutar `python run.py` desde la carpeta y entorno del backend, conservando un único worker; el cambio de CORS requiere reiniciar la API. Mantén Caddy ejecutándose en su terminal. No copies el `.env` de EC2 al repositorio. Revisa que POST y la cabecera `Content-Type` estén permitidos por la configuración existente; CORS no proporciona autenticación ni sustituye HTTPS. El asistente no modificó el `.env` ni reinició la API; la comprobación de CORS desde Pages sigue pendiente de publicar el frontend.

## 5. Configurar el frontend

Las URLs públicas de `assets/js/config.js` ya están activadas, a partir de la confirmación del usuario:

```js
apiBaseUrl: 'https://excavadora-iot-rsc.duckdns.org',
wsUrlTemplate: 'wss://excavadora-iot-rsc.duckdns.org/ws/demos/{id_demo}',
```

No añadas `:8000` a la URL pública de Caddy si utilizas el puerto HTTPS estándar. Conserva los IDs y rutas reales del contrato. El cliente no debe obtener ninguna credencial de RDS.

`GET /health` del backend actual devuelve estado de API y nombre de BD, pero no verifica una conexión con RDS. Por tanto, Amazon RDS debe seguir en **Sin verificar**; no inventes un endpoint `/ready` ni interpretes un nombre de BD como comprobación de disponibilidad.

Para completar las evidencias reales, aplica la guía [pruebas.md](pruebas.md) desde la página publicada y un cliente WSS externo en una sesión de prueba acordada. La confirmación de HTTPS/WSS y el cambio de configuración no acreditan las pruebas A–E, conectividad con RDS ni movimiento físico.
