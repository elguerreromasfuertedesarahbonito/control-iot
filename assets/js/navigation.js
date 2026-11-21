/** Navegación por fragmentos: compatible con la subruta de GitHub Pages. */
export function createNavigation({ onChange = () => {}, canOpen = () => true } = {}) {
  const panes = { control: document.getElementById('control-view'), monitoreo: document.getElementById('monitor-view'),
    administracion: document.getElementById('admin-view') };
  const links = [...document.querySelectorAll('.view-link[data-view]')];
  let current = null;
  const update = () => {
    const requested = location.hash.slice(1);
    const view = Object.hasOwn(panes, requested) && canOpen(requested) ? requested : 'control';
    for (const link of links) link.hidden = !canOpen(link.dataset.view);
    if (current === view) return;
    // Libera la entrada manual antes de ocultar CONTROL, sin cancelar una DEMO.
    onChange(view);
    for (const [key, pane] of Object.entries(panes)) {
      if (!pane) continue;
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
  return { update, destroy() { window.removeEventListener('hashchange', update); } };
}
