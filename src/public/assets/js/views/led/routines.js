// Rotinas: horário fixo ou nascer/pôr do sol disparando uma ação nas fitas,
// mais o modo ausente. Ambos são automação da luz, então dividem o painel.
//
// Toda ação do agendador é de LED (services/scheduler.js: color, off, effect,
// gradient, sunrise) — é por isso que Rotinas deixou de ser um item de menu e
// virou uma aba de Luz.
//
// O agendador roda no servidor com tick de 30 s: nada aqui precisa ficar aberto
// para a rotina disparar.

import { store } from '../../store.js';
import { api } from '../../api.js';
import { icon, toast, confirmModal } from '../../ui.js';
import { hexToRgb, rgbToHex, BLACK } from '../../lib/color.js';
import { minutesToLabel, timeToMinutes } from '../../lib/time.js';
import { scheduleCard } from '../../components/scheduleCard.js';
import { openScheduleForm } from '../../components/scheduleForm.js';

export function mount(el) {
  el.innerHTML = `
    <div class="flex flex-col gap-5">
      <section>
        <div class="mb-3 flex items-center gap-3">
          <div>
            <h2 class="text-sm font-semibold">Rotinas</h2>
            <p class="text-xs muted">Rodam no servidor, mesmo com o app fechado.</p>
          </div>
          <button data-new class="btn-ghost ml-auto shrink-0 px-3 py-2 text-xs">${icon('plus', 'h-4 w-4')} Nova rotina</button>
        </div>
        <div data-list class="grid gap-2 sm:grid-cols-2"></div>
      </section>

      <section class="card p-4 sm:p-5">
        <div class="mb-1 flex items-center justify-between gap-3">
          <h2 class="text-sm font-semibold">Modo ausente</h2>
          <label class="flex items-center gap-2 text-xs">
            <input data-away-enabled type="checkbox" class="h-4 w-4 accent-indigo-500" />
            Ativo
          </label>
        </div>
        <p class="mb-4 text-xs muted">Acende e apaga em intervalos sorteados, para a casa não parecer vazia.</p>

        <div class="flex flex-col gap-3">
          <div class="grid grid-cols-2 gap-2">
            <div>
              <span class="label">Das</span>
              <input data-away-start type="time" class="field" />
            </div>
            <div>
              <span class="label">Até</span>
              <input data-away-end type="time" class="field" />
            </div>
          </div>

          <div class="grid gap-2 sm:grid-cols-2">
            <div>
              <span class="label">Aceso (min)</span>
              <div class="flex items-center gap-1">
                <input data-away-min-on type="number" min="1" max="240" class="field" />
                <span class="text-xs muted">a</span>
                <input data-away-max-on type="number" min="1" max="240" class="field" />
              </div>
            </div>
            <div>
              <span class="label">Apagado (min)</span>
              <div class="flex items-center gap-1">
                <input data-away-min-off type="number" min="1" max="240" class="field" />
                <span class="text-xs muted">a</span>
                <input data-away-max-off type="number" min="1" max="240" class="field" />
              </div>
            </div>
          </div>

          <div>
            <span class="label">Cor</span>
            <input data-away-color type="color"
                   class="h-11 w-full cursor-pointer rounded-xl border border-black/10 bg-transparent p-0 dark:border-white/10" />
          </div>

          <p data-away-status class="text-xs muted"></p>
          <p class="text-xs muted">Usa os dispositivos selecionados no indicador do topo ao salvar.</p>
          <button data-away-save class="btn-primary w-full">Salvar modo ausente</button>
        </div>
      </section>
    </div>`;

  const listEl = el.querySelector('[data-list]');

  /* -------------------------------- rotinas -------------------------------- */

  async function load() {
    let schedules = [];
    try { schedules = await api.getSchedules(); } catch (e) { toast('error', e.message); }

    const byMac = store.clientsByMac();
    listEl.innerHTML = '';

    if (!schedules.length) {
      listEl.innerHTML = `
        <p class="col-span-full py-8 text-center text-sm muted">
          Nenhuma rotina ainda.<br/>Toque em “Nova rotina” para criar a primeira.
        </p>`;
      return;
    }

    schedules.forEach((schedule) => {
      listEl.appendChild(scheduleCard(schedule, {
        clientsByMac: byMac,

        onRun: async (item) => {
          try {
            await api.runSchedule(item.id);
            toast('success', `"${item.name}" disparada`);
          } catch (e) { toast('error', e.message); }
        },

        onToggle: async (item) => {
          try {
            await api.upsertSchedule({ ...item, enabled: !item.enabled });
            load();
          } catch (e) { toast('error', e.message); }
        },

        // Editar existe porque upsertSchedule casa por id no servidor; antes
        // a única saída era excluir e recriar.
        onEdit: async (item) => {
          const payload = await openScheduleForm(item, { espMacs: item.espMacs });
          if (!payload) return;
          try {
            await api.upsertSchedule(payload);
            toast('success', 'Rotina salva');
            load();
          } catch (e) { toast('error', e.message); }
        },

        onDelete: async (item) => {
          const ok = await confirmModal({
            title: 'Excluir rotina?',
            message: `"${item.name}" será removida.`,
            confirmText: 'Excluir',
            danger: true
          });
          if (!ok) return;
          try { await api.deleteSchedule(item.id); toast('success', 'Rotina excluída'); load(); }
          catch (e) { toast('error', e.message); }
        }
      }));
    });
  }

  el.querySelector('[data-new]').onclick = async () => {
    const payload = await openScheduleForm(null, { espMacs: store.selectedMacs() });
    if (!payload) return;
    try {
      await api.upsertSchedule(payload);
      toast('success', 'Rotina criada');
      load();
    } catch (e) { toast('error', e.message); }
  };

  /* ----------------------------- modo ausente ------------------------------ */

  const away = {
    enabled: el.querySelector('[data-away-enabled]'),
    start: el.querySelector('[data-away-start]'),
    end: el.querySelector('[data-away-end]'),
    minOn: el.querySelector('[data-away-min-on]'),
    maxOn: el.querySelector('[data-away-max-on]'),
    minOff: el.querySelector('[data-away-min-off]'),
    maxOff: el.querySelector('[data-away-max-off]'),
    color: el.querySelector('[data-away-color]'),
    status: el.querySelector('[data-away-status]'),
    save: el.querySelector('[data-away-save]')
  };

  function renderAway(config) {
    away.enabled.checked = !!config.enabled;
    away.start.value = minutesToLabel(config.startMinutes);
    away.end.value = minutesToLabel(config.endMinutes);
    away.minOn.value = config.minOnMin;
    away.maxOn.value = config.maxOnMin;
    away.minOff.value = config.minOffMin;
    away.maxOff.value = config.maxOffMin;
    away.color.value = rgbToHex(config.color);

    if (!config.enabled) {
      away.status.textContent = 'Desativado.';
      return;
    }

    const byMac = store.clientsByMac();
    const names = (config.espMacs || []).map((mac) => byMac[mac]?.nickname || mac).join(', ');

    if (!config.windowActive) {
      away.status.textContent = `Ativo em ${names || 'nenhum dispositivo'}, mas fora da janela agora.`;
      return;
    }

    const on = (config.devices || []).filter((d) => d.on).length;
    away.status.textContent = `Dentro da janela · ${on} de ${(config.espMacs || []).length} aceso(s) · ${names}`;
  }

  async function loadAway() {
    try { renderAway(await api.getAway()); }
    catch (e) { toast('error', e.message); }
  }

  away.save.onclick = async () => {
    const espMacs = store.selectedMacs();
    if (away.enabled.checked && !espMacs.length) {
      toast('info', 'Selecione ao menos um dispositivo no indicador do topo');
      return;
    }

    try {
      const saved = await api.saveAway({
        enabled: away.enabled.checked,
        espMacs,
        startMinutes: timeToMinutes(away.start.value),
        endMinutes: timeToMinutes(away.end.value),
        minOnMin: Number(away.minOn.value),
        maxOnMin: Number(away.maxOn.value),
        minOffMin: Number(away.minOff.value),
        maxOffMin: Number(away.maxOff.value),
        color: hexToRgb(away.color.value, BLACK)
      });
      renderAway(saved);
      toast('success', away.enabled.checked ? 'Modo ausente ativado' : 'Modo ausente desativado');
    } catch (e) { toast('error', e.message); }
  };

  load();
  loadAway();

  // O estado do modo ausente muda no servidor a cada tick; atualiza de tempos em
  // tempos para o painel não ficar mentindo.
  const awayTimer = setInterval(loadAway, 30000);

  const offs = [store.on('clients', () => { load(); loadAway(); })];

  return () => {
    clearInterval(awayTimer);
    offs.forEach((off) => off());
  };
}
