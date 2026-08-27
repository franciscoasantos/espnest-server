// Wake-on-LAN: lista pesquisável de alvos, disparo via ESPs selecionados.
//
// Passou a ser o único lugar dos alvos: criar, editar e acordar. Renomear
// morava em /devices → aba "Alvos WoL", a duas telas de distância do botão
// Acordar, com a mesma linha e o mesmo modal escritos duas vezes.

import { store } from '../store.js';
import { api } from '../api.js';
import { icon, escapeHtml, toast } from '../ui.js';
import { showResult } from '../components/resultToast.js';
import { wolTargetRow, openWolTargetForm } from '../components/wolTarget.js';

// A mesma cor que o firmware usa na barra de progresso do ritual
// (PROGRESS_COLOR em services/wakeRitual.js): a tela e a fita contam a mesma
// história.
const PROBE_COLOR = 'rgb(0,120,255)';

export async function mount(view) {
  view.innerHTML = `
    <div class="flex flex-col gap-5">
      <div data-guard></div>

      <div class="flex items-center gap-2">
        <div class="relative flex-1">
          <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-zinc-400">${icon('search', 'h-4 w-4')}</span>
          <input data-search class="field pl-9" placeholder="Buscar alvo por nome ou MAC…" />
        </div>
        <button data-new class="btn-ghost shrink-0">${icon('plus', 'h-4 w-4')} <span class="hidden sm:inline">Novo alvo</span></button>
      </div>

      <div data-list class="grid gap-2 sm:grid-cols-2"></div>
    </div>`;

  const guard = view.querySelector('[data-guard]');
  const search = view.querySelector('[data-search]');
  const listEl = view.querySelector('[data-list]');

  let targets = [];
  // mac -> timer da sondagem em curso, para limpar no cleanup.
  const probing = new Map();

  function selectedOnline() {
    return store.selectedMacs().filter((m) => store.isConnected(m));
  }

  function banner(tone, text, href, link) {
    const tones = {
      amber: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
      emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    };
    return `<div class="flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm ${tones[tone]}">
      ${text} ${href ? `<a href="${href}" data-link class="font-medium underline">${link}</a>` : ''}</div>`;
  }

  function refreshGuard() {
    const onlineSel = selectedOnline().length;
    if (!store.clients.length) {
      guard.innerHTML = banner('amber', 'Cadastre um ESP32 para enviar pacotes WoL.', '/devices', 'Cadastrar');
    } else if (!store.selection.size) {
      guard.innerHTML = banner('amber', 'Toque no indicador do topo para escolher por qual ESP32 enviar o pacote.');
    } else if (!onlineSel) {
      guard.innerHTML = banner('amber', 'Nenhum ESP32 selecionado está online no momento.');
    } else {
      guard.innerHTML = banner('emerald', `Enviando via ${onlineSel} ${onlineSel === 1 ? 'dispositivo' : 'dispositivos'} online.`);
    }
  }

  function render() {
    const q = search.value.trim().toLowerCase();

    if (!targets.length) {
      listEl.innerHTML = `
        <div class="card col-span-full flex flex-col items-center gap-3 p-10 text-center">
          <span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800">${icon('wol', 'h-6 w-6')}</span>
          <p class="font-medium">Nenhum alvo cadastrado</p>
          <p class="text-sm muted">Adicione o MAC do computador que deseja acordar.</p>
          <button data-new2 class="btn-primary mt-1">${icon('plus', 'h-4 w-4')} Novo alvo</button>
        </div>`;
      listEl.querySelector('[data-new2]').onclick = () => editTarget(null);
      return;
    }

    const filtered = targets.filter((t) =>
      t.nickname.toLowerCase().includes(q) || t.mac.toLowerCase().includes(q));

    if (!filtered.length) {
      listEl.innerHTML = `<p class="col-span-full py-8 text-center text-sm muted">Nenhum alvo encontrado para “${escapeHtml(search.value)}”.</p>`;
      return;
    }

    listEl.innerHTML = '';
    filtered.forEach((target) => {
      const row = wolTargetRow(target, { onWake: wake, onEdit: editTarget });
      row.dataset.target = target.mac;
      listEl.appendChild(row);
    });
  }

  /* -------------------------------- acordar -------------------------------- */

  // Com IP/hostname o servidor sonda o alvo e a fita vira barra de progresso;
  // sem ele só resta o pacote mágico.
  async function wake(target) {
    const espMacs = selectedOnline();
    if (!espMacs.length) { toast('info', 'Selecione ao menos um ESP32 online'); return; }

    if (!target.host) {
      try {
        const res = await api.sendWol({ espMacs, targetMac: target.mac });
        showResult(res, { actionLabel: 'Pacote WoL enviado', clientsByMac: store.clientsByMac() });
      } catch (e) { toast('error', e.message); }
      return;
    }

    try {
      const res = await api.wakeRitual({ espMacs, targetMac: target.mac, host: target.host });
      showResult(res.wol, { actionLabel: 'Pacote WoL enviado', clientsByMac: store.clientsByMac() });
      if (res.probing) showProbing(target, res.timeoutMs || 90000);
    } catch (e) {
      toast('error', e.message);
    }
  }

  // A sondagem roda em background no servidor e não emite SSE, então a tela não
  // tem como saber o desfecho: mostra o que está acontecendo e diz onde ler o
  // resultado — na própria fita.
  function showProbing(target, timeoutMs) {
    const row = listEl.querySelector(`[data-target="${CSS.escape(target.mac)}"]`);
    if (!row) return;

    clearInterval(probing.get(target.mac));
    row.querySelector('[data-probe]')?.remove();

    const note = document.createElement('p');
    note.dataset.probe = '';
    note.className = 'basis-full text-xs';
    note.style.color = PROBE_COLOR;
    row.appendChild(note);
    row.classList.add('flex-wrap');

    let left = Math.round(timeoutMs / 1000);
    const paint = () => {
      note.textContent = `Sondando ${target.host}… até ${left}s. A fita fica azul enquanto procura e pisca verde quando ele responder.`;
    };
    paint();

    const timer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(timer);
        probing.delete(target.mac);
        note.remove();
        return;
      }
      paint();
    }, 1000);
    probing.set(target.mac, timer);
  }

  /* --------------------------------- alvos --------------------------------- */

  async function editTarget(existing) {
    const payload = await openWolTargetForm(existing);
    if (!payload) return;
    try {
      await api.upsertWolTarget(payload);
      toast('success', existing ? 'Alvo salvo' : 'Alvo criado');
      targets = await api.getWolTargets();
      render();
    } catch (e) { toast('error', e.message); }
  }

  view.querySelector('[data-new]').onclick = () => editTarget(null);
  search.addEventListener('input', render);

  await store.refreshClients().catch(() => {});
  try { targets = await api.getWolTargets(); } catch (e) { toast('error', e.message); }
  refreshGuard();
  render();

  const offs = [
    store.on('selection', refreshGuard),
    store.on('status', refreshGuard),
    store.on('clients', refreshGuard)
  ];

  return () => {
    offs.forEach((off) => off());
    probing.forEach((timer) => clearInterval(timer));
    probing.clear();
  };
}
