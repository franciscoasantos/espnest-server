// Luz: o shell das sub-telas. Agora · Cenas · Rotinas.
//
// Rotinas mora aqui porque toda ação do agendador é de LED — era um item de
// menu sem ser um domínio.
//
// A troca de aba NÃO passa pelo roteador de propósito. router.js roda cleanup()
// e zera o innerHTML a cada rota; se cada toque numa aba passasse por ali, o
// createColorControl seria destruído e o drawRing() refeito — um laço por pixel
// sobre 280×280, ~78 mil iterações — a cada toque. Em vez disso as rotas são
// reais (deep-link, voltar, atalho salvo), mas cada painel é montado sob
// demanda e mantido montado; trocar de aba é pushState + alternar `hidden`.
//
// O popstate continua caindo no render() do roteador, que remonta a view já na
// aba certa: o custo do remount fica só no botão voltar.

import { store } from '../store.js';
import { icon } from '../ui.js';
import * as now from './led/now.js';
import * as scenes from './led/scenes.js';
import * as routines from './led/routines.js';

const TABS = [
  { sub: 'agora', path: '/led', label: 'Agora', title: 'Luz', panel: now },
  { sub: 'cenas', path: '/led/cenas', label: 'Cenas', title: 'Cenas', panel: scenes },
  { sub: 'rotinas', path: '/led/rotinas', label: 'Rotinas', title: 'Rotinas', panel: routines }
];

function tabFromPath(pathname) {
  const clean = (pathname || '/led').split('?')[0].replace(/\/$/, '') || '/led';
  return TABS.find((t) => t.path === clean) || TABS[0];
}

export async function mount(view) {
  view.innerHTML = `
    <div data-guard></div>
    <div class="seg mb-5" role="tablist">
      ${TABS.map((t) => `
        <button data-tab="${t.sub}" class="seg-item" role="tab">${t.label}</button>`).join('')}
    </div>
    ${TABS.map((t) => `<div data-panel="${t.sub}" class="hidden"></div>`).join('')}`;

  const guard = view.querySelector('[data-guard]');

  // A guarda vive no shell, então as três abas herdam o aviso. Antes, Rotinas
  // não tinha nenhuma: só reclamava por toast depois do formulário preenchido.
  function refreshGuard() {
    if (!store.clients.length) {
      guard.innerHTML = `
        <div class="card mb-5 flex flex-wrap items-center gap-2 p-4 text-sm">
          ${icon('devices', 'h-5 w-5')} Nenhum dispositivo cadastrado.
          <a href="/devices" data-link class="font-medium hover:underline" style="color:rgb(var(--led))">Cadastrar</a>
        </div>`;
    } else if (!store.selection.size) {
      guard.innerHTML = `
        <div class="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          Nenhum dispositivo selecionado. Toque no indicador do topo para escolher.
        </div>`;
    } else {
      guard.innerHTML = '';
    }
  }

  // sub -> cleanup do painel montado. Montar sob demanda evita pagar por telas
  // que a pessoa nunca abriu na sessão.
  const mounted = new Map();
  let activeSub = null;

  function panelEl(sub) {
    return view.querySelector(`[data-panel="${sub}"]`);
  }

  function show(sub) {
    const tab = TABS.find((t) => t.sub === sub) || TABS[0];

    TABS.forEach((t) => {
      panelEl(t.sub).classList.toggle('hidden', t.sub !== tab.sub);
      const btn = view.querySelector(`[data-tab="${t.sub}"]`);
      const active = t.sub === tab.sub;
      btn.classList.toggle('seg-item-active', active);
      btn.setAttribute('aria-selected', String(active));
    });

    if (!mounted.has(tab.sub)) {
      mounted.set(tab.sub, tab.panel.mount(panelEl(tab.sub)) || (() => {}));
    }

    activeSub = tab.sub;

    // led.js não pode importar main.js (ciclo), então o título é atualizado
    // direto. A navegação lateral continua correta sozinha porque setActiveNav
    // casa por prefixo.
    const title = document.getElementById('page-title');
    if (title) title.textContent = tab.title;
    document.title = `${tab.title} · EspNest`;
  }

  function goSub(sub) {
    const tab = TABS.find((t) => t.sub === sub) || TABS[0];
    if (tab.sub === activeSub) return;
    history.pushState({}, '', tab.path);
    show(tab.sub);
  }

  view.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.onclick = () => goSub(btn.dataset.tab);
  });

  await store.refreshClients().catch(() => {});
  refreshGuard();
  show(tabFromPath(location.pathname).sub);

  const offs = [
    store.on('selection', refreshGuard),
    store.on('clients', refreshGuard),
    store.on('status', refreshGuard)
  ];

  return () => {
    offs.forEach((off) => off());
    // Cada painel devolveu o próprio cleanup; todos precisam rodar, inclusive
    // os das abas que ficaram em segundo plano (timers e listeners de window).
    mounted.forEach((cleanup) => {
      try { cleanup(); } catch (e) { /* um painel não pode derrubar os outros */ }
    });
    mounted.clear();
  };
}
