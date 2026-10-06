// Dispositivos: gestão dos ESP32 — firmware/OTA, descoberta e cadastro.
//
// Assunto único: os alvos WoL saíram daqui e passaram a morar em /wol, junto do
// botão Acordar. A aba que existia aqui só oferecia renomear, o que deixava o
// recurso de cérebro dividido entre duas telas.
//
// Observação: o backend só expõe GET/POST para clients (sem DELETE), portanto a
// UI oferece cadastrar/editar — não excluir.

import { store } from '../store.js';
import { api } from '../api.js';
import { icon, escapeHtml, toast, openModal, node, confirmModal } from '../ui.js';

export async function mount(view) {
  view.innerHTML = `
    <div class="flex flex-col gap-6">
      <div data-panel></div>
    </div>`;

  const panel = view.querySelector('[data-panel]');

  /* ---------------------------- firmware ---------------------------- */
  let firmware = null;

  function formatSize(bytes) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }

  // Desatualizado só quando dá para afirmar: sem manifesto ou sem versão
  // reportada pelo ESP (firmware antigo, anterior ao OTA), não há comparação.
  function isOutdated(client) {
    if (!firmware || !firmware.published || !client.firmwareVersion) return false;
    return client.firmwareVersion !== firmware.version;
  }

  function paintOta(mac) {
    // Busca por dataset em vez de seletor de atributo: MAC tem ':', que exigiria
    // escaping em CSS.
    const slot = Array.from(panel.querySelectorAll('[data-ota-slot]'))
      .find((el) => el.dataset.otaSlot === mac);
    if (!slot) return;

    const ota = store.otaOf(mac);
    if (!ota) { slot.innerHTML = ''; return; }

    if (ota.phase === 'error') {
      slot.innerHTML = `<p class="text-xs text-red-500">Falha no update: ${escapeHtml(ota.error || 'desconhecida')}</p>`;
      return;
    }

    // O ESP some da rede por ~30 s enquanto reinicia; dizer isso evita que a
    // queda pareça um erro.
    const label = ota.phase === 'rebooting' ? 'Reiniciando…' : `Baixando… ${ota.pct ?? 0}%`;
    const pct = ota.phase === 'rebooting' ? 100 : (ota.pct ?? 0);
    slot.innerHTML = `
      <p class="mb-1 text-xs muted">${label}</p>
      <div class="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div class="h-full rounded-full bg-indigo-600 transition-all" style="width:${pct}%"></div>
      </div>`;
  }

  function firmwareSection() {
    const published = firmware && firmware.published;
    return `
      <section>
        <h2 class="mb-1 flex items-center gap-2 text-sm font-semibold">${icon('signal', 'h-4 w-4')} Firmware</h2>
        <p class="mb-3 text-xs muted">Envie o <code>.bin</code> compilado; os ESP32 atualizam pela rede, sem cabo.</p>
        <div class="card flex flex-col gap-3 p-4">
          ${published ? `
            <div class="min-w-0">
              <p class="truncate font-mono text-sm">${escapeHtml(firmware.version)}</p>
              <p class="truncate text-xs muted">${escapeHtml(firmware.projectName || '')} · IDF ${escapeHtml(firmware.idfVer || '')} · ${formatSize(firmware.size)} · enviado ${new Date(firmware.uploadedAt).toLocaleString('pt-BR')}</p>
            </div>` : `<p class="text-sm muted">Nenhum firmware publicado ainda.</p>`}
          <div class="flex items-center gap-3">
            <input data-fw-file type="file" accept=".bin,application/octet-stream" class="hidden" />
            <button data-fw-pick class="btn-ghost">${icon('plus', 'h-4 w-4')} Enviar .bin</button>
            <span data-fw-status class="text-xs muted"></span>
          </div>
        </div>
      </section>`;
  }

  function wireFirmwareUpload() {
    const pick = panel.querySelector('[data-fw-pick]');
    const input = panel.querySelector('[data-fw-file]');
    const status = panel.querySelector('[data-fw-status]');
    if (!pick || !input) return;

    pick.onclick = () => input.click();
    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;

      pick.disabled = true;
      status.textContent = 'Enviando… 0%';
      try {
        firmware = await api.uploadFirmware(file, (pct) => { status.textContent = `Enviando… ${pct}%`; });
        toast('success', `Firmware ${firmware.version} publicado`);
        renderEsp();
      } catch (e) {
        toast('error', e.message);
        status.textContent = '';
        pick.disabled = false;
      }
    };
  }

  /* ------------------------------- ESP ------------------------------ */
  async function renderEsp() {
    panel.innerHTML = `<p class="py-8 text-center text-sm muted">Carregando…</p>`;
    let discovered = [];
    try { discovered = await api.getDiscovered(); } catch (e) {}
    try { firmware = await api.getFirmware(); } catch (e) { firmware = null; }
    await store.refreshClients().catch(() => {});
    const clients = store.clients;

    panel.innerHTML = `
      <div class="flex flex-col gap-6">
        ${firmwareSection()}
        ${discovered.length ? `
          <section>
            <h2 class="mb-1 flex items-center gap-2 text-sm font-semibold">${icon('signal', 'h-4 w-4')} Descobertos na rede</h2>
            <p class="mb-3 text-xs muted">ESP32 conectados mas ainda não cadastrados.</p>
            <div class="grid gap-2 sm:grid-cols-2">
              ${discovered.map((d) => `
                <div class="card flex items-center gap-3 p-3">
                  <span class="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-emerald-500"></span>
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-mono text-sm">${escapeHtml(d.espMac)}</p>
                    <p class="truncate text-xs muted">${escapeHtml(d.ip || '')}</p>
                  </div>
                  <button data-register="${escapeHtml(d.espMac)}" class="btn-primary shrink-0">${icon('plus', 'h-4 w-4')} Registrar</button>
                </div>`).join('')}
            </div>
          </section>` : ''}

        <section>
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-sm font-semibold">Cadastrados</h2>
            <button data-add class="btn-ghost">${icon('plus', 'h-4 w-4')} Adicionar manual</button>
          </div>
          <div data-esp-list class="grid gap-3 sm:grid-cols-2"></div>
        </section>
      </div>`;

    const listEl = panel.querySelector('[data-esp-list]');
    if (!clients.length) {
      listEl.innerHTML = `<p class="col-span-full py-8 text-center text-sm muted">Nenhum ESP32 cadastrado ainda.</p>`;
    } else {
      listEl.innerHTML = clients.map((c) => {
        const online = store.isConnected(c.espMac);
        const outdated = isOutdated(c);
        const canUpdate = online && firmware && firmware.published;
        return `
          <div class="card flex flex-col gap-3 p-4">
            <div class="flex items-center gap-3">
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="h-2 w-2 shrink-0 rounded-full ${online ? 'bg-emerald-500' : 'bg-zinc-400'}"></span>
                  <h3 class="truncate font-semibold">${escapeHtml(c.nickname)}</h3>
                  ${outdated ? `<span class="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">desatualizado</span>` : ''}
                </div>
                <p class="truncate font-mono text-xs muted">${escapeHtml(c.espMac)}</p>
                <p class="mt-1 text-xs muted">${c.ledType === 'sk6812' ? 'SK6812 · RGBW' : 'WS2812B · RGB'} · ${c.ledCount} LEDs · pino ${c.ledPin}</p>
                <p class="truncate text-xs muted">firmware ${c.firmwareVersion ? escapeHtml(c.firmwareVersion) : '—'}</p>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                ${canUpdate ? `<button data-ota="${escapeHtml(c.espMac)}" class="${outdated ? 'btn-primary' : 'btn-subtle'}">Atualizar</button>` : ''}
                <button data-edit="${escapeHtml(c.espMac)}" class="btn-subtle">${icon('pencil', 'h-4 w-4')}</button>
              </div>
            </div>
            <div data-ota-slot="${escapeHtml(c.espMac)}"></div>
          </div>`;
      }).join('');
    }

    panel.querySelector('[data-add]').onclick = () => openEspForm(null);
    panel.querySelectorAll('[data-register]').forEach((b) => { b.onclick = () => openEspForm({ espMac: b.dataset.register }); });
    panel.querySelectorAll('[data-edit]').forEach((b) => {
      b.onclick = () => openEspForm(store.clientByMac(b.dataset.edit));
    });
    panel.querySelectorAll('[data-ota]').forEach((b) => {
      b.onclick = () => startOta(b.dataset.ota, b);
    });

    wireFirmwareUpload();
    clients.forEach((c) => paintOta(c.espMac));
  }

  async function startOta(mac, button) {
    const client = store.clientByMac(mac);
    // Um update na fita da sala derruba a iluminação por ~1 min; confirmar
    // evita o clique acidental.
    const ok = await confirmModal({
      title: 'Atualizar firmware?',
      message: `${client ? client.nickname : mac} vai para a versão ${firmware.version}. A fita apaga e o dispositivo reinicia (~1 min).`,
      confirmText: 'Atualizar',
      danger: true
    });
    if (!ok) return;


    button.disabled = true;
    store.setOta(mac, { phase: 'downloading', pct: 0 });
    try {
      await api.startOta(mac);
      toast('info', 'Update iniciado');
    } catch (e) {
      store.setOta(mac, null);
      toast('error', e.message);
      button.disabled = false;
    }
  }

  function openEspForm(existing) {
    const isEdit = existing && existing.nickname;
    const c = existing || {};
    const content = node(`
      <div>
        <h3 class="text-lg font-semibold">${isEdit ? 'Editar ESP32' : 'Cadastrar ESP32'}</h3>
        <div class="mt-4 flex flex-col gap-3">
          <div><label class="label">MAC do ESP</label>
            <input data-mac class="field font-mono" placeholder="7C:87:CE:28:09:68" value="${escapeHtml(c.espMac || '')}" ${isEdit ? 'readonly' : ''} /></div>
          <div><label class="label">Nome</label>
            <input data-nick class="field" placeholder="Sala" maxlength="40" value="${escapeHtml(c.nickname || '')}" /></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="label">Qtd. LEDs</label>
              <input data-count type="number" min="1" max="2048" class="field" value="${c.ledCount || 30}" /></div>
            <div><label class="label">Pino (GPIO)</label>
              <input data-pin type="number" min="0" max="48" class="field" value="${c.ledPin ?? 13}" /></div>
          </div>
          <div><label class="label">Tipo de fita</label>
            <select data-type class="field">
              <option value="ws2812b" ${c.ledType !== 'sk6812' ? 'selected' : ''}>WS2812B (RGB)</option>
              <option value="sk6812" ${c.ledType === 'sk6812' ? 'selected' : ''}>SK6812 (RGBW)</option>
            </select></div>
        </div>
        <div class="mt-5 flex justify-end gap-2">
          <button data-cancel class="btn-ghost">Cancelar</button>
          <button data-ok class="btn-primary">${isEdit ? 'Salvar' : 'Cadastrar'}</button>
        </div>
      </div>`);
    const { close } = openModal(content);
    content.querySelector('[data-cancel]').onclick = close;
    content.querySelector('[data-ok]').onclick = async () => {
      const payload = {
        espMac: content.querySelector('[data-mac]').value.trim(),
        nickname: content.querySelector('[data-nick]').value.trim(),
        ledCount: Number(content.querySelector('[data-count]').value),
        ledPin: Number(content.querySelector('[data-pin]').value),
        ledType: content.querySelector('[data-type]').value
      };
      try {
        await api.upsertClient(payload);
        toast('success', isEdit ? 'ESP32 atualizado' : 'ESP32 cadastrado');
        close();
        renderEsp();
      } catch (e) { toast('error', e.message); }
    };
  }

  const unsubOta = store.on('ota', ({ espMac }) => paintOta(espMac));

  // O ESP some da rede enquanto reinicia com a imagem nova. Voltar a aparecer
  // online é o sinal de que o update acabou — aí a barra sai e a lista recarrega
  // já com a versão nova. Cobre também o caso em que o ota_result se perde no
  // reset antes do frame sair.
  const sawOffline = new Set();
  const unsubStatus = store.on('status', () => {
    let finished = false;
    store.clients.forEach((c) => {
      const ota = store.otaOf(c.espMac);
      if (!ota || ota.phase === 'error') return;

      if (!store.isConnected(c.espMac)) { sawOffline.add(c.espMac); return; }
      if (sawOffline.delete(c.espMac)) {
        store.setOta(c.espMac, null);
        finished = true;
      }
    });

    if (finished) renderEsp();
  });

  renderEsp();
  return () => { unsubOta(); unsubStatus(); };
}
