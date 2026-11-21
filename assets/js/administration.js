const base = '/administracion';
const lookup = id => document.getElementById(id);
const text = (tag, value) => Object.assign(document.createElement(tag), { textContent: value ?? '' });
const listResponse = value => Array.isArray(value);
const MAX_DEMO_STEPS = 30;
const MAX_STEP_MS = 10000;
const MAX_DEMO_MS = 120000;
const commercialStates = { AVAILABLE: 'Disponible', SOLD: 'Asignado', MAINTENANCE: 'Mantenimiento', INACTIVE: 'Inactivo' };
const sectionNames = { resumen: 'Resumen', modelos: 'Modelos', unidades: 'Unidades', usuarios: 'Usuarios',
  demos: 'Demos', auditoria: 'Auditoría', soporte: 'Soporte' };
const time = new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short',
  timeZone: 'America/Mexico_City' });

function button(label, handle, className = 'icon-button') {
  return Object.assign(text('button', label), { type: 'button', className, onclick: handle });
}

function field(label, { name, value = '', type = 'text', options, required = true, min, max, maxLength }) {
  const wrapper = text('label', label);
  const input = document.createElement(options ? 'select' : 'input');
  input.className = options ? 'form-select' : type === 'checkbox' ? 'form-check-input' : 'form-control';
  input.name = name;
  input.required = required;
  if (options) {
    for (const [id, title] of options) input.add(new Option(title, id));
  } else {
    input.type = type;
    if (min !== undefined) input.min = min;
    if (max !== undefined) input.max = max;
    if (maxLength !== undefined) input.maxLength = maxLength;
  }
  if (type === 'checkbox') input.checked = Boolean(value);
  else input.value = value ?? '';
  wrapper.append(input);
  return wrapper;
}

function table(columns, rows) {
  const wrapper = document.createElement('div');
  wrapper.className = 'commercial-table';
  const table = document.createElement('table');
  const heading = table.createTHead().insertRow();
  for (const label of columns) heading.append(Object.assign(text('th', label), { scope: 'col' }));
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const cell of row) {
      const td = tr.insertCell();
      if (cell instanceof Node) td.append(cell);
      else td.textContent = cell ?? '—';
    }
  }
  if (!rows.length) {
    const td = body.insertRow().insertCell();
    td.colSpan = columns.length;
    td.textContent = 'Sin registros';
  }
  wrapper.append(table);
  return wrapper;
}

export function createAdministration({ api, onDemoChange }) {
  const root = lookup('admin-content');
  const dialog = lookup('edit-dialog');
  const form = lookup('edit-form');
  const list = (path, query) => api.commercial(base + path, { query, validate: listResponse });
  const read = path => api.commercial(base + path);
  const mutate = (path, method, body) => api.commercial(base + path, { method, body });
  let role = null;
  let vehicle = null;
  let adminDemoVehicle = null;
  let section = 'resumen';
  let active = false;
  let version = 0;
  let save = null;
  const status = message => { lookup('admin-status').textContent = message; };
  const showActions = (...children) => {
    const line = Object.assign(document.createElement('div'), { className: 'commercial-row-actions' });
    line.append(...children);
    return line;
  };
  const allowedSections = () => role === 'ADMIN'
    ? ['resumen', 'modelos', 'unidades', 'usuarios', 'demos', 'auditoria'] : ['demos', 'soporte'];

  function setEditor(title, children, submit) {
    save = submit;
    lookup('edit-title').textContent = title;
    lookup('edit-error').textContent = '';
    const confirm = button('Guardar', null, 'button-primary');
    confirm.type = 'submit';
    form.replaceChildren(...children, confirm);
    dialog.showModal();
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const confirm = form.querySelector('button[type=submit]');
    confirm.disabled = true;
    lookup('edit-error').textContent = '';
    try {
      await save(new FormData(form));
      dialog.close();
      await refresh('Cambios guardados.');
    } catch (error) { lookup('edit-error').textContent = error.message; }
    finally { confirm.disabled = false; }
  });
  lookup('edit-close').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { form.replaceChildren(); save = null; });
  lookup('admin-refresh').onclick = () => void refresh();

  const guarded = task => async () => {
    try { await task(); } catch (error) { status(error.message); }
  };
  const remove = (path, label, affectedVehicle = null) => guarded(async () => {
    if (!window.confirm(`¿${label}?`)) return;
    await mutate(path, 'DELETE');
    if (affectedVehicle !== null && affectedVehicle === vehicle) await onDemoChange?.();
    await refresh('Cambio guardado.');
  });

  function editModel(model = {}) {
    setEditor(model.id_modelo ? 'Editar modelo' : 'Nuevo modelo', [
      field('Nombre', { name: 'nombre', value: model.nombre, maxLength: 100 }),
      field('Descripción', { name: 'descripcion', value: model.descripcion, required: false, maxLength: 250 }),
      field('Códigos habilitados separados por coma', { name: 'codigos', value: model.codigos?.join(', ') }),
      field('Activo', { name: 'activo', type: 'checkbox', value: model.activo ?? true, required: false }),
    ], data => mutate(model.id_modelo ? `/modelos/${model.id_modelo}` : '/modelos', model.id_modelo ? 'PUT' : 'POST', {
      nombre: data.get('nombre'), descripcion: data.get('descripcion') || null,
      codigos: data.get('codigos').split(',').map(code => Number(code.trim())),
      activo: data.has('activo'),
    }));
  }

  function editUnit(models, users, unit = {}) {
    setEditor(unit.id_vehiculo ? 'Editar unidad' : 'Nueva unidad', [
      field('Nombre', { name: 'nombre', value: unit.nombre, maxLength: 100 }),
      field('Identificador físico', { name: 'serial', value: unit.serial, maxLength: 100 }),
      field('Modelo', { name: 'id_modelo', value: unit.id_modelo ?? models[0]?.id_modelo,
        options: models.map(model => [model.id_modelo, model.nombre]) }),
      field('Propietario', { name: 'owner_id', value: unit.owner_id, required: false,
        options: [['', 'Sin asignar'], ...users.filter(user => user.rol === 'BUYER' && user.activo)
          .map(user => [user.id_user, user.nombre])] }),
      field('Estado comercial', { name: 'comercial', value: unit.comercial ?? 'AVAILABLE', options: Object.entries(commercialStates) }),
      field('Unidad en exhibición', { name: 'exhibicion', type: 'checkbox', value: unit.exhibicion, required: false }),
    ], data => mutate(unit.id_vehiculo ? `/unidades/${unit.id_vehiculo}` : '/unidades', unit.id_vehiculo ? 'PUT' : 'POST', {
      nombre: data.get('nombre'), serial: data.get('serial'), id_modelo: Number(data.get('id_modelo')),
      owner_id: Number(data.get('owner_id')) || null, comercial: data.get('comercial'), exhibicion: data.has('exhibicion'),
    }));
  }

  function createUser() {
    setEditor('Nuevo usuario', [
      field('Nombre', { name: 'nombre', maxLength: 100 }),
      field('Correo', { name: 'email', type: 'email' }),
      field('Contraseña inicial', { name: 'password', type: 'password' }),
      field('Rol', { name: 'rol', value: 'BUYER', options: [['BUYER', 'Comprador'], ['ADMIN', 'Administrador']] }),
    ], data => mutate('/usuarios', 'POST', Object.fromEntries(data)));
    form.elements.password.autocomplete = 'new-password';
    form.elements.password.minLength = 12;
  }

  async function editDemo(selected, header = {}) {
    const opening = version;
    const [demo, commands] = await Promise.all([
      header.id_demo ? read(`/demos/${header.id_demo}`) : {},
      list(`/unidades/${selected}/comandos`),
    ]);
    if (opening !== version || !active) return;
    const available = commands.filter(command => command.activo === true &&
      command.id_vehiculo === selected).map(command => [command.id_comando, command.nombre.replaceAll('_', ' ')]);
    if (!available.length) throw new Error('La unidad no tiene comandos activos.');
    const steps = Object.assign(document.createElement('div'), { className: 'commercial-edit-steps' });
    const total = text('output', '');
    const addStep = button('Añadir paso', () => appendStep());
    const updateTotal = () => {
      const milliseconds = [...steps.querySelectorAll('input')].reduce((sum, input) => sum + Number(input.value || 0), 0);
      total.textContent = `${(milliseconds / 1000).toLocaleString('es-MX')} de 120 s`;
      addStep.disabled = steps.childElementCount >= MAX_DEMO_STEPS;
    };
    const appendStep = (step = {}) => {
      const row = Object.assign(document.createElement('div'), { className: 'commercial-edit-step' });
      row.append(
        field('Comando', { name: 'id_comando', value: step.id_comando ?? available[0][0], options: available }),
        field('Duración (ms)', { name: 'duracion_ms', type: 'number', value: step.duracion_ms ?? 1000, min: 1, max: MAX_STEP_MS }),
        field('Pausa (ms)', { name: 'pausa_ms', type: 'number', value: step.pausa_ms ?? 0, min: 0, max: MAX_STEP_MS }),
        showActions(
          button('Subir paso', () => row.previousElementSibling?.before(row)),
          button('Bajar paso', () => row.nextElementSibling?.after(row)),
          button('Quitar paso', () => { row.remove(); updateTotal(); }),
        ),
      );
      steps.append(row);
      updateTotal();
    };
    for (const step of demo.pasos ?? []) appendStep(step);
    if (!steps.childElementCount) appendStep();
    steps.addEventListener('input', updateTotal);
    const fields = [field('Nombre', { name: 'nombre', value: demo.nombre, maxLength: 80 }),
      field('Descripción', { name: 'descripcion', value: demo.descripcion, required: false, maxLength: 250 })];
    if (role === 'ADMIN') fields.push(field('Publicar en exhibición', { name: 'exhibicion', value: demo.exhibicion, type: 'checkbox', required: false }));
    setEditor(header.id_demo ? 'Editar demo' : 'Nueva demo', [
      ...fields, text('strong', 'Secuencia'), steps, addStep, total,
    ], async data => {
      const pasos = [...steps.children].map(row => Object.fromEntries([...row.querySelectorAll('input,select')]
        .map(input => [input.name, Number(input.value)])));
      if (!pasos.length) throw new Error('Añade al menos un paso.');
      if (pasos.length > MAX_DEMO_STEPS) throw new Error('La demo admite hasta 30 pasos.');
      if (pasos.reduce((sum, step) => sum + step.duracion_ms + step.pausa_ms, 0) > MAX_DEMO_MS) {
        throw new Error('La demo no puede superar dos minutos contando las pausas.');
      }
      await mutate(header.id_demo ? `/demos/${header.id_demo}` : '/demos', header.id_demo ? 'PUT' : 'POST', {
        id_vehiculo: selected, nombre: data.get('nombre'), descripcion: data.get('descripcion') || null,
        exhibicion: data.has('exhibicion'), pasos,
      });
      if (selected === vehicle) await onDemoChange?.();
    });
  }

  async function content(current) {
    if (section === 'resumen') {
      const stats = await read('/resumen');
      const metrics = Object.assign(document.createElement('dl'), { className: 'commercial-metrics' });
      for (const [key, label] of Object.entries({ modelos: 'Modelos', unidades: 'Unidades', vendidas: 'Asignadas',
        exhibicion: 'En exhibición', compradores: 'Compradores', demos: 'Demos', sesiones_invitado: 'Pruebas activas' })) {
        const tile = document.createElement('div');
        tile.append(text('dt', label), text('dd', Number.isFinite(stats[key]) ? stats[key] : 'Sin datos'));
        metrics.append(tile);
      }
      return [metrics];
    }
    if (section === 'modelos') {
      const rows = await list('/modelos');
      return [button('Nuevo modelo', () => editModel(), 'button-primary'),
        table(['Modelo', 'Códigos', 'Estado', 'Acciones'], rows.map(model => [model.nombre, model.codigos?.join(', '),
          model.activo ? 'Activo' : 'Inactivo', showActions(button('Editar', () => editModel(model)),
            button('Desactivar', remove(`/modelos/${model.id_modelo}`, 'Desactivar modelo')))]))];
    }
    if (section === 'unidades') {
      const [rows, models, users] = await Promise.all([list('/unidades'), list('/modelos'), list('/usuarios')]);
      const formModels = models.filter(model => model.activo);
      const add = button('Nueva unidad', () => editUnit(formModels, users), 'button-primary');
      add.disabled = !formModels.length;
      return [add, table(['Unidad', 'Identificador', 'Modelo', 'Propietario', 'Estado', 'Acciones'],
        rows.map(unit => [unit.nombre, unit.serial, unit.modelo ?? models.find(model => model.id_modelo === unit.id_modelo)?.nombre,
          users.find(user => user.id_user === unit.owner_id)?.nombre ?? 'Sin asignar',
          [commercialStates[unit.comercial], unit.exhibicion ? 'Exhibición' : ''].filter(Boolean).join(' · '),
          showActions(button('Editar', () => editUnit(models, users, unit)),
            button('Desactivar', remove(`/unidades/${unit.id_vehiculo}`, 'Desactivar unidad')))]))];
    }
    if (section === 'usuarios') {
      const rows = await list('/usuarios');
      return [button('Nuevo usuario', createUser, 'button-primary'),
        table(['Nombre', 'Correo', 'Rol', 'Estado', 'Acciones'], rows.map(user => [user.nombre, user.email,
          user.rol === 'BUYER' ? 'Comprador' : 'Administrador', user.activo ? 'Activo' : 'Inactivo',
          button(user.activo ? 'Desactivar' : 'Reactivar', guarded(async () => {
            await mutate(`/usuarios/${user.id_user}`, 'PATCH', { activo: !user.activo });
            await refresh('Usuario actualizado.');
          }))]))];
    }
    if (section === 'auditoria') {
      const rows = await list('/auditoria', { limit: '50' });
      return [table(['Fecha', 'Actor', 'Acción', 'Recurso', 'Resultado'], rows.map(event => {
        const date = new Date(event.fecha ?? event.created_at);
        return [Number.isNaN(date.getTime()) ? '—' : time.format(date),
          event.actor ?? event.actor_id ?? 'Invitado', event.accion, event.recurso, event.resultado];
      }))];
    }
    if (section === 'soporte') {
      if (!vehicle) return [text('p', 'Selecciona una unidad en Acceso.')];
      const path = `/unidades/${vehicle}/soporte`;
      const data = await read(path);
      const add = button('Autorizar soporte', () => setEditor('Autorizar soporte', [
        field('Administrador', { name: 'admin_id', value: data.administradores[0]?.id_user,
          options: data.administradores.map(user => [user.id_user, user.nombre]) }),
        field('Minutos', { name: 'duracion_min', type: 'number', value: 15, min: 1, max: 60 }),
      ], values => mutate(path, 'POST', { admin_id: Number(values.get('admin_id')), duracion_min: Number(values.get('duracion_min')) })), 'button-primary');
      add.disabled = !data.administradores.length;
      return [add, table(['Administrador', 'Vence', 'Acciones'], data.permisos.map(permission => [
        permission.nombre, time.format(new Date(permission.expires_at)),
        button('Revocar', remove(`${path}/${permission.admin_id}`, 'Revocar soporte')),
      ]))];
    }
    let selected = vehicle;
    let canEdit = true;
    const children = [];
    if (role === 'ADMIN') {
      const units = (await list('/unidades')).filter(unit => Number.isSafeInteger(unit.id_modelo));
      if (current !== version) return [];
      const unit = units.find(item => item.id_vehiculo === adminDemoVehicle)
        ?? units.find(item => item.id_vehiculo === vehicle) ?? units[0];
      if (!unit) return [text('p', 'Configura una unidad comercial para administrar demos.')];
      adminDemoVehicle = selected = unit.id_vehiculo;
      canEdit = unit.activo && unit.comercial !== 'INACTIVE';
      const picker = field('Unidad de demos', { name: 'demo_unit', value: selected,
        options: units.map(item => [item.id_vehiculo, `${item.nombre} · ${item.serial}`]) });
      picker.className = 'commercial-form';
      picker.firstElementChild.addEventListener('change', event => {
        adminDemoVehicle = Number(event.target.value);
        void refresh();
      });
      children.push(picker);
    }
    if (!selected) return [text('p', 'Selecciona una unidad en Acceso.')];
    const rows = await list('/demos', { id_vehiculo: String(selected) });
    const add = button('Nueva demo', guarded(() => editDemo(selected)), 'button-primary');
    add.disabled = !canEdit;
    return [...children, add, table(['Demo', 'Uso', 'Acciones'], rows.map(demo => {
      const edit = button('Editar', guarded(() => editDemo(selected, demo)));
      edit.disabled = !canEdit;
      return [demo.nombre, demo.exhibicion ? 'Exhibición' : 'Privada',
        showActions(edit, button('Eliminar', remove(`/demos/${demo.id_demo}`, 'Dar de baja esta demo', selected)))];
    }))];
  }

  async function refresh(notice = '') {
    if (!active || !role) return;
    const current = ++version;
    status('Cargando…');
    root.replaceChildren();
    lookup('admin-context').textContent = role === 'BUYER' && vehicle ? `Unidad ${vehicle}` : '';
    lookup('admin-tabs').replaceChildren(...allowedSections().map(key => {
      const tab = button(sectionNames[key], () => { section = key; void refresh(); });
      tab.setAttribute('aria-pressed', String(section === key));
      return tab;
    }));
    try {
      const children = await content(current);
      if (current === version) { root.replaceChildren(...children); status(notice); }
    } catch (error) { if (current === version) status(error.message); }
  }

  return {
    setActive(value) {
      active = value;
      if (active) void refresh();
      else { ++version; if (dialog.open) dialog.close(); }
    },
    setRole(value) {
      if (role === value) return;
      ++version;
      if (dialog.open) dialog.close();
      role = value;
      adminDemoVehicle = null;
      section = allowedSections()[0];
      void refresh();
    },
    setVehicle(value) {
      vehicle = value;
      void refresh();
    },
  };
}
