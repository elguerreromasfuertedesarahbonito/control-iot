# Rediseño móvil de dos joysticks

El rediseño está implementado localmente. GitHub Pages ya está publicado, según lo confirmado por el usuario, pero **esta actualización todavía no se ha publicado**. La configuración existente de API HTTPS y WebSocket WSS permanece igual. No se modifica el backend ni se agregan dependencias.

## Pantalla y controles

La consola principal cabe en la pantalla móvil sin desplazar la página. Reúne los dos joysticks con botones alternativos, DETENER, conectividad, los tres estados de la última acción y créditos. DEMO conserva el selector y Ejecutar/Cancelar. En vertical con 560 px de alto o menos, el acceso **DEMO** del encabezado abre esos mismos controles en un panel: no se duplican sus IDs, eventos ni selección. El diálogo **Info** contiene ayuda, avisos, descripción de la DEMO y comandos adicionales; su contenido puede desplazarse internamente.

El joystick de desplazamiento conserva avanzar, retroceder y giros. El de brazo y pala resuelve los comandos por nombre en el catálogo, usando sus IDs y códigos reales:

| Dirección | Comando |
| --- | --- |
| Arriba | `SUBIR_BRAZO` |
| Abajo | `BAJAR_BRAZO` |
| Izquierda | `ABRIR_PALA` |
| Derecha | `CERRAR_PALA` |

Estos cuatro comandos se representan en el segundo joystick y sus botones; los demás comandos adicionales siguen disponibles en Info. Un nombre ambiguo no habilita una dirección ni se convierte en un botón duplicado.

`ManualInput` comparte la propiedad de entrada entre ambos joysticks y todos los botones. La última orden admitida por el coordinador neutraliza el gesto anterior. Soltar al propietario solicita STOP; soltar después un control anterior no interrumpe al nuevo. Una orden rechazada no adquiere esa propiedad y un gesto anterior no se reanuda automáticamente. La admisión local de la orden es distinta de su posterior aceptación HTTP.

Se mantiene una sola orden manual activa; los dos joysticks no añaden movimientos físicos simultáneos al contrato. DETENER y Escape conservan prioridad, descarte de pendientes y tratamiento de respuestas tardías. También se conservan las flechas del teclado, los botones alternativos, la parada al abandonar la ventana y el modo `?simulation=1`. La última acción sigue separando solicitud, aceptación de API y evento WebSocket recibido.

## Verificación local

El 11 de noviembre de 2026 pasan **41 pruebas automatizadas con servicios simulados**. Cubren contratos y catálogo, propiedad entre joysticks y botones, liberaciones tardías, foco y teclado, STOP prioritario y DEMO. Incluyen una integración de los dos joysticks con catálogo, coordinador y eventos HTTP/WS fuera de orden. Se ejecutan desde la carpeta `control-iot`:

```powershell
node --test tests/*.test.js
node tools/serve.mjs
```

La revisión con `http://localhost:4173/?simulation=1` comprobó 320 × 480, 320 × 568, 360 × 640, 375 × 667, 390 × 844, 430 × 932, 568 × 320, 667 × 375, 844 × 390, 768 × 1024 y 1280 × 900 CSS px. En todos, las dimensiones del documento coinciden con el viewport: no hubo scroll vertical u horizontal y los dos joysticks, DETENER y los créditos quedaron visibles. El selector y las acciones DEMO tienen 44 px de alto; la parada principal tiene entre 44 y 50 px.

También se comprobó inicio/cancelación de DEMO, que cerrar su panel no cancele una secuencia en curso, su traslado al cambiar de orientación manteniendo un único selector, apertura/cierre de Info, teclado del segundo joystick y regreso a neutral. La consola de la aplicación no registró errores durante esas comprobaciones. Las capturas simuladas están en `artifacts/control-mobile-redesign.jpg`, `control-compact-redesign.jpg`, `control-landscape-redesign.jpg` y `control-desktop-redesign.jpg`.

La revisión se hizo en el navegador integrado con tamaños de viewport; no sustituye una prueba en un teléfono físico. El modo simulado no abre conexiones con AWS. El asistente no envió POST a AWS ni validó movimiento físico; una respuesta HTTP o un evento WebSocket tampoco demuestra movimiento físico.

## Actualizar la publicación existente

1. Mantener aprobadas las pruebas y comprobar el diseño desde un teléfono físico después de publicar.
2. Subir juntos al repositorio frontend los cambios de `index.html`, `assets/css/styles.css`, `assets/js/app.js`, `assets/js/catalog.js`, `assets/js/joystick.js` y el **nuevo `assets/js/manual-input.js`**. Incluir también las pruebas actualizadas (`tests/services.test.js`, `tests/joystick.test.js`, `tests/manual-input.test.js`, `tests/dual-control.test.js`) y esta documentación con `README.md`.
3. Actualizar la rama `main` o ejecutar el workflow de Pages. El workflow existente ejecuta las pruebas y publica `index.html`, `assets/` y `.nojekyll`; el módulo nuevo queda incluido al copiar `assets/`.
4. Esperar a que el despliegue termine correctamente y comprobar [la página publicada](https://elguerreromasfuertedesarahbonito.github.io/control-iot/) desde el teléfono. Usar primero `?simulation=1` para revisar el diseño sin enviar órdenes reales.

No es necesario subir el backend, cambiar las direcciones HTTPS/WSS ni instalar paquetes. Estas instrucciones describen la actualización pendiente; no constituyen una publicación realizada por el asistente.
