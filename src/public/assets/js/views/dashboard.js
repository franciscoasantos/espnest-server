// Início: como a casa está agora, e as ações de um toque.
//
// Deixou de ser uma cópia mais pobre da lista de /devices. O cartão abre com o
// palco — a fita desenhada do jeito que ela está — e o resto da tela é atalho:
// aplicar uma cena, acordar um PC.
//
// Atualização por remendo, não por re-render: o SSE `state` chega a cada frame
// enquanto alguém arrasta a cor, e refazer innerHTML nessa cadência mata o
// scroll e reanexa todos os handlers. Só `clients`/`status` remontam a árvore.

import { store } from '../store.js';
import { api } from '../api.js';
import { router } from '../router.js';
import { icon, escapeHtml, toast, confirmModal } from '../ui.js';
import { showResult } from '../components/resultToast.js';
import { effectLabel } from '../lib/effects.js';
import { rgbToHex, isOff } from '../lib/color.js';
import { stageHtml, patchStage, describeStrip, ledVar } from '../components/stripStage.js';
import { previewStyle } from '../components/sceneCard.js';

function statusHtml(client) {
  const mac = client.espMac;
  if (!store.isConnected(mac)) return '<span class="muted">Offline</span>';

  const effect = store.effectOf(mac);
  if (effect) {
    return `<span class="inline-flex items-center gap-1.5 font-medium" style="color:rgb(var(--led))">
      ${icon('sparkles', 'h-3.5 w-3.5')} ${escapeHtml(effectLabel(effect))}</span>`;
  }

  const pattern = client.lastPattern;
  if (pattern && pattern.type === 'gradient') return '<span class="muted">Gradiente</span>';
  if (pattern && pattern.type === 'segments') return '<span class="muted">Segmentos</span>';

  const color = store.colorOf(mac);
  if (isOff(color)) return '<span class="muted">Apagado</span>';
  return `<span class="tabular font-mono text-zinc-600 dark:text-zinc-300">${rgbToHex(color)}</span>`;
}

function deviceCard(client) {
  const mac = client.espMac;
  const online = store.isConnected(mac);
  const strip = describeStrip(client);

  return `
    <article class="card led-halo p-3" data-card="${escapeHtml(mac)}" style="${ledVar(strip.color)}">
      ${stageHtml(client, { size: 'lg', showLabel: false })}
      <div class="mt-3 flex items-center gap-3">
        <div class="min-w-0 flex-1">
          <h3 class="truncate font-semibold leading-tight">${escapeHtml(client.nickname)}</h3>
          <p class="mt-0.5 truncate text-xs" data-status>${statusHtml(client)}</p>
        </div>
        <span class="h-2.5 w-2.5 shrink-0 rounded-full ${online ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-600'}"
              data-dot title="${online ? 'Online' : 'Offline'}"></span>
      </div>
      <div class="mt-3 flex gap-2">
        <button data-act="control" class="${online ? 'btn-led' : 'btn-ghost'} flex-1">
          ${icon('led', 'h-4 w-4')} Controlar
        </button>
        <button data-act="power" class="icon-btn border border-zinc-300 dark:border-zinc-700"
                aria-label="${strip.lit ? 'Apagar' : 'Acender'} ${escapeHtml(client.nickname)}"
                title="${strip.lit ? 'Apagar' : 'Acender'}" ${online ? '' : 'disabled'}>
          ${icon('power', 'h-4 w-4')}
        </button>
      </div>
    </article>`;
}

export async function mount(view) {
  view.innerHTML = `
    <div class="flex flex-col gap-6">
      <section data-devices></section>
      <section data-scenes></section>
      <section data-wake></section>
    </div>`;

  const devicesEl = view.querySelector('[data-devices]');
  const scenesEl = view.querySelector('[data-scenes]');
  const wakeEl = view.querySelector('[data-wake]');

  let scenes = [];
  let targets = [];

  /* ------------------------------ dispositivos ----------------------------- */

  function summaryText(lit, online) {
    if (!online) return 'tudo offline';
    if (!lit) return `${online} online · tudo apagado`;
    return `${lit} de ${online} ${lit === 1 ? 'acesa' : 'acesas'}`;
  }

  function renderDevices() {
    const clients = store.clients;

    if (!clients.length) {
      devicesEl.innerHTML = `
        <div class="card flex flex-col items-center gap-3 p-10 text-center">
          <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800">${icon('devices', 'h-6 w-6')}</span>
          <div>
            <p class="font-medium">Nenhum dispositivo ainda</p>
            <p class="text-sm muted">Conecte um ESP32 e cadastre-o para começar.</p>
          </div>
          <a href="/devices" data-link class="btn-primary mt-1">${icon('plus', 'h-4 w-4')} Cadastrar dispositivo</a>
        </div>`;
      return;
    }

    const online = clients.filter((c) => store.isConnected(c.espMac));
    const lit = online.filter((c) => describeStrip(c).lit).length;

    devicesEl.innerHTML = `
      <div class="mb-3 flex items-center gap-3">
        <h2 class="text-sm font-semibold">Dispositivos</h2>
        <span class="text-xs muted" data-summary>${summaryText(lit, online.length)}</span>
        ${online.length ? '<button data-act="all-off" class="btn-subtle ml-auto px-2.5 py-1 text-xs">Apagar tudo</button>' : ''}
      </div>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">${clients.map(deviceCard).join('')}</div>`;

    devicesEl.querySelectorAll('[data-card]').forEach((card) => {
      const mac = card.dataset.card;
      card.querySelector('[data-act="control"]').onclick = () => {
        store.setSelection([mac]);
        router.go('/led');
      };
      const power = card.querySelector('[data-act="power"]');
      if (power) power.onclick = () => togglePower(mac, power);
    });

    const allOff = devicesEl.querySelector('[data-act="all-off"]');
    if (allOff) allOff.onclick = () => powerOff(online.map((c) => c.espMac));
  }

  // Remendo: só o palco, a linha de status e a cor herdada mudam.
  function patchDevices() {
    let lit = 0;
    let online = 0;

    store.clients.forEach((client) => {
      const mac = client.espMac;
      const isOnline = store.isConnected(mac);
      if (isOnline) online += 1;

      const strip = describeStrip(client);
      if (strip.lit) lit += 1;

      // MAC tem ':', que precisa de escape para virar seletor.
      const card = devicesEl.querySelector(`[data-card="${CSS.escape(mac)}"]`);
      if (!card) return;

      if (strip.color) card.style.setProperty('--led', `${strip.color.r | 0} ${strip.color.g | 0} ${strip.color.b | 0}`);
      else card.style.removeProperty('--led');

      patchStage(card.querySelector('[data-stage]'), client, 'lg');
      card.querySelector('[data-status]').innerHTML = statusHtml(client);
      card.querySelector('[data-act="control"]').className = `${isOnline ? 'btn-led' : 'btn-ghost'} flex-1`;

      const power = card.querySelector('[data-act="power"]');
      if (power) {
        const verb = strip.lit ? 'Apagar' : 'Acender';
        power.setAttribute('aria-label', `${verb} ${client.nickname}`);
        power.title = verb;
        power.disabled = !isOnline;
      }
    });

    const summary = devicesEl.querySelector('[data-summary]');
    if (summary) summary.textContent = summaryText(lit, online);
  }

  // Sem confirmação: apagar uma fita é reversível no mesmo botão, então pedir
  // confirmação custava mais que o erro. Apagar TODAS continua confirmando.
  async function togglePower(mac, button) {
    if (!store.isConnected(mac)) return;
    button.disabled = true;
    try {
      const res = await api.toggleLed({ espMacs: [mac] });
      const failed = (res.results || []).find((item) => !item.ok);
      if (failed) toast('error', failed.error || 'Não foi possível alternar a fita');
    } catch (e) {
      toast('error', e.message);
    } finally {
      button.disabled = false;
    }
  }

  async function powerOff(macs) {
    const online = macs.filter((m) => store.isConnected(m));
    if (!online.length) { toast('info', 'Nenhum dispositivo online para apagar'); return; }

    const names = online.map((m) => store.clientByMac(m)?.nickname || m);
    const ok = await confirmModal({
      title: online.length === 1 ? 'Apagar a fita?' : 'Apagar todas as fitas?',
      message: `A luz será apagada em: ${names.join(', ')}.`,
      confirmText: 'Apagar',
      danger: true
    });
    if (!ok) return;

    try {
      const res = await api.sendLed({ espMacs: online, r: 0, g: 0, b: 0, w: 0 });
      showResult(res, { actionLabel: 'Apagado', clientsByMac: store.clientsByMac() });
    } catch (e) {
      toast('error', e.message);
    }
  }

  /* --------------------------------- cenas --------------------------------- */

  function renderScenes() {
    if (!scenes.length) { scenesEl.innerHTML = ''; return; }

    scenesEl.innerHTML = `
      <div class="mb-3 flex items-center gap-3">
        <h2 class="text-sm font-semibold">Cenas</h2>
        <a href="/led/cenas" data-link class="ml-auto text-xs font-medium muted hover:underline">Ver todas</a>
      </div>
      <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        ${scenes.map((s) => `
          <button data-scene="${escapeHtml(s.id)}"
                  class="chip shrink-0 border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200">
            <span class="h-4 w-4 shrink-0 rounded-full border border-black/10 dark:border-white/15" style="${previewStyle(s)}"></span>
            <span class="max-w-[10rem] truncate">${escapeHtml(s.name)}</span>
          </button>`).join('')}
      </div>`;

    scenesEl.querySelectorAll('[data-scene]').forEach((btn) => {
      btn.onclick = async () => {
        btn.disabled = true;
        try {
          const res = await api.applyScene(btn.dataset.scene);
          const name = scenes.find((s) => s.id === btn.dataset.scene)?.name || 'Cena';
          showResult(res, { actionLabel: `Cena "${name}"`, clientsByMac: store.clientsByMac() });
        } catch (e) {
          toast('error', e.message);
        } finally {
          btn.disabled = false;
        }
      };
    });
  }

  /* -------------------------------- acordar -------------------------------- */

  function renderWake() {
    if (!targets.length) { wakeEl.innerHTML = ''; return; }

    wakeEl.innerHTML = `
      <div class="mb-3 flex items-center gap-3">
        <h2 class="text-sm font-semibold">Acordar</h2>
        <a href="/wol" data-link class="ml-auto text-xs font-medium muted hover:underline">Ver todos</a>
      </div>
      <div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        ${targets.map((t) => `
          <button data-wake="${escapeHtml(t.mac)}"
                  class="chip shrink-0 border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200">
            ${icon('wol', 'h-4 w-4')}
            <span class="max-w-[10rem] truncate">${escapeHtml(t.nickname)}</span>
          </button>`).join('')}
      </div>`;

    wakeEl.querySelectorAll('[data-wake]').forEach((btn) => {
      btn.onclick = async () => {
        const espMacs = store.selectedMacs().filter((m) => store.isConnected(m));
        if (!espMacs.length) {
          toast('info', 'Nenhum ESP32 online para enviar o pacote', {
            detail: 'O pacote sai de um ESP32; selecione um na tela Wake-on-LAN.'
          });
          return;
        }
        btn.disabled = true;
        try {
          const res = await api.sendWol({ espMacs, targetMac: btn.dataset.wake });
          showResult(res, { actionLabel: 'Pacote WoL enviado', clientsByMac: store.clientsByMac() });
        } catch (e) {
          toast('error', e.message);
        } finally {
          btn.disabled = false;
        }
      };
    });
  }

  /* ------------------------------- bootstrap ------------------------------- */

  await store.refreshClients().catch((e) => toast('error', e.message));
  renderDevices();

  // Cenas e alvos são atalhos: se falharem, a tela principal continua de pé.
  const [loadedScenes, loadedTargets] = await Promise.all([
    api.getScenes().catch(() => []),
    api.getWolTargets().catch(() => [])
  ]);
  scenes = loadedScenes;
  targets = loadedTargets;
  renderScenes();
  renderWake();

  const offs = [
    store.on('clients', renderDevices),
    store.on('status', renderDevices),
    store.on('state', patchDevices),
    store.on('effect', patchDevices)
  ];
  return () => offs.forEach((off) => off());
}
