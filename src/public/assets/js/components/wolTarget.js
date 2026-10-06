// Alvo de Wake-on-LAN: a linha da lista e o formulário.
//
// Antes isto existia duas vezes, quase byte a byte: a linha em views/wol.js e
// em views/devices.js, e o modal como openNewTarget/openWolForm. O resultado
// para quem usa era um recurso de cérebro dividido — criava e acordava numa
// tela, renomeava em outra. Agora tudo mora em /wol.

import { escapeHtml, icon, openModal, node } from '../ui.js';

export function wolTargetRow(target, { onWake, onEdit }) {
  const el = document.createElement('div');
  el.className = 'card flex items-center gap-3 p-3';
  el.innerHTML = `
    <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-500 dark:bg-zinc-800">
      ${icon('wol', 'h-5 w-5')}
    </span>
    <div class="min-w-0 flex-1">
      <p class="truncate font-medium leading-tight">${escapeHtml(target.nickname)}</p>
      <p class="truncate font-mono text-xs muted">${escapeHtml(target.mac)}</p>
      ${target.host ? `<p class="truncate font-mono text-xs muted">${escapeHtml(target.host)}</p>` : ''}
    </div>
    <button data-act="edit" class="icon-btn" aria-label="Editar ${escapeHtml(target.nickname)}">
      ${icon('pencil', 'h-4 w-4')}
    </button>
    <button data-act="wake" class="btn-led shrink-0">${icon('power', 'h-4 w-4')} Acordar</button>`;

  el.querySelector('[data-act="wake"]').addEventListener('click', () => onWake(target));
  el.querySelector('[data-act="edit"]').addEventListener('click', () => onEdit(target));
  return el;
}

// Cria e edita. O MAC vira somente-leitura ao editar porque é a chave do alvo
// no servidor — trocá-lo criaria outro registro em vez de renomear este.
export function openWolTargetForm(existing) {
  const editing = !!existing;

  return new Promise((resolve) => {
    const content = node(`
      <div>
        <h3 class="text-lg font-semibold">${editing ? 'Editar alvo' : 'Novo alvo WoL'}</h3>
        <p class="mt-1 text-sm muted">O computador que você quer acordar.</p>
        <div class="mt-4 flex flex-col gap-3">
          <div>
            <span class="label">Nome</span>
            <input data-nick class="field" placeholder="PC da sala" maxlength="40" />
          </div>
          <div>
            <span class="label">MAC</span>
            <input data-mac class="field font-mono" placeholder="AA:BB:CC:DD:EE:FF" ${editing ? 'readonly' : ''} />
          </div>
          <div>
            <span class="label">IP ou hostname (opcional)</span>
            <input data-host class="field font-mono" placeholder="192.168.0.20" />
            <p class="mt-1 text-xs muted">
              Com este campo a fita vira barra de progresso enquanto o servidor
              sonda o alvo, e fica verde quando ele responde.
            </p>
          </div>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button data-cancel class="btn-ghost">Cancelar</button>
          <button data-ok class="btn-primary">Salvar</button>
        </div>
      </div>`);

    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const { close } = openModal(content, { onClose: () => finish(null) });

    const nick = content.querySelector('[data-nick]');
    const mac = content.querySelector('[data-mac]');
    const host = content.querySelector('[data-host]');

    if (existing) {
      nick.value = existing.nickname || '';
      mac.value = existing.mac || '';
      host.value = existing.host || '';
    }

    setTimeout(() => (editing ? nick : mac).focus(), 50);

    content.querySelector('[data-cancel]').onclick = () => { finish(null); close(); };
    content.querySelector('[data-ok]').onclick = () => {
      const nickname = nick.value.trim();
      const macValue = mac.value.trim();
      if (!nickname) { nick.focus(); return; }
      if (!macValue) { mac.focus(); return; }
      // host sempre vai no payload (mesmo vazio) para dar como limpar o campo.
      finish({ nickname, mac: macValue, host: host.value.trim() });
      close();
    };
  });
}
