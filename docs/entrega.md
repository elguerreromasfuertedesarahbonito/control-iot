# Plantilla del informe institucional · Actividad práctica 4.1

**Estado: contenido preparatorio; no es el Word/PDF institucional final ni acredita pruebas reales.** Completar los campos pendientes y añadir únicamente evidencias observadas antes de exportar a PDF.

## Portada para Microsoft Word

| Campo | Contenido |
| --- | --- |
| Logotipo institucional | ITP, obtenido de su portal institucional |
| Institución | Instituto Tecnológico de Pachuca |
| Carrera | Ingeniería en Sistemas Computacionales |
| Asignatura | Implementación de soluciones IoT; confirmar denominación institucional |
| Práctica | 4.1 · Aplicación de control para IoT |
| Docente | Víctor Pinedo Fernández |
| Alumno | Ricardo de Jesus Serrano Cortes |
| Fecha de entrega | 10 de noviembre de 2026 |

## Objetivo

Desarrollar una aplicación web responsiva destinada al control de una excavadora IoT, mediante joystick, controles adicionales y DEMO existentes. Integrarla con la API REST y el canal WebSocket de AWS, diferenciando aceptación HTTP, publicación de eventos y ejecución física, y publicarla en GitHub Pages.

## Arquitectura de la solución

El frontend utiliza HTML semántico, CSS, Bootstrap y módulos JavaScript nativos. Los controles envían intenciones a un coordinador común; el cliente REST consume exclusivamente las rutas existentes de FastAPI. La sesión WebSocket del navegador recibe los eventos del vehículo/DEMO seleccionados. El backend mantiene sus reglas de estado, historial y ejecución de DEMO sobre RDS.

Los indicadores son independientes: el WebSocket representa la sesión del navegador, la API se comprueba mediante su operación de salud y RDS permanece «Sin verificar» porque el `/health` disponible no realiza un diagnóstico de la base de datos. Esta etapa no conecta el microcontrolador ni verifica movimiento físico.

## Evidencias, en el orden solicitado

| N.º | Evidencia que falta incorporar | Descripción que debe acompañarla |
| --- | --- | --- |
| 1 | Estructura modular en VS Code y repositorio GitHub. | Identificar módulos de UI, REST, WebSocket, catálogo y coordinación. Anotar el commit utilizado. |
| 2 | Interfaz en escritorio y móvil, con créditos visibles. | Indicar navegador, dispositivo, orientación y acciones accesibles. |
| 3 | Movimiento individual en la página y evento correspondiente en cliente externo. | Relacionar vehículo, comando y `id_evento`; distinguir HTTP y evento recibido. |
| 4 | Cambio de dirección y DETENER con eventos externos. | Explicar retorno a neutral, prioridad de parada y tratamiento de respuestas tardías. |
| 5 | DEMO iniciada con sus movimientos, final o cancelación. | Identificar la DEMO real, N movimientos, orden, duración y pausa del servidor. |
| 6 | Tres indicadores y pruebas de caída/recuperación. | Separar sesión WSS, disponibilidad HTTPS y RDS «Sin verificar» o diagnóstico real autorizado. |
| 7 | URL pública en teléfono, URL del repositorio y favicon. | Mostrar la publicación verificada, los créditos al pie y el favicon en la pestaña. |

No insertar capturas simuladas como si correspondieran a los puntos 3–6 reales. Si una prueba no se realizó, identificarla como pendiente y explicar el impedimento.

## Conclusiones técnicas

Redactar las conclusiones después de ejecutar las pruebas correspondientes. Explicar:

- Cómo se adaptaron joystick, botones, DETENER y DEMO al uso Mobile First.
- Por qué se separaron interfaz, cliente REST, catálogo y reglas de operación.
- Cómo se comprobó HTTP y WebSocket desde la página publicada, y qué representa cada indicador.
- Por qué solicitud, aceptación HTTP, evento recibido y ejecución física son evidencias distintas.
- Qué medidas de accesibilidad, seguridad y manejo de errores pueden reutilizarse en las siguientes etapas.

## Enlaces de entrega

| Elemento | Estado |
| --- | --- |
| GitHub Pages | Pendiente de publicación y verificación |
| Repositorio del frontend | Pendiente de creación/publicación y verificación |
| Repositorio de API de referencia | https://github.com/elguerreromasfuertedesarahbonito/Vehiculo-iot-api |

El nombre propuesto para el repositorio frontend es `control-iot`. No tratar su URL derivada como una página existente hasta confirmar la publicación. Al completar esta sección en Word, pegar ambos enlaces finales completos y mantenerlos como hipervínculos clicables al exportar a PDF.

## Archivos finales requeridos

1. Guardar el documento editable de Microsoft Word con los datos institucionales y las capturas reales.
2. Exportar a PDF y revisar que las páginas, imágenes y enlaces se vean correctamente.
3. Entregar URL de GitHub Pages, URL del repositorio frontend y PDF. Conservar el Word como fuente editable.
