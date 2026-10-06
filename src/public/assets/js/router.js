// Roteador SPA mínimo baseado em pathname + history API.

// Deep-links antigos continuam vivos. /routines virou aba de Luz, e os alvos
// WoL deixaram de morar em /devices.
const ALIASES = {
  '/config': '/devices',
  '/wol-targets': '/wol',
  '/routines': '/led/rotinas'
};

let routes = {};
let current = null;       // { cleanup }
let onChange = null;

function resolve(path) {
  const clean = (path || '/').split('?')[0];
  return ALIASES[clean] || clean;
}

function matched(path) {
  const p = resolve(path);
  return routes[p] ? p : '/';
}

async function render() {
  const path = matched(location.pathname);
  const route = routes[path];

  if (current && typeof current.cleanup === 'function') {
    try { current.cleanup(); } catch (e) {}
  }
  current = null;

  const view = document.getElementById('view');
  view.innerHTML = '';
  window.scrollTo(0, 0);

  if (onChange) onChange(path, route);

  const cleanup = await route.mount(view);
  current = { cleanup };
}

export const router = {
  start(routeConfig, changeCb) {
    routes = routeConfig;
    onChange = changeCb;

    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-link]');
      if (!link) return;
      const href = link.getAttribute('href');
      if (!href || href.startsWith('http') || link.target === '_blank') return;
      e.preventDefault();
      router.go(href);
    });

    window.addEventListener('popstate', render);
    render();
  },

  go(path) {
    const target = resolve(path);
    if (resolve(location.pathname) === target) return;
    history.pushState({}, '', target);
    render();
  },

  current() { return matched(location.pathname); }
};
