const byId = id => document.getElementById(id);
const roleNames = { ADMIN: 'Administrador', BUYER: 'Comprador', GUEST: 'Invitado' };
const duration = (expiry, now) => Math.max(0, Math.ceil((Date.parse(expiry) - now) / 1000) || 0);

export function createAccess({ api, auth, changeVehicle, changePermissions, stopBeforeRelease }) {
  const dialog = byId('access-dialog');
  const form = byId('login-form');
  const units = byId('access-units');
  const leaseButton = byId('lease-button');
  const status = byId('access-status');
  let session = null;
  let vehicle = null;
  let deadline = null;
  let renewAfter = 0;
  let renewal = null;
  let pending = false;
  let revision = 0;
  let catalogRevision = 0;
  const tell = message => { status.textContent = message; };
  const setLease = value => {
    deadline = duration(value, Date.now()) > 0 ? value : null;
    renewAfter = Date.now() + 45_000;
    changePermissions(session, Boolean(deadline));
    draw();
  };

  function draw() {
    byId('access-identity').textContent = session ? roleNames[session.role] : '';
    form.hidden = Boolean(session);
    byId('logout-button').hidden = !session;
    byId('logout-button').disabled = pending;
    byId('access-units-title').textContent = session?.role === 'BUYER' ? 'Mis vehículos'
      : session?.role === 'ADMIN' ? 'Unidades' : 'Exhibición pública';
    leaseButton.hidden = !session || !vehicle;
    leaseButton.disabled = pending;
    const seconds = deadline ? duration(deadline, Date.now()) : 0;
    const remaining = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    leaseButton.textContent = deadline ? `Liberar · ${remaining}` : 'Tomar control';
    leaseButton.setAttribute('aria-label', deadline ? 'Liberar el vehículo' : 'Tomar control del vehículo');
  }

  async function loadUnits() {
    const version = ++catalogRevision;
    units.replaceChildren();
    try {
      const rows = await api.vehicles();
      if (version !== catalogRevision) return;
      for (const unit of rows.filter(item => item.activo !== false && item.activo !== 0)) {
        const article = document.createElement('article');
        article.className = 'commercial-unit';
        const title = document.createElement('div');
        const name = document.createElement('strong');
        name.textContent = unit.nombre;
        const model = document.createElement('p');
        model.textContent = unit.modelo || `Unidad ${unit.id_vehiculo}`;
        title.append(name, model);
        const select = document.createElement('button');
        select.type = 'button';
        select.className = 'icon-button';
        select.textContent = session ? 'Seleccionar' : 'Probar 15 min';
        select.disabled = Boolean(session?.role === 'GUEST');
        select.addEventListener('click', () => void run(async () => {
          if (!session) {
            const signed = await api.commercial(`/auth/invitado/${unit.id_vehiculo}`, { method: 'POST' });
            await changeSession(signed);
            await selectUnit(unit);
            setLease(signed.control_expires_at || signed.expires_at);
          } else await selectUnit(unit);
          dialog.close();
        }));
        article.append(title, select);
        units.append(article);
      }
      if (!units.childElementCount) units.textContent = 'No hay unidades disponibles en este catálogo.';
    } catch (error) { if (version === catalogRevision) tell(error.message); }
  }

  async function changeSession(next) {
    ++revision;
    ++catalogRevision;
    session = next;
    auth.token = next?.access_token ?? null;
    changePermissions(session, Boolean(deadline));
    draw();
  }

  async function release() {
    if (!vehicle || !deadline) return;
    await stopBeforeRelease();
    await renewal;
    await api.commercial(`/auth/control/${vehicle.id_vehiculo}`, { method: 'DELETE' });
    ++revision;
    setLease(null);
  }

  async function selectUnit(next) {
    if (vehicle?.id_vehiculo === next.id_vehiculo) return;
    await release();
    ++revision;
    vehicle = next;
    await changeVehicle(next);
    draw();
  }

  async function signOut(notify = true) {
    if (notify && session) {
      await stopBeforeRelease();
      await renewal;
      await api.commercial('/auth/logout', { method: 'POST' });
    }
    setLease(null);
    vehicle = null;
    await changeSession(null);
    await changeVehicle(null);
    if (dialog.open) await loadUnits();
  }

  async function run(task) {
    if (pending) return;
    pending = true;
    tell('');
    draw();
    const submit = form.querySelector('button[type=submit]');
    submit.disabled = true;
    try {
      await task();
    } catch (error) {
      tell(error.message);
      if (!dialog.open) dialog.showModal();
    } finally {
      pending = false;
      submit.disabled = false;
      draw();
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const data = new FormData(form);
    void run(async () => {
      try {
        await changeSession(await api.commercial('/auth/login', { method: 'POST', body: {
          email: data.get('email'), password: data.get('password'),
        } }));
        await loadUnits();
      } finally { form.elements.password.value = ''; }
    });
  });
  byId('open-access').addEventListener('click', () => {
    tell('');
    dialog.showModal();
    void loadUnits();
  });
  byId('close-access').addEventListener('click', () => dialog.close());
  byId('logout-button').addEventListener('click', () => void run(signOut));
  leaseButton.addEventListener('click', () => void run(async () => {
    if (deadline) {
      if (session?.role === 'GUEST') await signOut();
      else await release();
      return;
    }
    const result = await api.commercial(`/auth/control/${vehicle.id_vehiculo}`, { method: 'POST' });
    setLease(result.control_expires_at || result.expires_at);
  }));
  const tick = setInterval(() => {
    if (!session) return;
    if (duration(session.expires_at, Date.now()) === 0) {
      void signOut(false);
      return;
    }
    if (deadline && duration(deadline, Date.now()) === 0) setLease(null);
    if (deadline && session.role !== 'GUEST' && !pending && !document.hidden && Date.now() >= renewAfter) {
      renewAfter = Date.now() + 45_000;
      const version = revision;
      renewal = api.commercial(`/auth/control/${vehicle.id_vehiculo}`, { method: 'POST' }).then(result => {
        if (version === revision && deadline) setLease(result.control_expires_at || result.expires_at);
      }, () => {
        if (version === revision) setLease(null);
      }).finally(() => { renewal = null; });
    }
    draw();
  }, 1000);
  draw();
  return {
    get session() { return session; },
    get vehicle() { return vehicle; },
    lostConnection() {
      if (!deadline) return;
      ++revision;
      setLease(null);
      if (session?.role === 'GUEST') void signOut(false);
    },
    destroy() { clearInterval(tick); },
  };
}
