import { VERTEX, FRAGMENT, PERSPECTIVE, clamp, compile, parseColor } from './holo-shader.js';

// Share one renderer across the existing panels. Keep the real DOM above its foil.
export function bindHoloCards(cards) {
  const listeners = new AbortController();
  const signal = listeners.signal;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let shown;
  let renderer;
  let position;
  let frame = 0;

  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    shown?.removeAttribute('data-foil-active');
    renderer?.canvas.remove();
    shown = undefined;
  }

  function draw() {
    frame = 0;
    if (!shown || !position) return;
    const { x, y } = position;
    const tiltX = (0.5 - y) * 28;
    const tiltY = (x - 0.5) * 28;
    shown.style.setProperty('--foil-x', `${x * 100}%`);
    shown.style.setProperty('--foil-y', `${y * 100}%`);
    shown.style.setProperty('--foil-tilt-x', `${tiltX}deg`);
    shown.style.setProperty('--foil-tilt-y', `${tiltY}deg`);
    renderer?.draw(shown, x, y, tiltX, tiltY);
  }

  for (const card of cards) {
    card.classList.add('terra-holo');
    card.addEventListener('pointerenter', event => {
      if (reduced.matches || event.pointerType === 'touch') return;
      reset();
      shown = card;
      if (renderer === undefined) renderer = makeFoil();
      if (renderer) shown.append(renderer.canvas);
      shown.setAttribute('data-foil-active', '');
    }, { signal });
    card.addEventListener('pointermove', event => {
      if (shown !== card) return;
      // A transformed rect changes with tilt. offsetX/Y would refer to each child.
      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      position = {
        x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
        y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
      };
      if (!frame) frame = requestAnimationFrame(draw);
    }, { signal, passive: true });
    card.addEventListener('pointerleave', () => { if (shown === card) reset(); }, { signal });
  }
  reduced.addEventListener('change', reset, { signal });
  return () => { listeners.abort(); reset(); renderer?.destroy(); };
}

function makeFoil() {
  const canvas = document.createElement('canvas');
  canvas.className = 'terra-holo-foil';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
  if (!gl) return null;
  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, 'position');
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const names = ['uArt', 'uSize', 'uAspect', 'uTilt', 'uLight', 'uDistance', 'uIntensity',
    'uScale', 'uEdge', 'uFrame', 'uRadius', 'uGlare', 'uFoil', 'uReady'];
  const u = Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)]));
  const foil = parseColor('#e2e6ec');
  return {
    canvas,
    draw(card, x, y, tiltX, tiltY) {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const cssWidth = Math.max(1, card.clientWidth);
      const width = Math.max(1, Math.round(cssWidth * ratio));
      const height = Math.max(1, Math.round(card.clientHeight * ratio));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.uniform1i(u.uArt, 0);
      gl.uniform2f(u.uSize, width, height);
      gl.uniform1f(u.uAspect, height / width);
      gl.uniform2f(u.uTilt, tiltX * Math.PI / 180, tiltY * Math.PI / 180);
      gl.uniform2f(u.uLight, x, y);
      gl.uniform1f(u.uDistance, PERSPECTIVE / cssWidth);
      gl.uniform1f(u.uIntensity, 0.85);
      gl.uniform1f(u.uScale, 1);
      gl.uniform1f(u.uEdge, 0.8);
      gl.uniform1f(u.uFrame, 0.04);
      gl.uniform1f(u.uRadius, 14 / cssWidth);
      gl.uniform1f(u.uGlare, 0.5);
      gl.uniform3f(u.uFoil, ...foil);
      gl.uniform1f(u.uReady, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    destroy() { gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteProgram(program); },
  };
}
