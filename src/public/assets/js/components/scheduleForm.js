// Formulário de rotina, em modal (bottom-sheet no celular).
//
// Serve criar e editar. Antes só existia criar, num formulário sempre aberto na
// coluna lateral: no celular, oito campos abertos empurravam a lista de rotinas
// inteira para baixo da dobra, e não havia caminho nenhum para corrigir uma
// rotina já criada — só apagar e refazer.
//
// Editar funciona porque upsertSchedule casa por id (data/schedulesStore.js);
// o backend já suportava, faltava a tela.

import { openModal, node, toast } from '../ui.js';
import { hexToRgb, rgbToHex, BLACK } from '../lib/color.js';
import { EFFECTS, effectUsesColor } from '../lib/effects.js';
import { WEEKDAYS } from '../lib/time.js';

const TRIGGERS = [
  { key: 'time', label: 'Horário fixo' },
  { key: 'sunrise', label: 'Nascer do sol' },
  { key: 'sunset', label: 'Pôr do sol' }
];

const ACTIONS = [
  { key: 'color', label: 'Cor sólida' },
  { key: 'sunrise', label: 'Despertador (rampa)' },
  { key: 'effect', label: 'Efeito' },
  { key: 'off', label: 'Apagar' }
];

export function openScheduleForm(existing, { espMacs }) {
  const editing = !!existing;

  return new Promise((resolve) => {
    const content = node(`
      <div>
        <h3 class="text-lg font-semibold">${editing ? 'Editar rotina' : 'Nova rotina'}</h3>
        <div class="mt-4 flex max-h-[65vh] flex-col gap-3 overflow-y-auto pr-1">
          <div>
            <span class="label">Nome</span>
            <input data-name class="field" placeholder="Bom dia" maxlength="40" />
          </div>

          <div>
            <span class="label">Quando</span>
            <select data-trigger class="field">
              ${TRIGGERS.map((t) => `<option value="${t.key}">${t.label}</option>`).join('')}
            </select>
          </div>

          <div data-at-wrap>
            <span class="label">Horário</span>
            <input data-at type="time" value="06:40" class="field" />
          </div>

          <div data-offset-wrap class="hidden">
            <span class="label">Deslocamento (min)</span>
            <input data-offset type="number" value="0" min="-720" max="720" class="field" />
          </div>

          <div>
            <span class="label">Dias</span>
            <div data-days class="flex gap-1">
              ${WEEKDAYS.map((d, i) => `
                <button type="button" data-day="${i}" class="surface h-11 flex-1 text-xs font-medium">${d}</button>`).join('')}
            </div>
            <p class="mt-1 text-xs muted">Nenhum selecionado = todos os dias.</p>
          </div>

          <div>
            <span class="label">Fazer o quê</span>
            <select data-action class="field">
              ${ACTIONS.map((a) => `<option value="${a.key}">${a.label}</option>`).join('')}
            </select>
          </div>

          <div data-effect-wrap class="hidden">
            <span class="label">Efeito</span>
            <select data-effect class="field">
              ${EFFECTS.map((e) => `<option value="${e.key}">${e.label}</option>`).join('')}
            </select>
          </div>

          <div data-color-wrap>
            <span class="label">Cor</span>
            <input data-color type="color" value="#FF7A28"
                   class="h-11 w-full cursor-pointer rounded-xl border border-black/10 bg-transparent p-0 dark:border-white/10" />
          </div>

          <div data-duration-wrap class="hidden">
            <span class="label">Duração da rampa (min)</span>
            <input data-duration type="number" value="20" min="1" max="120" class="field" />
          </div>

          <p class="text-xs muted" data-targets></p>
        </div>

        <div class="mt-5 flex justify-end gap-2">
          <button data-cancel class="btn-ghost">Cancelar</button>
          <button data-ok class="btn-primary">${editing ? 'Salvar' : 'Criar rotina'}</button>
        </div>
      </div>`);

    let settled = false;
    const finish = (value) => { if (!settled) { settled = true; resolve(value); } };
    const { close } = openModal(content, { onClose: () => finish(null) });

    const $ = (sel) => content.querySelector(sel);
    const nameInput = $('[data-name]');
    const triggerSelect = $('[data-trigger]');
    const atWrap = $('[data-at-wrap]');
    const atInput = $('[data-at]');
    const offsetWrap = $('[data-offset-wrap]');
    const offsetInput = $('[data-offset]');
    const actionSelect = $('[data-action]');
    const colorWrap = $('[data-color-wrap]');
    const colorInput = $('[data-color]');
    const durationWrap = $('[data-duration-wrap]');
    const durationInput = $('[data-duration]');
    const effectWrap = $('[data-effect-wrap]');
    const effectSelect = $('[data-effect]');

    const selectedDays = new Set(existing?.trigger?.days || []);

    function paintDay(btn) {
      const on = selectedDays.has(Number(btn.dataset.day));
      btn.classList.toggle('led-ring', on);
      btn.style.color = on ? 'rgb(var(--led))' : '';
    }

    content.querySelectorAll('[data-day]').forEach((btn) => {
      paintDay(btn);
      btn.addEventListener('click', () => {
        const day = Number(btn.dataset.day);
        if (selectedDays.has(day)) selectedDays.delete(day);
        else selectedDays.add(day);
        paintDay(btn);
      });
    });

    function syncForm() {
      const isTime = triggerSelect.value === 'time';
      atWrap.classList.toggle('hidden', !isTime);
      offsetWrap.classList.toggle('hidden', isTime);

      const action = actionSelect.value;
      effectWrap.classList.toggle('hidden', action !== 'effect');
      durationWrap.classList.toggle('hidden', action !== 'sunrise');

      // A cor só aparece quando a ação realmente a usa. Antes ela aparecia para
      // qualquer efeito, inclusive arco-íris e fogo, que têm paleta própria.
      const usesColor = action === 'color'
        || (action === 'effect' && effectUsesColor(effectSelect.value));
      colorWrap.classList.toggle('hidden', !usesColor);
    }

    triggerSelect.addEventListener('change', syncForm);
    actionSelect.addEventListener('change', syncForm);
    effectSelect.addEventListener('change', syncForm);

    // Preenche a partir da rotina existente.
    if (existing) {
      nameInput.value = existing.name || '';
      triggerSelect.value = existing.trigger?.type || 'time';
      if (existing.trigger?.at) atInput.value = existing.trigger.at;
      if (Number.isFinite(existing.trigger?.offsetMin)) offsetInput.value = existing.trigger.offsetMin;

      const action = existing.action || {};
      actionSelect.value = action.type || 'color';
      if (action.effect) effectSelect.value = action.effect;
      if (action.color) colorInput.value = rgbToHex(action.color);
      if (action.durationMin) durationInput.value = action.durationMin;
    }

    syncForm();
    $('[data-targets]').textContent = espMacs.length
      ? `Aplica em ${espMacs.length} ${espMacs.length === 1 ? 'dispositivo' : 'dispositivos'} selecionado(s) no indicador do topo.`
      : 'Nenhum dispositivo selecionado no indicador do topo.';

    setTimeout(() => nameInput.focus(), 50);

    function buildAction() {
      const type = actionSelect.value;
      if (type === 'color') return { type, color: hexToRgb(colorInput.value, BLACK) };
      if (type === 'sunrise') return { type, durationMin: Number(durationInput.value) };
      if (type === 'effect') return { type, effect: effectSelect.value, color: hexToRgb(colorInput.value, BLACK) };
      return { type: 'off' };
    }

    function buildTrigger() {
      const type = triggerSelect.value;
      const days = [...selectedDays].sort((a, b) => a - b);
      if (type === 'time') return { type, at: atInput.value, days };
      return { type, offsetMin: Number(offsetInput.value), days };
    }

    $('[data-cancel]').onclick = () => { finish(null); close(); };
    $('[data-ok]').onclick = () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      if (!espMacs.length) { toast('info', 'Selecione ao menos um dispositivo no indicador do topo'); return; }

      finish({
        ...(existing?.id ? { id: existing.id } : {}),
        ...(existing ? { enabled: existing.enabled } : {}),
        name,
        espMacs,
        trigger: buildTrigger(),
        action: buildAction()
      });
      close();
    };
  });
}
