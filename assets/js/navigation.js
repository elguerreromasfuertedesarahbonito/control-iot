/** Navegación por fragmentos: compatible con la subruta de GitHub Pages. */
export function createNavigation({ onChange = () => {} } = {}) {
  const panes = { control: document.getElementById('control-view'), monitoreo: document.getElementById('monitor-view') };
  const links = [...document.querySelectorAll('.view-link[data-view]')];
  let current = null;
  const update = () => {
    const view = location.hash === '#monitoreo' ? 'monitoreo' : 'control';
    if (current === view) return;
    // Libera la entrada manual antes de ocultar CONTROL, sin cancelar una DEMO.
    onChange(view);
    for (const [key, pane] of Object.entries(panes)) {
      pane.hidden = key !== view;
      pane.inert = key !== view;
    }
    for (const link of links) {
      if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    document.body.dataset.view = view;
    current = view;
  };
  window.addEventListener('hashchange', update);
  update();
  return { destroy() { window.removeEventListener('hashchange', update); } };
}
