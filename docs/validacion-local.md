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

## Pendiente para entregar la actividad completa

1. Registrar/proporcionar el hostname DuckDNS y preparar HTTPS/WSS en EC2 con el proxy documentado.
2. Configurar las dos URLs públicas y CORS para el origen de Pages; probarlo cuando el usuario autorice pruebas reales.
3. Crear/publicar el repositorio frontend y verificar la URL pública de GitHub Pages.
4. Ejecutar las pruebas A–E desde la página publicada y un cliente WSS independiente. Comprobar un teléfono físico.
5. Completar institución, carrera, docente, logotipo, fecha y evidencias reales para elaborar el Word/PDF institucional.

No se modificaron el backend, RDS, el firmware ni la configuración de EC2 en esta etapa. La disponibilidad de RDS permanece **Sin verificar**: `/health` no realiza un diagnóstico de conexión a la base de datos.
