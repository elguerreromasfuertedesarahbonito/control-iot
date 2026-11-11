import { formatBackendDateTime } from '../date-time.js';

// Presentation only: the monitoring model owns requests, ordering and live events.
export function createMonitorView({ root, config = {} }) {
  if (!root?.querySelector) throw new TypeError('Se requiere el contenedor de monitoreo.');
  const document = root.ownerDocument ?? root;
  const find = id => {
    const element = root.querySelector(`#${id}`);
    if (!element) throw new Error(`Falta el elemento de monitoreo: ${id}`);
    return element;
  };
  const elements = Object.fromEntries([
    'vehicle-id', 'refresh', 'latest-command', 'latest-code', 'latest-date',
    'latest-time', 'time-zone', 'latest-source', 'latest-status',
    'latest-activity', 'latest-message', 'history-body', 'history-status',
    'history-count',
  ].map(name => [name, find(`monitor-${name}`)]));
  const rows = new Map();
  let destroyed = false;
  const dateOptions = {
    sourceTimeZone: config.sourceTimeZone ?? 'UTC',
    displayTimeZone: config.displayTimeZone ?? 'America/Mexico_City',
  };

  function setText(element, value) {
    const next = String(value ?? '');
    if (element.textContent !== next) element.textContent = next;
  }

  function errorText(error) {
    if (typeof error === 'string') return error;
    return typeof error?.message === 'string' ? error.message : '';
  }

  function setTime(element, text, iso) {
    setText(element, text || '—');
    if (iso) element.setAttribute('datetime', iso);
    else element.removeAttribute('datetime');
  }

  function hasCode(value) {
    return value !== null && value !== undefined && value !== '';
  }

  function commandText(value) {
    return typeof value === 'string' && value.trim()
      ? value.replaceAll('_', ' ')
      : 'Sin comando informado';
  }

  function createRow() {
    const element = document.createElement('tr');
    const id = document.createElement('td');
    const movement = document.createElement('td');
    const command = document.createElement('span');
    command.className = 'monitor-row-command';
    const code = document.createElement('span');
    code.className = 'monitor-row-code';
    movement.append(command, code);
    const dateCell = document.createElement('td');
    const date = document.createElement('time');
    dateCell.append(date);
    const timeCell = document.createElement('td');
    const time = document.createElement('time');
    timeCell.append(time);
    element.append(id, movement, dateCell, timeCell);
    return { element, id, command, code, date, time };
  }

  function renderHistory(history) {
    const visible = history.slice(0, 10);
    const keys = new Set(visible.map(item => String(item.id_historial)));
    for (const [key, row] of rows) {
      if (!keys.has(key)) {
        row.element.remove();
        rows.delete(key);
      }
    }
    let cursor = elements['history-body'].firstElementChild;
    for (const [index, item] of visible.entries()) {
      const key = String(item.id_historial);
      let row = rows.get(key);
      if (!row) {
        row = createRow();
        rows.set(key, row);
      }
      row.element.dataset.historyId = key;
      row.id.title = `Identificador del historial: ${key}`;
      setText(row.id, index + 1);
      setText(row.command, commandText(item.comando));
      row.code.hidden = !hasCode(item.codigo);
      setText(row.code, hasCode(item.codigo) ? `Código ${item.codigo}` : '');
      const dateTime = formatBackendDateTime(item.fecha_hora, dateOptions);
      setTime(row.date, dateTime.date, dateTime.iso);
      setTime(row.time, dateTime.time, dateTime.iso);
      if (row.element !== cursor) elements['history-body'].insertBefore(row.element, cursor);
      cursor = row.element.nextElementSibling;
    }
    setText(elements['history-count'], `${visible.length} / 10`);
    return visible.length;
  }

  function render(snapshot = {}) {
    if (destroyed) return;
    const disabled = Boolean(snapshot.disabled);
    const latest = disabled ? null : snapshot.latest;
    const latestError = errorText(snapshot.latestError);
    const historyError = errorText(snapshot.historyError);
    const disconnected = snapshot.connection === 'offline';
    elements.refresh.disabled = disabled || Boolean(snapshot.latestLoading || snapshot.historyLoading);
    elements.refresh.setAttribute('aria-busy', String(Boolean(snapshot.latestLoading || snapshot.historyLoading)));
    setText(elements['vehicle-id'], `/ ${String(snapshot.vehicleId ?? config.vehicleId ?? '—').padStart(2, '0')}`);
    setText(elements['latest-command'], latest ? commandText(latest.comando) : 'Sin movimientos');
    elements['latest-code'].hidden = !hasCode(latest?.codigo);
    setText(elements['latest-code'], hasCode(latest?.codigo) ? `Código ${latest.codigo}` : '');

    // A DEMO event without a backend date deliberately keeps both fields empty.
    const dateTime = formatBackendDateTime(latest?.fecha_actualizacion ?? null, dateOptions);
    setTime(elements['latest-date'], dateTime.date, dateTime.iso);
    setTime(elements['latest-time'], dateTime.time, dateTime.iso);
    const zone = dateTime.date !== '—' ? dateTime.zoneLabel : dateOptions.displayTimeZone;
    setText(elements['time-zone'], zone === 'America/Mexico_City' ? 'Ciudad de México' : zone);
    const sourceLabels = {
      REST: 'Fuente: estado consultado por REST.',
      WSS: 'Fuente: estado recibido por WSS.',
      DEMO: 'Fuente: actividad DEMO recibida por WSS.',
    };
    setText(elements['latest-source'], !disabled && snapshot.latestSource
      ? sourceLabels[snapshot.latestSource] ?? 'Sin fuente disponible.'
      : 'Sin fuente disponible.');
    setText(elements['latest-activity'], disabled
      ? 'El monitoreo requiere conexión real.'
      : snapshot.activity || 'Sin actividad informada.');

    let state = 'idle';
    let status = 'Sin datos';
    let message = 'Sin estado informado por el servicio.';
    if (disabled) {
      status = 'Conexión real requerida';
      message = 'El modo simulado no consulta el estado ni el historial persistido.';
    } else if (latestError) {
      state = 'error';
      status = 'Error de consulta';
      message = latestError;
    } else if (snapshot.latestLoading) {
      state = 'checking';
      status = 'Cargando';
      message = latest ? 'Actualizando el estado informado.' : 'Cargando el estado informado…';
    } else if (disconnected) {
      state = 'offline';
      status = 'Desconectado';
      message = 'WebSocket del navegador desconectado. Se conserva el último dato recibido.';
    } else if (snapshot.stale) {
      state = 'stale';
      status = 'Dato anterior';
      message = 'Se muestra el último dato recibido; la actualización está pendiente.';
    } else if (latest) {
      state = snapshot.connection === 'online' ? 'online' : 'idle';
      status = snapshot.latestSource === 'DEMO' ? 'Actividad DEMO' : 'Estado informado';
      message = 'Dato del servicio; no confirma movimiento físico.';
    } else if (['connecting', 'reconnecting'].includes(snapshot.connection)) {
      state = 'checking';
      status = snapshot.connection === 'reconnecting' ? 'Reconectando' : 'Conectando';
      message = 'Esperando datos del servicio.';
    }
    elements['latest-status'].dataset.state = state;
    elements['latest-status'].title = 'Estado de actualización de los datos y de la sesión WebSocket del navegador.';
    setText(elements['latest-status'], status);
    elements['latest-message'].dataset.state = state;
    setText(elements['latest-message'], message);

    const count = renderHistory(disabled || !Array.isArray(snapshot.history) ? [] : snapshot.history);
    let historyStatus;
    let historyState = 'idle';
    if (disabled) {
      historyStatus = 'Requiere conexión real. El modo simulado no consulta registros.';
    } else if (historyError) {
      historyState = 'error';
      historyStatus = `Error al consultar el historial. ${historyError}${count ? ' Se conservan los registros recibidos.' : ''}`;
    } else if (snapshot.historyLoading) {
      historyState = 'checking';
      historyStatus = count ? 'Actualizando los registros persistidos…' : 'Cargando los registros persistidos…';
    } else if (!count) {
      historyStatus = 'Sin registros persistidos para este vehículo.';
    } else {
      historyStatus = `${count} ${count === 1 ? 'registro persistido' : 'registros persistidos'} · Más reciente primero.`;
    }
    elements['history-status'].dataset.state = historyState;
    setText(elements['history-status'], historyStatus);
    elements['history-body'].setAttribute('aria-busy', String(Boolean(snapshot.historyLoading)));
  }

  function destroy() {
    destroyed = true;
    rows.clear();
  }

  return { render, destroy };
}
