// Card de rotina: horário em destaque, o que faz, e as ações.
// Espelha a assinatura de sceneCard.js.
//
// O horário resolvido vem grande porque é o que se procura ao bater o olho na
// lista; o resto é subtítulo. A amostra de cor mostra a luz que a rotina vai
// produzir, quando a ação tem cor.

import { escapeHtml, icon } from '../ui.js';
import { rgbToHex, rgbCss } from '../lib/color.js';
import { effectLabel, effectUsesColor } from '../lib/effects.js';
import { minutesToLabel, describeDays } from '../lib/time.js';

function describeWhen(schedule) {
  const { trigger, todayMinutes } = schedule;
  if (trigger.type === 'time') return trigger.at;
  // todayMinutes vem calculado do servidor; sem coordenadas ele é null.
  return todayMinutes === null ? '—' : minutesToLabel(todayMinutes);
}

function describeSource(schedule) {
  const { trigger, todayMinutes } = schedule;
  const days = describeDays(trigger.days);

  if (trigger.type === 'time') return days;

  const label = trigger.type === 'sunrise' ? 'nascer do sol' : 'pôr do sol';
  const offset = trigger.offsetMin
    ? ` ${trigger.offsetMin > 0 ? '+' : ''}${trigger.offsetMin} min`
    : '';
  const resolved = todayMinutes === null ? ' (sem coordenadas)' : '';
  return `${label}${offset} · ${days}${resolved}`;
}

export function describeAction(action) {
  switch (action.type) {
    case 'color': return `Cor ${rgbToHex(action.color)}`;
    case 'sunrise': return `Despertador, ${action.durationMin} min`;
    case 'effect': return `Efeito ${effectLabel(action.effect)}`;
    case 'off': return 'Apagar';
    default: return action.type;
  }
}

// A cor que a rotina vai acender, quando ela tem uma.
function actionColor(action) {
  if (action.type === 'color') return action.color || null;
  if (action.type === 'effect' && effectUsesColor(action.effect)) return action.color || null;
  return null;
}

export function scheduleCard(schedule, { onRun, onToggle, onEdit, onDelete, clientsByMac = {} }) {
  const el = document.createElement('div');
  const paused = !schedule.enabled;
  const color = actionColor(schedule.action);

  el.className = `card flex flex-col gap-3 p-3${paused ? ' opacity-60' : ''}`;
  if (color) el.style.setProperty('--led', `${color.r | 0} ${color.g | 0} ${color.b | 0}`);

  const devices = (schedule.espMacs || [])
    .map((mac) => clientsByMac[mac]?.nickname || mac)
    .join(', ');

  el.innerHTML = `
    <div class="flex items-start gap-3">
      <span class="mt-0.5 h-10 w-10 shrink-0 rounded-xl border ${color ? 'border-white/15' : 'border-dashed border-zinc-300 dark:border-zinc-700'}"
            style="${color ? `background:${rgbCss(color)}` : ''}"></span>
      <div class="min-w-0 flex-1">
        <div class="flex items-baseline gap-2">
          <span class="tabular text-xl font-semibold leading-none">${escapeHtml(describeWhen(schedule))}</span>
          ${paused ? '<span class="text-xs muted">pausada</span>' : ''}
          ${schedule.ranToday ? '<span class="text-xs muted">· já rodou hoje</span>' : ''}
        </div>
        <p class="mt-1 truncate text-sm font-medium">${escapeHtml(schedule.name)}</p>
        <p class="truncate text-xs muted">${escapeHtml(describeSource(schedule))}</p>
        <p class="truncate text-xs muted">${escapeHtml(describeAction(schedule.action))} · ${escapeHtml(devices)}</p>
      </div>
    </div>
    <div class="flex items-center gap-2">
      <button data-act="run" class="btn-subtle flex-1 px-2 py-1 text-xs">Testar</button>
      <button data-act="toggle" class="btn-subtle flex-1 px-2 py-1 text-xs">${paused ? 'Ativar' : 'Pausar'}</button>
      <button data-act="edit" class="icon-btn" aria-label="Editar rotina">${icon('pencil', 'h-4 w-4')}</button>
      <button data-act="delete" class="icon-btn hover:text-red-500" aria-label="Excluir rotina">${icon('trash', 'h-4 w-4')}</button>
    </div>`;

  el.querySelector('[data-act="run"]').addEventListener('click', () => onRun(schedule));
  el.querySelector('[data-act="toggle"]').addEventListener('click', () => onToggle(schedule));
  el.querySelector('[data-act="edit"]').addEventListener('click', () => onEdit(schedule));
  el.querySelector('[data-act="delete"]').addEventListener('click', () => onDelete(schedule));

  return el;
}
