import { bindHoloCards } from './effects/holo-card.js';

const PALETTES = [
  ['steel', 'Negro / plateado', '#22242c', '#b9c6d3'],
  ['signal', 'Azul / amarillo', '#184a8f', '#ffda55'],
  ['rose', 'Blanco / rosa', '#fff5f7', '#d94182'],
  ['eva', 'Morado / verde', '#442399', '#a4eb46'],
];
const STORAGE_KEY = 'terra.palette';
const HOLD_MS = 2000;

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

function installPalette(signal) {
  const host = document.getElementById('palette-slot') ?? document.querySelector('.header-actions');
  if (!host) return;
  const details = element('details', 'terra-palette');
  const trigger = element('summary', 'terra-palette-trigger');
  trigger.setAttribute('aria-label', 'Paleta de colores');
  trigger.title = 'Paleta de colores';
  for (let i = 0; i < 4; i++) trigger.append(element('i', 'terra-palette-dot'));
  const options = element('div', 'terra-palette-options');
  let initial = 'signal';
  try { initial = localStorage.getItem(STORAGE_KEY) ?? initial; } catch { /* Storage is optional. */ }
  const buttons = PALETTES.map(([id, label, base, accent]) => {
    const button = element('button', 'terra-palette-option');
    button.type = 'button';
    button.dataset.palette = id;
    const swatch = element('i', 'terra-palette-swatch');
    swatch.style.setProperty('--swatch-base', base);
    swatch.style.setProperty('--swatch-accent', accent);
    button.append(swatch, document.createTextNode(label));
    button.addEventListener('click', () => {
      apply(id);
      try { localStorage.setItem(STORAGE_KEY, id); } catch { /* Storage is optional. */ }
      details.open = false;
      trigger.focus();
    }, { signal });
    return button;
  });
  function apply(id) {
    document.documentElement.dataset.palette = id;
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.palette === id));
  }
  apply(PALETTES.some(([id]) => id === initial) ? initial : 'signal');
  options.append(...buttons);
  details.append(trigger, options);
  if (host.id === 'palette-slot') host.append(details);
  else host.prepend(details);
  document.addEventListener('pointerdown', event => {
    if (details.open && !details.contains(event.target)) details.open = false;
  }, { signal, passive: true });
  details.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !details.open) return;
    details.open = false;
    trigger.focus();
  }, { signal });
  return () => details.remove();
}

function installChatEffects() {
  const mic = document.getElementById('chat-mic');
  const status = document.getElementById('chat-status');
  const form = document.getElementById('chat-form');
  if (!mic || !status || !form) return;
  const loader = element('span', 'terra-lattice');
  loader.hidden = true;
  loader.setAttribute('aria-hidden', 'true');
  const cells = element('span', 'terra-lattice-grid');
  for (const unit of [0, 1, 2, 7, null, 3, 6, 5, 4]) {
    const cell = element('i', 'terra-lattice-cell');
    if (unit === null) cell.dataset.hole = '';
    else cell.style.animationDelay = `${unit * 108}ms`;
    cells.append(cell);
  }
  const stopwatch = element('span', 'terra-lattice-time');
  loader.append(cells, element('span', 'terra-lattice-text', 'Pensando'), stopwatch);
  status.before(loader);

  const waveform = element('span', 'terra-voice-wave');
  for (let i = 0; i < 11; i++) {
    const bar = element('i', 'terra-voice-bar');
    bar.style.setProperty('--wave-phase', `${-(i * i + 7 * i) * 19}ms`);
    waveform.append(bar);
  }
  const voiceClock = element('span', 'terra-voice-time');
  const pill = element('span', 'terra-voice-pill');
  pill.setAttribute('aria-hidden', 'true');
  pill.append(waveform, voiceClock);
  mic.append(pill);
  mic.classList.add('terra-voice');
  let thinkingAt = null;
  let listeningAt = null;
  let timer;
  function updateTime() {
    if (thinkingAt !== null) {
      const seconds = Math.floor((performance.now() - thinkingAt) / 100) / 10;
      stopwatch.textContent = seconds < 60 ? `${seconds.toFixed(1)} s`
        : `${Math.floor(seconds / 60)} min ${(seconds % 60).toFixed(1)} s`;
    }
    if (listeningAt !== null) {
      const seconds = Math.floor((performance.now() - listeningAt) / 1000);
      voiceClock.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }
  }
  function sync() {
    const thinking = form.getAttribute('aria-busy') === 'true';
    const listening = mic.dataset.listening === 'true';
    loader.hidden = !thinking;
    status.classList.toggle('terra-lattice-status', thinking);
    thinkingAt = thinking ? thinkingAt ?? performance.now() : null;
    listeningAt = listening ? listeningAt ?? performance.now() : null;
    updateTime();
    if ((thinking || listening) && timer === undefined) timer = setInterval(updateTime, 100);
    if (!thinking && !listening && timer !== undefined) { clearInterval(timer); timer = undefined; }
  }
  const observer = new MutationObserver(sync);
  observer.observe(form, { attributes: true, attributeFilter: ['aria-busy'] });
  observer.observe(mic, { attributes: true, attributeFilter: ['data-listening'] });
  sync();
  return () => {
    observer.disconnect();
    clearInterval(timer);
    loader.remove();
    pill.remove();
    status.classList.remove('terra-lattice-status');
    mic.classList.remove('terra-voice');
  };
}

export function installVisualEffects() {
  const listeners = new AbortController();
  const signal = listeners.signal;
  const cleanPalette = installPalette(signal);
  const cleanChat = installChatEffects();
  const cleanHolo = bindHoloCards(document.querySelectorAll('.monitor-latest, .monitor-history, .monitor-connections .connection-card'));
  const paint = element('div', 'terra-balatro');
  const cursor = element('div', 'terra-glow');
  paint.setAttribute('aria-hidden', 'true');
  cursor.setAttribute('aria-hidden', 'true');
  document.body.prepend(paint);
  document.body.append(cursor);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  let cleanPaint;
  let cleanCursor;
  let generation = 0;
  async function loadEffects() {
    const run = ++generation;
    cleanPaint?.();
    cleanCursor?.();
    cleanPaint = cleanCursor = undefined;
    if (reduced.matches || signal.aborted) return;
    const [background, glow] = await Promise.allSettled([
      import('./effects/balatro.js'),
      finePointer.matches ? import('./effects/glow-cursor.js') : null,
    ]);
    if (run !== generation || signal.aborted) return;
    try {
      if (background.status === 'fulfilled') cleanPaint = background.value.mountBalatro(paint);
    } catch { /* CSS background remains available without an active GPU. */ }
    try {
      if (glow.status === 'fulfilled' && glow.value) cleanCursor = glow.value.mountGlowCursor(cursor);
    } catch { /* Keep the native focus and cursor if a shader is unavailable. */ }
  }
  reduced.addEventListener('change', loadEffects, { signal });
  finePointer.addEventListener('change', loadEffects, { signal });
  requestAnimationFrame(loadEffects);
  function cleanup() {
    if (signal.aborted) return;
    listeners.abort();
    cleanPalette?.();
    cleanChat?.();
    cleanHolo?.();
    cleanPaint?.();
    cleanCursor?.();
    paint.remove();
    cursor.remove();
  }
  window.addEventListener('pagehide', cleanup, { signal, once: true });
  return { destroy: cleanup };
}

export function bindDemoHold(button, start) {
  const listeners = new AbortController();
  const signal = listeners.signal;
  button.classList.add('terra-hold');
  button.setAttribute('aria-description', 'Mantén dos segundos para ejecutar la demostración.');
  let source = null;
  let completeTimer;
  let resetTimer;
  let rect;
  let lastGesture = -Infinity;

  function cancel() {
    clearTimeout(completeTimer);
    const previous = source;
    source = null;
    if (typeof previous === 'number' && button.hasPointerCapture?.(previous)) {
      try { button.releasePointerCapture(previous); } catch { /* Pointer already released. */ }
    }
    if (button.dataset.holdPhase === 'holding') button.dataset.holdPhase = 'idle';
  }

  function execute() {
    clearTimeout(completeTimer);
    button.dataset.holdPhase = 'done';
    lastGesture = performance.now();
    resetTimer = setTimeout(() => { button.dataset.holdPhase = 'idle'; }, 1200);
    start();
  }

  function begin(input) {
    if (button.disabled || source !== null || button.dataset.holdPhase === 'done') return false;
    source = input;
    lastGesture = performance.now();
    rect = button.getBoundingClientRect();
    button.dataset.holdPhase = 'holding';
    completeTimer = setTimeout(() => {
      if (button.disabled || document.hidden) { cancel(); return; }
      execute();
    }, HOLD_MS);
    return true;
  }
  button.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.isPrimary === false || !begin(event.pointerId)) return;
    try { button.setPointerCapture(event.pointerId); } catch { /* Window receives pointerup. */ }
  }, { signal });
  button.addEventListener('pointermove', event => {
    if (source !== event.pointerId) return;
    if (event.clientX < rect.left - 10 || event.clientX > rect.right + 10 ||
        event.clientY < rect.top - 10 || event.clientY > rect.bottom + 10) cancel();
  }, { signal, passive: true });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    window.addEventListener(type, event => { if (source === event.pointerId) cancel(); }, { signal });
  }
  button.addEventListener('keydown', event => {
    if (event.key === 'Escape') cancel();
    if (!['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (!event.repeat) begin(event.key);
  }, { signal });
  button.addEventListener('keyup', event => {
    if (source !== event.key) return;
    event.preventDefault();
    cancel();
  }, { signal });
  button.addEventListener('click', event => {
    const fromAssistiveInput = event.isTrusted && event.detail === 0 && performance.now() - lastGesture > 700;
    if (fromAssistiveInput && !button.disabled && window.confirm('¿Ejecutar la demostración seleccionada?')) execute();
  }, { signal });
  button.addEventListener('blur', cancel, { signal });
  window.addEventListener('blur', cancel, { signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); }, { signal });
  const observer = new MutationObserver(() => { if (button.disabled) cancel(); });
  observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
  return () => { listeners.abort(); observer.disconnect(); cancel(); clearTimeout(resetTimer); };
}
