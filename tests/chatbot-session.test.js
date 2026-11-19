import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatSession } from '../assets/js/chatbot/session.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const answer = action => ({ mensaje: 'Propuesta interpretada.', accion: action });
const move = () => answer({ tipo: 'comando', id_comando: 42, duracion_ms: 1000 });
const proposal = () => ({
  ...answer({ tipo: 'crear_comando', comando: { id_vehiculo: 1, nombre: 'AUXILIAR', codigo: 15, descripcion: null } }),
  confirmacion: { token: 'opaque-confirmation-token', resumen: 'Crear AUXILIAR', expira_en_segundos: 60 },
});

function fixture({ enabled = true } = {}) {
  const interpretations = [], confirmations = [], executions = [], messages = [], busy = [], proposals = [];
  const control = {
    epoch: 0, refreshes: 0, execute: null,
    version() { return this.epoch; },
    async executeAssistant(action, options = {}) {
      executions.push({ action, options });
      if (options.expectedEpoch !== undefined && options.expectedEpoch !== this.epoch) {
        throw new Error('Otro control intervino.');
      }
      if (action.tipo === 'detener') ++this.epoch;
      return this.execute ? this.execute(action, options) : 'Aceptado por el control.';
    },
    async connect() { ++this.refreshes; },
  };
  const api = {
    interpret(...args) {
      const pending = deferred(); interpretations.push({ args, ...pending }); return pending.promise;
    },
    confirmAssistant(...args) {
      const pending = deferred(); confirmations.push({ args, ...pending }); return pending.promise;
    },
  };
  let serial = 0;
  const session = new ChatSession(api, control, {
    enabled, requestId: () => `request-${++serial}`,
    onMessage: (...message) => messages.push(message), onBusy: value => busy.push(value),
    onConfirmation: value => proposals.push(value),
  });
  return { session, api, control, interpretations, confirmations, executions, messages, busy, proposals };
}

async function prepareProposal(f) {
  const task = f.session.submit('Crea un comando auxiliar');
  f.interpretations[0].resolve(proposal());
  assert.equal(await task, true);
  return f.session.confirmation;
}

test('rechaza texto vacío/largo y modo simulado sin interpretar ni ejecutar', async () => {
  const f = fixture();
  assert.equal(await f.session.submit('   '), false);
  assert.equal(await f.session.submit('x'.repeat(1001)), false);
  assert.equal(f.interpretations.length, 0);
  const disabled = fixture({ enabled: false });
  assert.equal(await disabled.session.submit('avanza'), false);
  assert.equal(disabled.interpretations.length, 0);
  assert.equal(disabled.executions.length, 0);
});

test('un movimiento espera interpretación y conserva la versión capturada', async () => {
  const f = fixture();
  const task = f.session.submit('  avanza  ');
  assert.equal(f.session.busy, true);
  assert.equal(f.interpretations[0].args[0], 'avanza');
  assert.equal(f.interpretations[0].args[1], 'request-1');
  assert.ok(f.interpretations[0].args[2].signal instanceof AbortSignal);
  assert.equal(f.executions.length, 0);
  f.interpretations[0].resolve(move());
  assert.equal(await task, true);
  assert.equal(f.executions.length, 1);
  assert.deepEqual(f.executions[0].action, move().accion);
  assert.equal(f.executions[0].options.expectedEpoch, 0);
  assert.strictEqual(f.executions[0].options.signal, f.interpretations[0].args[2].signal);
  assert.equal(f.session.busy, false);
});

test('otra petición normal no se acumula mientras la anterior está ocupada', async () => {
  const f = fixture();
  const task = f.session.submit('avanza');
  assert.equal(await f.session.submit('retrocede'), false);
  assert.equal(f.interpretations.length, 1);
  f.interpretations[0].resolve(move()); await task;
});

test('DETENER es prioritario, aborta interpretación y nunca espera al modelo', async () => {
  const f = fixture();
  const old = f.session.submit('avanza');
  const stopping = deferred();
  f.control.execute = action => action.tipo === 'detener' ? stopping.promise : 'No debe ejecutarse';
  const stop = f.session.submit('DETENER');
  assert.equal(f.interpretations[0].args[2].signal.aborted, true);
  assert.equal(f.interpretations.length, 1);
  assert.deepEqual(f.executions.map(item => item.action), [{ tipo: 'detener' }]);
  f.interpretations[0].resolve(move());
  assert.equal(await old, false);
  assert.equal(f.session.busy, true, 'el finally viejo no libera la parada nueva');
  stopping.resolve('DETENER aceptado.');
  assert.equal(await stop, true);
  assert.equal(f.session.busy, false);
  assert.ok(!f.messages.some(([, text]) => text === 'No debe ejecutarse'));
});

test('una negación no se interpreta como la parada prioritaria', async () => {
  const f = fixture();
  const task = f.session.submit('no detener');
  assert.equal(f.interpretations.length, 1);
  f.interpretations[0].resolve(answer({ tipo: 'respuesta' })); await task;
  assert.equal(f.executions.length, 0);
});

test('cerrar o destruir durante la interpretación invalida incluso una respuesta que ignora abort', async () => {
  for (const method of ['interrupt', 'destroy']) {
    const f = fixture(); const task = f.session.submit('avanza');
    f.session[method]();
    f.interpretations[0].resolve(move());
    assert.equal(await task, false);
    assert.equal(f.executions.length, 0);
    assert.equal(f.session.busy, false);
    assert.equal(f.interpretations[0].args[2].signal.aborted, true);
  }
});

test('una intervención del joystick invalida el movimiento al comprobar expectedEpoch', async () => {
  const f = fixture(); const task = f.session.submit('avanza');
  ++f.control.epoch;
  f.interpretations[0].resolve(move());
  assert.equal(await task, false);
  assert.equal(f.executions[0].options.expectedEpoch, 0);
  assert.ok(f.messages.some(([role, message]) => role === 'error' && /Otro control/.test(message)));
});

test('cerrar mientras el control espera WSS aborta también la ejecución delegada', async () => {
  const f = fixture();
  let executeSignal, lateActivations = 0;
  const websocketReady = deferred();
  f.control.execute = async (action, { signal }) => {
    executeSignal = signal;
    await websocketReady.promise;
    if (signal.aborted) throw new Error('Petición cancelada antes de activar.');
    ++lateActivations;
    return 'DEMO iniciada.';
  };
  const task = f.session.submit('inicia la demo');
  f.interpretations[0].resolve(answer({ tipo: 'demo', id_demo: 1 }));
  await Promise.resolve();
  assert.ok(executeSignal instanceof AbortSignal);
  f.session.interrupt();
  assert.equal(executeSignal.aborted, true);
  websocketReady.resolve();
  assert.equal(await task, false);
  assert.equal(lateActivations, 0);
  assert.ok(!f.messages.some(([, message]) => message === 'DEMO iniciada.'));
});

test('consultas de estado/catálogo solo muestran respuesta y no activan control', async () => {
  for (const tipo of ['estado', 'historial', 'catalogo', 'respuesta']) {
    const f = fixture(); const task = f.session.submit('consulta');
    f.interpretations[0].resolve(answer({ tipo }));
    assert.equal(await task, true); assert.equal(f.executions.length, 0);
  }
});

test('crear y eliminar requieren confirmación explícita aunque el modelo proponga la acción', async () => {
  for (const tipo of ['crear_comando', 'eliminar_comando']) {
    const f = fixture(); const task = f.session.submit('cambia el catálogo');
    f.interpretations[0].resolve(answer({ tipo, id_comando: 42 }));
    assert.equal(await task, false);
    assert.equal(f.confirmations.length, 0);
    assert.equal(f.executions.length, 0);
    assert.match(f.messages.at(-1)[1], /confirmación explícita/);
  }
});

test('una confirmación para un movimiento se rechaza sin actuar', async () => {
  const f = fixture(); const task = f.session.submit('avanza');
  f.interpretations[0].resolve({ ...move(), confirmacion: proposal().confirmacion });
  assert.equal(await task, false);
  assert.equal(f.executions.length, 0);
  assert.equal(f.session.confirmation, null);
});

test('la clave administrativa solo se entrega a confirmar, nunca a interpretación ni mensajes', async () => {
  const f = fixture(); const pending = await prepareProposal(f);
  assert.equal(f.confirmations.length, 0, 'mostrar la propuesta no la confirma');
  assert.equal(await f.session.confirm(''), false);
  const secret = 'secret-used-only-by-confirmation';
  const task = f.session.confirm(secret);
  assert.deepEqual(f.confirmations[0].args.slice(0, 3), [pending.token, pending.requestId, secret]);
  assert.ok(f.confirmations[0].args[3].signal instanceof AbortSignal);
  f.confirmations[0].resolve({ mensaje: 'Catálogo actualizado.' });
  assert.equal(await task, true);
  assert.equal(f.control.refreshes, 1);
  assert.equal(f.session.confirmation, null);
  assert.ok(!JSON.stringify(f.interpretations.map(item => item.args)).includes(secret));
  assert.ok(!JSON.stringify(f.messages).includes(secret));
  assert.equal(f.executions.length, 0, 'crear un registro no acciona motores');
});

test('doble confirmar se envía una vez y un 400 conserva token/request ID para reintento explícito', async () => {
  const f = fixture(); const pending = await prepareProposal(f);
  const first = f.session.confirm('incorrecta');
  assert.equal(await f.session.confirm('repetida'), false);
  assert.equal(f.confirmations.length, 1);
  f.confirmations[0].reject(Object.assign(new Error('Clave no válida.'), { status: 400 }));
  assert.equal(await first, false);
  assert.strictEqual(f.session.confirmation, pending);
  assert.equal(f.confirmations.length, 1, 'no hay reintento automático');
  const retry = f.session.confirm('corregida');
  assert.deepEqual(f.confirmations[1].args.slice(0, 2), f.confirmations[0].args.slice(0, 2));
  f.confirmations[1].resolve({ mensaje: 'Confirmado.' });
  assert.equal(await retry, true);
  assert.equal(f.control.refreshes, 1);
});

test('una confirmación caducada/cancelada no envía la clave ni cambia catálogo', async () => {
  const f = fixture(); await prepareProposal(f);
  f.session.confirmation.expiresAt = Date.now() - 1;
  assert.equal(await f.session.confirm('clave'), false);
  assert.equal(f.confirmations.length, 0);
  assert.equal(f.session.confirmation, null);
  assert.match(f.messages.at(-1)[1], /caducó/);
  f.session.clearConfirmation();
  assert.equal(await f.session.confirm('clave'), false);
});

test('cerrar durante confirmación ignora su resultado tardío y no refresca la sesión nueva', async () => {
  const f = fixture(); await prepareProposal(f);
  const task = f.session.confirm('clave'); f.session.interrupt();
  assert.equal(f.confirmations[0].args[3].signal.aborted, true);
  f.confirmations[0].resolve({ mensaje: 'Respuesta anterior.' });
  assert.equal(await task, false);
  assert.equal(f.control.refreshes, 0);
  assert.ok(!f.messages.some(([, message]) => message === 'Respuesta anterior.'));
});

test('404 del backend produce una instrucción concreta sin reintentar ni mover', async () => {
  const f = fixture(); const task = f.session.submit('avanza');
  f.interpretations[0].reject(Object.assign(new Error('Not Found'), { status: 404 }));
  assert.equal(await task, false);
  assert.match(f.messages.at(-1)[1], /backend de EC2/);
  assert.equal(f.interpretations.length, 1); assert.equal(f.executions.length, 0);
});
