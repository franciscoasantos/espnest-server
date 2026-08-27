// Cenas: o que era a coluna lateral de 360 px virou painel inteiro, com espaço
// para as miniaturas respirarem.
//
// Uma cena guarda um estado por dispositivo — um pode estar em gradiente e
// outro em efeito —, então quem aplica e captura é o servidor.

import { store } from '../../store.js';
import { api } from '../../api.js';
import { icon, toast, confirmModal, openModal, node } from '../../ui.js';
import { sceneCard } from '../../components/sceneCard.js';
import { showResult } from '../../components/resultToast.js';

// Modal simples de nome, usado por salvar e renomear.
function promptName(title, initial = '') {
  return new Promise((resolve) => {
    const content = node(`
      <div>
        <h3 class="text-lg font-semibold">${title}</h3>
        <div class="mt-4">
          <input data-name class="field" placeholder="Nome da cena" maxlength="40" />
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button data-cancel class="btn-ghost">Cancelar</button>
          <button data-ok class="btn-primary">Salvar</button>
        </div>
      </div>`);

    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const { close } = openModal(content, { onClose: () => finish(null) });

    const input = content.querySelector('[data-name]');
    input.value = initial;
    setTimeout(() => input.focus(), 50);

    const submit = () => {
      const value = input.value.trim();
      if (!value) { input.focus(); return; }
      finish(value);
      close();
    };

    content.querySelector('[data-cancel]').onclick = () => { finish(null); close(); };
    content.querySelector('[data-ok]').onclick = submit;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });
}

export function mount(el) {
  el.innerHTML = `
    <section class="card p-4 sm:p-5">
      <div class="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold">Cenas</h2>
          <p class="text-xs muted">Guardam o estado de cada fita, do jeito que estava.</p>
        </div>
        <button data-save class="btn-ghost shrink-0 px-3 py-2 text-xs">${icon('plus', 'h-4 w-4')} Salvar atual</button>
      </div>
      <div data-scenes class="grid gap-2 sm:grid-cols-2"></div>
    </section>`;

  const scenesEl = el.querySelector('[data-scenes]');

  async function loadScenes() {
    let scenes = [];
    try { scenes = await api.getScenes(); } catch (e) { toast('error', e.message); }

    const byMac = store.clientsByMac();
    scenesEl.innerHTML = '';

    if (!scenes.length) {
      scenesEl.innerHTML = `
        <p class="col-span-full py-8 text-center text-sm muted">
          Nenhuma cena salva ainda.<br/>Ajuste a luz e toque em “Salvar atual”.
        </p>`;
      return;
    }

    scenes.forEach((scene, index) => {
      scenesEl.appendChild(sceneCard(scene, {
        clientsByMac: byMac,
        canMoveUp: index > 0,
        canMoveDown: index < scenes.length - 1,

        onApply: async (item) => {
          try {
            const res = await api.applyScene(item.id);
            showResult(res, { actionLabel: `Cena "${item.name}"`, clientsByMac: byMac });
            // Reidrata para os outros painéis refletirem o que a cena aplicou.
            await store.refreshClients().catch(() => {});
          } catch (e) { toast('error', e.message); }
        },

        onRename: async (item) => {
          const name = await promptName('Renomear cena', item.name);
          if (!name) return;
          try { await api.renameScene(item.id, name); loadScenes(); }
          catch (e) { toast('error', e.message); }
        },

        onMove: async (item, delta) => {
          const ids = scenes.map((x) => x.id);
          const from = ids.indexOf(item.id);
          const to = from + delta;
          if (to < 0 || to >= ids.length) return;
          ids.splice(to, 0, ids.splice(from, 1)[0]);
          try { await api.reorderScenes(ids); loadScenes(); }
          catch (e) { toast('error', e.message); }
        },

        onDelete: async (item) => {
          const ok = await confirmModal({
            title: 'Excluir cena?',
            message: `"${item.name}" será removida.`,
            confirmText: 'Excluir',
            danger: true
          });
          if (!ok) return;
          try { await api.deleteScene(item.id); toast('success', 'Cena excluída'); loadScenes(); }
          catch (e) { toast('error', e.message); }
        }
      }));
    });
  }

  // "Salvar atual" fotografa o que os ESPs estão mostrando de verdade — efeito,
  // gradiente ou cor, cada um no seu modo. Quem sabe o estado é o servidor.
  el.querySelector('[data-save]').onclick = async () => {
    const macs = store.selectedMacs();
    if (!macs.length) { toast('info', 'Selecione um dispositivo no indicador do topo'); return; }

    const name = await promptName('Salvar cena');
    if (!name) return;

    try {
      await api.captureScene({ name, espMacs: macs });
      toast('success', 'Cena salva');
      loadScenes();
    } catch (e) { toast('error', e.message); }
  };

  loadScenes();

  const offs = [store.on('clients', loadScenes)];
  return () => offs.forEach((off) => off());
}
