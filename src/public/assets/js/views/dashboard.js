// Dashboard: visão geral dos dispositivos com status ao vivo e ações rápidas.

import { store } from '../store.js';
import { api } from '../api.js';
import { router } from '../router.js';
import { icon, escapeHtml, toast, confirmModal } from '../ui.js';
import { showResult } from '../components/resultToast.js';
import { rgbwCss } from '../components/colorControl.js';

const EFFECT_LABELS = {
  breathing: 'Respiração',
  rainbow: 'Arco-íris',
  fade: 'Transição',
  fire: 'Fogo',
  comet: 'Cometa',
  twinkle: 'Estrelas',
  wave: 'Onda',
  wipe: 'Preenchimento'
};

function deviceCard(c) {
  const online = store.isConnected(c.espMac);
  const color = store.colorOf(c.espMac);
  const effect = store.effectOf(c.espMac);
  const isOff = !effect && color && !color.r && !color.g && !color.b && !color.w;

  // Swatch: bolinha animada para efeito, cor sólida, ou apagado
  let swatchStyle;
  if (effect === 'rainbow') {
    swatchStyle = 'background:conic-gradient(red,#ff0,#0f0,#0ff,#00f,#f0f,red)';
  } else if (color) {
    swatchStyle = `background:${rgbwCss(color)}`;
  } else {
    swatchStyle = 'background:transparent';
  }
  const swatchAnim = effect ? 'animate-pulse' : '';

  // Linha de status do LED
  let ledStatus;
  if (!online) {
    ledStatus = '<span class="muted">—</span>';
  } else if (effect) {
    ledStatus = `<span class="inline-flex items-center gap-1.5 font-medium text-indigo-600 dark:text-indigo-300">
      ${icon('sparkles', 'h-3.5 w-3.5')} ${EFFECT_LABELS[effect] || effect}</span>`;
  } else if (isOff) {
    ledStatus = '<span class="muted">Apagado</span>';
  } else if (color) {
    const hex = [color.r, color.g, color.b].map((n) => n.toString(16).padStart(2, '0')).join('').toUpperCase();
    ledStatus = `<span class="font-mono text-zinc-600 dark:text-zinc-300">#${hex}${color.w ? ` · W${color.w}` : ''}</span>`;
  } else {
    ledStatus = '<span class="muted">—</span>';
  }

  return `
    <div class="card flex flex-col gap-4 p-4" data-card="${escapeHtml(c.espMac)}">
      <div class="flex items-start gap-3">
        <span class="mt-1 h-9 w-9 shrink-0 rounded-xl border border-black/10 dark:border-white/10 ${swatchAnim}" style="${swatchStyle}"></span>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <h3 class="truncate font-semibold">${escapeHtml(c.nickname)}</h3>
          </div>
          <p class="truncate text-xs muted">${c.ledType === 'sk6812' ? 'SK6812 · RGBW' : 'WS2812B · RGB'} · ${c.ledCount} LEDs</p>
        </div>
        <span class="chip shrink-0 ${online
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
          : 'border-zinc-300 bg-zinc-100 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400'}">
          <span class="h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-zinc-400'}"></span>
          ${online ? 'Online' : 'Offline'}
        </span>
      </div>
      <div class="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-xs dark:bg-zinc-800/50">
        <span class="muted">LED</span>
        ${ledStatus}
      </div>
      <div class="flex gap-2">
        <button data-act="control" class="btn-primary flex-1">${icon('led', 'h-4 w-4')} Controlar</button>
        <button data-act="power" class="btn-ghost" title="${isOff ? 'Já está apagado' : 'Apagar'}" ${!online ? 'disabled' : ''}>
          ${icon('power', 'h-4 w-4')}
        </button>
      </div>
    </div>`;
}

export async function mount(view) {
  view.innerHTML = `
    <div class="flex flex-col gap-6">
      <div data-stats class="grid grid-cols-3 gap-3"></div>
      <div data-grid></div>
    </div>`;

  const statsEl = view.querySelector('[data-stats]');
  const gridEl = view.querySelector('[data-grid]');

  function stat(label, value, accent) {
    return `<div class="card p-4">
      <div class="text-2xl font-bold ${accent || ''}">${value}</div>
      <div class="text-xs muted">${label}</div>
    </div>`;
  }

  function render() {
    const clients = store.clients;
    const online = clients.filter((c) => store.isConnected(c.espMac)).length;
    statsEl.innerHTML =
      stat('Dispositivos', clients.length) +
      stat('Online', online, 'text-emerald-500') +
      stat('Selecionados', store.selection.size, 'text-indigo-500');

    if (!clients.length) {
      gridEl.innerHTML = `
        <div class="card flex flex-col items-center gap-3 p-10 text-center">
          <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-500/10 text-indigo-500">${icon('devices', 'h-6 w-6')}</span>
          <div>
            <p class="font-medium">Nenhum dispositivo ainda</p>
            <p class="text-sm muted">Conecte um ESP32 e registre-o para começar.</p>
          </div>
          <a href="/devices" data-link class="btn-primary mt-1">${icon('plus', 'h-4 w-4')} Adicionar dispositivo</a>
        </div>`;
      return;
    }

    gridEl.innerHTML = `<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${clients.map(deviceCard).join('')}</div>`;
    gridEl.querySelectorAll('[data-card]').forEach((card) => {
      const mac = card.dataset.card;
      card.querySelector('[data-act="control"]').onclick = () => { store.setSelection([mac]); router.go('/led'); };
      const powerBtn = card.querySelector('[data-act="power"]');
      if (powerBtn) powerBtn.onclick = () => powerOff([mac]);
    });
  }

  async function powerOff(macs) {
    const targets = macs.filter((m) => store.isConnected(m));
    if (!targets.length) { toast('info', 'Nenhum dispositivo online para desligar'); return; }
    const names = targets.map((m) => store.clientByMac(m)?.nickname || m);
    const ok = await confirmModal({
      title: 'Desligar dispositivos?',
      message: `Os LEDs serão apagados em: ${names.join(', ')}.`,
      confirmText: 'Desligar', danger: true
    });
    if (!ok) return;
    try {
      const res = await api.sendLed({ espMacs: targets, r: 0, g: 0, b: 0, w: 0 });
      const byMac = Object.fromEntries(store.clients.map((c) => [c.espMac, c]));
      showResult(res, { actionLabel: 'Desligado', clientsByMac: byMac });
    } catch (e) { toast('error', e.message); }
  }

  await store.refreshClients().catch((e) => toast('error', e.message));
  render();

  const offs = [
    store.on('clients', render),
    store.on('status', render),
    store.on('state', render),
    store.on('effect', render),
    store.on('selection', render)
  ];
  return () => offs.forEach((off) => off());
}
