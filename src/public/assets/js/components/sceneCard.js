// Card de cena: preview, nome, alvos e ações (aplicar / renomear / reordenar /
// excluir).
//
// Uma cena guarda um estado por dispositivo — um pode estar em gradiente e
// outro em efeito — então o subtítulo resume os modos além dos alvos.

import { escapeHtml, icon } from '../ui.js';
import { rgbwCss } from '../lib/color.js';

const MODE_LABELS = {
  solid: 'cor',
  gradient: 'gradiente',
  segments: 'segmentos',
  effect: 'efeito',
  off: 'apagado'
};

function describeDevices(devices, clientsByMac) {
  if (!devices.length) return 'Sem dispositivos';

  const names = devices.map((d) => clientsByMac[d.espMac]?.nickname || d.espMac);
  const target = names.length <= 2 ? names.join(', ') : `${names.length} dispositivos`;

  const modes = [...new Set(devices.map((d) => (
    d.mode === 'effect' ? d.effect : MODE_LABELS[d.mode] || d.mode
  )))];

  return `${target} · ${modes.join(', ')}`;
}

// Gradiente aparece como faixa; o resto, como bloco de cor.
function previewStyle(scene) {
  const gradient = scene.devices?.find((d) => d.mode === 'gradient');
  if (gradient) {
    const stops = gradient.stops
      .map((s) => `rgb(${s.r},${s.g},${s.b}) ${Math.round((s.pos / 255) * 100)}%`)
      .join(', ');
    return `background:linear-gradient(to right, ${stops})`;
  }

  return `background:${rgbwCss(scene.preview || { r: 0, g: 0, b: 0 })}`;
}

export function sceneCard(scene, { onApply, onDelete, onRename, onMove, clientsByMac = {}, canMoveUp, canMoveDown }) {
  const el = document.createElement('div');
  el.className = 'card group relative flex flex-col overflow-hidden';
  el.innerHTML = `
    <button data-act="apply" class="flex items-center gap-3 p-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
      <span class="h-12 w-12 shrink-0 rounded-xl border border-black/10 shadow-inner dark:border-white/10" style="${previewStyle(scene)}"></span>
      <span class="min-w-0 flex-1">
        <span class="block truncate font-medium">${escapeHtml(scene.name)}</span>
        <span class="block truncate text-xs muted">${escapeHtml(describeDevices(scene.devices || [], clientsByMac))}</span>
      </span>
      <span class="shrink-0 rounded-lg bg-indigo-500/10 px-2.5 py-1 text-xs font-medium text-indigo-600 dark:text-indigo-300">Aplicar</span>
    </button>
    <div class="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100">
      <button data-act="up" class="rounded-lg bg-white/80 p-1.5 text-zinc-400 hover:text-indigo-500 disabled:opacity-30 dark:bg-zinc-900/80" aria-label="Mover para cima" ${canMoveUp ? '' : 'disabled'}>▲</button>
      <button data-act="down" class="rounded-lg bg-white/80 p-1.5 text-zinc-400 hover:text-indigo-500 disabled:opacity-30 dark:bg-zinc-900/80" aria-label="Mover para baixo" ${canMoveDown ? '' : 'disabled'}>▼</button>
      <button data-act="rename" class="rounded-lg bg-white/80 p-1.5 text-zinc-400 hover:text-indigo-500 dark:bg-zinc-900/80" aria-label="Renomear cena">
        ${icon('pencil', 'h-4 w-4')}
      </button>
      <button data-act="delete" class="rounded-lg bg-white/80 p-1.5 text-zinc-400 hover:text-red-500 dark:bg-zinc-900/80" aria-label="Excluir cena">
        ${icon('trash', 'h-4 w-4')}
      </button>
    </div>`;

  const stop = (handler) => (e) => { e.stopPropagation(); handler(scene); };

  el.querySelector('[data-act="apply"]').addEventListener('click', () => onApply(scene));
  el.querySelector('[data-act="delete"]').addEventListener('click', stop(onDelete));
  el.querySelector('[data-act="rename"]').addEventListener('click', stop(onRename));
  el.querySelector('[data-act="up"]').addEventListener('click', (e) => { e.stopPropagation(); onMove(scene, -1); });
  el.querySelector('[data-act="down"]').addEventListener('click', (e) => { e.stopPropagation(); onMove(scene, 1); });

  return el;
}
