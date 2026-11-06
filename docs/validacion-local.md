# Verificación local del frontend

Fecha: 6 de noviembre de 2026. Entorno: Node.js 24.22.1 y navegador Chromium integrado.

## Resultado

**29 pruebas automáticas simuladas aprobadas, cero fallos.** Se ejecutaron con `node --test tests/*.test.js`, sin dependencias externas de pruebas ni acceso al servidor real.

Cubren los contratos REST, errores y timeout; rechazo de contenido mixto antes de abrir transporte; catálogo con IDs reales, duplicados y comandos inactivos; bienvenida y reconexión WebSocket con transportes falsos; joystick, zona neutral y captura de puntero; prioridad de DETENER, descarte de movimientos pendientes, HTTP/WS fuera de orden, repetición de inicio de DEMO y cancelación de un inicio que termina tarde.

La parada puede requerir un segundo POST de compensación si ya había una mutación en vuelo. Es una parada deliberada después de resolver la operación anterior, no un reintento automático del movimiento. Una respuesta incierta mantiene el bloqueo de nuevos movimientos y permite reintentar DETENER.

## Revisión en navegador

- Vista con `?simulation=1`, identificada permanentemente como simulación.
- Avance mediante botón y liberación, con solicitud/respuesta/evento simulados diferenciados.
- Inicio y cancelación de DEMO; botones de movimiento bloqueados mientras corre.
- Sin desbordamiento horizontal en 1280 × 900, 360 × 800, 320 × 740 y 844 × 390 CSS px.
- Botones de dirección de 52 px de alto y detención del encabezado de 44 px de alto en móvil.
- DETENER permanece accesible en el encabezado al desplazarse. Créditos al final del contenido.
- Sin errores ni advertencias de aplicación en la consola durante estas comprobaciones.
- Favicon referenciado mediante ruta relativa y recurso servido localmente.

Las capturas privadas de revisión están en `artifacts/control-desktop-simulado.jpg` y `artifacts/control-mobile-simulado.jpg`. Se excluyen de Git y no acreditan conectividad con AWS, WSS real, RDS ni movimiento físico.

## Integración configurada y confirmación del usuario

El usuario confirmó que HTTPS y WSS funcionan mediante Caddy en EC2 Windows para `excavadora-iot-rsc.duckdns.org`. El asistente no verificó de forma independiente esa disponibilidad. Las URLs del cliente ya están activadas:

- API: `https://excavadora-iot-rsc.duckdns.org`.
- WebSocket: `wss://excavadora-iot-rsc.duckdns.org/ws/demos/{id_demo}`.

Esta actualización de configuración no amplía el alcance de las 29 pruebas: siguen usando servicios simulados. No se enviaron órdenes POST a AWS, no se probó movimiento físico y no se publicó ni verificó GitHub Pages desde esta etapa.

## Pendiente para entregar la actividad completa

1. Comprobar CORS para el origen `https://elguerreromasfuertedesarahbonito.github.io`, sin subruta; si se modifica `ALLOWED_ORIGINS` en EC2, reiniciar el proceso de la API según la [guía de despliegue](despliegue-ec2-windows.md).
2. Crear/publicar el repositorio frontend y verificar la URL pública de GitHub Pages.
3. Ejecutar las pruebas A–E desde la página publicada y un cliente WSS independiente en una sesión de prueba acordada. Comprobar un teléfono físico.
4. Incorporar las evidencias reales y finalizar el Word/PDF institucional. El informe sigue siendo un borrador.

Ya se proporcionaron institución (Instituto Tecnológico de Pachuca, ITP), carrera (Ingeniería en Sistemas Computacionales), docente (Víctor Pinedo Fernández), logotipo y fecha de entrega (10/11/2026); esos datos no son pendientes.

No se modificaron el backend, RDS, el firmware ni la configuración de EC2 en esta etapa. La disponibilidad de RDS permanece **Sin verificar**: `/health` no realiza un diagnóstico de conexión a la base de datos.
