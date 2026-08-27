// Entrypoint: monta o chrome persistente, inicia SSE e o roteador SPA.

import { store } from './store.js';
import { router } from './router.js';
import { icon, themeIcon, toggleTheme, $, $$ } from './ui.js';
import { initDeviceBar } from './components/deviceSelector.js';
import { initLiveAccent } from './liveAccent.js';

import * as dashboard from './views/dashboard.js';
import * as led from './views/led.js';
import * as wol from './views/wol.js';
import * as devices from './views/devices.js';

// Quatro itens: Rotinas passou a ser uma aba dentro de Luz, já que toda ação
// do agendador é de LED. Quatro alvos também dão mais folga ao polegar na
// barra inferior.
const NAV = [
  { path: '/', label: 'Início', icon: 'dashboard' },
  { path: '/led', label: 'Luz', icon: 'led' },
  { path: '/wol', label: 'Wake-on-LAN', short: 'WoL', icon: 'wol' },
  { path: '/devices', label: 'Dispositivos', short: 'Disp.', icon: 'devices' }
];

// As sub-rotas de Luz apontam para o mesmo shell; ele lê o pathname e abre a
// aba certa. Existem para deep-link e botão voltar funcionarem — a troca de aba
// no dia a dia não passa por aqui (ver views/led.js).
// Rota nova aqui exige rota nova na whitelist de src/server.js.
const ROUTES = {
  '/': { title: 'Início', deviceBar: false, mount: dashboard.mount },
  '/led': { title: 'Luz', deviceBar: true, mount: led.mount },
  '/led/cenas': { title: 'Cenas', deviceBar: true, mount: led.mount },
  '/led/rotinas': { title: 'Rotinas', deviceBar: true, mount: led.mount },
  '/wol': { title: 'Wake-on-LAN', deviceBar: true, mount: wol.mount },
  '/devices': { title: 'Dispositivos', deviceBar: false, mount: devices.mount }
};

/* ------------------------------ navegação ------------------------------ */

function renderNav() {
  $('#nav-links').innerHTML = NAV.map((n) => `
    <a href="${n.path}" data-link data-route="${n.path}" class="navlink">
      ${icon(n.icon)} ${n.label}
    </a>`).join('');

  $('#bottom-nav').innerHTML = NAV.map((n) => `
    <a href="${n.path}" data-link data-route="${n.path}" class="navtab">
      ${icon(n.icon, 'h-5 w-5')}
      <span class="text-[10px] font-medium">${n.short || n.label}</span>
    </a>`).join('');
}

function setActiveNav(path) {
  $$('[data-route]').forEach((a) => {
    const route = a.dataset.route;
    // Prefixo, e não igualdade: /led/rotinas precisa manter "Luz" aceso. Com
    // igualdade exata, uma sub-rota apagava todos os itens da navegação.
    const active = route === '/'
      ? path === '/'
      : (path === route || path.startsWith(`${route}/`));
    a.classList.toggle('navlink-active', active && !!a.closest('#nav-links'));
    a.classList.toggle('navtab-active', active && !!a.closest('#bottom-nav'));
  });
}

/* --------------------------- chrome / topbar --------------------------- */

function setupChrome() {
  // Tema
  const themeBtn = $('#theme-btn');
  themeBtn.innerHTML = themeIcon();
  themeBtn.onclick = () => { toggleTheme(); themeBtn.innerHTML = themeIcon(); };

  // Menu mobile
  const sidebar = $('#sidebar');
  const backdrop = $('#sidebar-backdrop');
  const open = () => { sidebar.classList.remove('-translate-x-full'); backdrop.classList.remove('hidden'); };
  const close = () => { sidebar.classList.add('-translate-x-full'); backdrop.classList.add('hidden'); };
  $('#menu-btn').onclick = open;
  backdrop.onclick = close;
  document.addEventListener('click', (e) => { if (e.target.closest('a[data-link]')) close(); });

  // Indicador de conexão — que é também o botão da barra de seleção.
  const dot = $('#conn-dot');
  const text = $('#conn-text');
  const indicator = $('#conn-indicator');

  function updateConn() {
    const total = store.clients.length;
    const online = store.clients.filter((c) => store.isConnected(c.espMac)).length;
    // Sem `sm:`: no celular é onde o badge mais importa, porque é lá que ele
    // substitui a barra de seleção sempre aberta.
    indicator.classList.toggle('hidden', total === 0);
    indicator.classList.toggle('flex', total > 0);
    dot.className = `h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-zinc-400'}`;
    text.textContent = online ? `${online}/${total} online` : 'Tudo offline';
  }

  store.on('status', updateConn);
  store.on('clients', updateConn);
  updateConn();
}

/* ------------------------------- bootstrap ------------------------------ */

renderNav();
setupChrome();
store.initSSE();
initLiveAccent();
initDeviceBar($('#device-bar'));

/* ------------------- barra de seleção (abre pelo badge) ----------------- */

// A barra deixou de ficar sempre aberta: quem abre e fecha é o badge "N/M
// online" do topo. Numa tela de celular ela custava uma faixa inteira logo
// abaixo de um header de 64 px, e na maior parte do tempo a seleção não muda.
const BAR_KEY = 'espnest:devicebar';

function loadBarOpen() {
  try { return localStorage.getItem(BAR_KEY) === '1'; } catch (e) { return false; }
}

const deviceBar = $('#device-bar');
const indicator = $('#conn-indicator');
const chevron = $('#conn-chevron');

let barOpen = loadBarOpen();
let routeUsesBar = false;

function syncDeviceBar() {
  const visible = routeUsesBar && barOpen;
  deviceBar.classList.toggle('hidden', !visible);

  // Nas telas sem seleção (Início, Dispositivos) o badge volta a ser apenas
  // informativo: sem seta e sem realce de clique.
  chevron.classList.toggle('hidden', !routeUsesBar);
  chevron.innerHTML = routeUsesBar
    ? icon('chevron', `h-3.5 w-3.5 transition-transform${visible ? ' rotate-180' : ''}`)
    : '';
  indicator.classList.toggle('hover:bg-zinc-100', routeUsesBar);
  indicator.classList.toggle('dark:hover:bg-zinc-800', routeUsesBar);
  indicator.classList.toggle('cursor-default', !routeUsesBar);
  indicator.setAttribute('aria-expanded', String(visible));
}

indicator.onclick = () => {
  if (!routeUsesBar) return;
  barOpen = !barOpen;
  try { localStorage.setItem(BAR_KEY, barOpen ? '1' : '0'); } catch (e) {}
  syncDeviceBar();
};

router.start(ROUTES, (path, route) => {
  $('#page-title').textContent = route.title;
  document.title = `${route.title} · EspNest`;
  setActiveNav(path);
  routeUsesBar = !!route.deviceBar;
  syncDeviceBar();
});
