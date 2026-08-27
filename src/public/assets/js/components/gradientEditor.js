// Editor de gradiente: manipulação direta sobre a própria fita.
//
// Antes isto era uma lista de linhas "quadradinho de cor + slider + %": dava
// para editar o gradiente inteiro sem nunca ver o gradiente. Agora a barra é a
// fita, e os stops são alças que se arrastam em cima dela — arrastar para mover,
// tocar num vão para inserir uma cor ali, tocar numa alça para editá-la.
//
// O firmware interpola entre os stops, então o payload continua pequeno —
// mandar 589 pixels não passaria pelo buffer de 1 KB do WebSocket.

import { hexToRgb, rgbToHex, rgbCss, BLACK } from '../lib/color.js';
import {
  MAX_STOPS, MIN_STOPS, clampPos, toPercent as pct,
  sortStops as sortAsc, gradientCss, colorAt, normalizeStops
} from '../lib/gradient.js';
import { icon } from '../ui.js';

// Pontos de partida. Um gradiente do zero quase sempre começa como "duas cores
// que combinam"; ter isso a um toque vale mais do que ajustar dois seletores.
const PRESETS = [
  { name: 'Pôr do sol', stops: [[0, 255, 94, 20], [140, 255, 45, 120], [255, 60, 20, 140]] },
  { name: 'Oceano', stops: [[0, 0, 210, 255], [255, 20, 30, 190]] },
  { name: 'Floresta', stops: [[0, 180, 255, 60], [255, 0, 90, 70]] },
  { name: 'Brasa', stops: [[0, 255, 200, 40], [130, 255, 60, 0], [255, 120, 0, 0]] },
  { name: 'Lilás', stops: [[0, 190, 120, 255], [255, 60, 90, 220]] },
  { name: 'Gelo', stops: [[0, 255, 255, 255], [255, 90, 170, 255]] }
];

export function createGradientEditor(container, { onChange, ledCount = null } = {}) {
  let stops = [
    { pos: 0, r: 255, g: 120, b: 40 },
    { pos: 255, r: 0, g: 40, b: 255 }
  ];
  // Seleção por referência, e não por índice: ordenar reorganiza o array e um
  // índice guardado passaria a apontar para outro stop.
  let selected = stops[0];
  let leds = ledCount;

  container.innerHTML = `
    <div class="flex flex-col gap-3">
      <div class="relative pb-4">
        <div data-bar class="stage h-16 cursor-copy" title="Toque para inserir uma cor"></div>
        <!-- top-16 = a borda de baixo da barra: as alças ficam montadas na
             fita, e não flutuando abaixo dela. O pb-4 dá espaço para a metade
             inferior da alça selecionada (h-7). -->
        <div data-handles class="pointer-events-none absolute inset-x-0 top-16 h-0"></div>
      </div>

      <p class="text-xs muted" data-hint></p>

      <div data-editor class="surface flex flex-wrap items-center gap-2 p-2"></div>

      <div>
        <span class="label">Começar de</span>
        <div class="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" data-presets></div>
      </div>
    </div>`;

  const barEl = container.querySelector('[data-bar]');
  const handlesEl = container.querySelector('[data-handles]');
  const editorEl = container.querySelector('[data-editor]');
  const hintEl = container.querySelector('[data-hint]');
  const presetsEl = container.querySelector('[data-presets]');

  const getStops = () => stops.map((s) => ({ pos: s.pos, r: s.r, g: s.g, b: s.b }));

  function emit() {
    if (onChange) onChange(getStops());
  }


  function posFromClientX(clientX) {
    const rect = barEl.getBoundingClientRect();
    if (!rect.width) return 0;
    return clampPos(((clientX - rect.left) / rect.width) * 255);
  }

  /* -------------------------------- render -------------------------------- */

  // Só o fundo muda durante o arraste: nada de reconstruir a árvore, senão a
  // alça sendo arrastada é destruída no meio do gesto.
  function paintBar() {
    barEl.style.background = gradientCss(stops);
  }

  function handleClass(isSelected) {
    return [
      'pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full',
      'border-2 shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50',
      isSelected ? 'h-7 w-7 border-white ring-2 ring-black/20' : 'h-5 w-5 border-white/90'
    ].join(' ');
  }

  // Repinta a seleção sem reconstruir as alças. Reconstruir durante um gesto
  // destruiria justamente o elemento que recebeu o pointerdown, e os
  // pointermove seguintes deixariam de chegar.
  function markSelection() {
    Array.from(handlesEl.children).forEach((el, i) => {
      el.className = handleClass(stops[i] === selected);
    });
  }

  function renderHandles() {
    handlesEl.innerHTML = '';

    stops.forEach((stop) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.handle = '';
      btn.className = handleClass(stop === selected);
      // touch-action: none, ou arrastar a alça rola a página no celular.
      btn.style.cssText = `left:${pct(stop.pos)}%;touch-action:none;background:${rgbCss(stop)}`;
      btn.setAttribute('role', 'slider');
      btn.setAttribute('aria-label', `Ponto do gradiente em ${Math.round(pct(stop.pos))}%`);
      btn.setAttribute('aria-valuemin', '0');
      btn.setAttribute('aria-valuemax', '255');
      btn.setAttribute('aria-valuenow', String(stop.pos));

      btn.addEventListener('pointerdown', (e) => startDrag(e, stop, btn));
      btn.addEventListener('keydown', (e) => onHandleKey(e, stop));

      handlesEl.appendChild(btn);
    });
  }

  function renderEditor() {
    const stop = selected;
    const hex = rgbToHex(stop);
    const ledIndex = Number.isInteger(leds) && leds > 0
      ? Math.min(leds - 1, Math.round((stop.pos / 255) * (leds - 1)))
      : null;

    editorEl.innerHTML = `
      <input data-color type="color" value="${hex}"
             class="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-black/10 bg-transparent p-0 dark:border-white/10"
             aria-label="Cor do ponto" />
      <input data-hex class="field w-28 shrink-0 font-mono uppercase" maxlength="7" value="${hex}" aria-label="Cor em hexadecimal" />
      <label class="flex items-center gap-1.5 text-xs muted">
        Posição
        <input data-pct type="number" min="0" max="100" value="${Math.round(pct(stop.pos))}"
               class="field w-20 tabular" aria-label="Posição em porcentagem" />
        %
      </label>
      ${ledIndex === null ? '' : `<span class="tabular text-xs muted">LED ${ledIndex}</span>`}
      <button data-remove class="icon-btn ml-auto hover:text-red-500" aria-label="Remover ponto"
              ${stops.length <= MIN_STOPS ? 'disabled' : ''}>
        ${icon('trash', 'h-4 w-4')}
      </button>`;

    const colorInput = editorEl.querySelector('[data-color]');
    const hexInput = editorEl.querySelector('[data-hex]');
    const pctInput = editorEl.querySelector('[data-pct]');

    colorInput.addEventListener('input', () => {
      Object.assign(stop, hexToRgb(colorInput.value, BLACK));
      hexInput.value = rgbToHex(stop);
      paintBar();
      renderHandles();
      emit();
    });

    // Hex inválido reverte em vez de apagar a fita.
    hexInput.addEventListener('change', () => {
      const rgb = hexToRgb(hexInput.value);
      if (!rgb) { hexInput.value = rgbToHex(stop); return; }
      Object.assign(stop, rgb);
      colorInput.value = rgbToHex(stop);
      paintBar();
      renderHandles();
      emit();
    });

    pctInput.addEventListener('change', () => {
      const value = Number(pctInput.value);
      if (!Number.isFinite(value)) { pctInput.value = Math.round(pct(stop.pos)); return; }
      stop.pos = clampPos((Math.max(0, Math.min(100, value)) / 100) * 255);
      sortAsc(stops);
      renderAll();
      emit();
    });

    editorEl.querySelector('[data-remove]').addEventListener('click', () => removeStop(stop));
  }

  function renderHint() {
    const room = MAX_STOPS - stops.length;
    hintEl.textContent = room > 0
      ? `Arraste os pontos para mover. Toque na faixa para inserir uma cor — cabem mais ${room}.`
      : `Arraste os pontos para mover. Limite de ${MAX_STOPS} cores atingido.`;
  }

  function renderPresets() {
    presetsEl.innerHTML = PRESETS.map((p, i) => {
      const css = gradientCss(p.stops.map(([pos, r, g, b]) => ({ pos, r, g, b })));
      return `
        <button data-preset="${i}" type="button"
                class="shrink-0 overflow-hidden rounded-lg border border-black/10 text-left dark:border-white/10">
          <span class="block h-7 w-24" style="background:${css}"></span>
          <span class="block px-2 py-1 text-[11px] muted">${p.name}</span>
        </button>`;
    }).join('');

    presetsEl.querySelectorAll('[data-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = PRESETS[Number(btn.dataset.preset)];
        stops = preset.stops.map(([pos, r, g, b]) => ({ pos, r, g, b }));
        selected = stops[0];
        renderAll();
        emit();
      });
    });
  }

  function renderAll() {
    if (!stops.includes(selected)) selected = stops[0];
    paintBar();
    renderHandles();
    renderEditor();
    renderHint();
  }

  /* -------------------------------- gestos -------------------------------- */

  function startDrag(e, stop, handle) {
    e.preventDefault();
    // Sem isto o pointerdown da barra dispararia junto e inseriria um ponto.
    e.stopPropagation();

    selected = stop;
    // Só repinta e atualiza o editor: a alça sob o dedo continua a mesma.
    markSelection();
    renderEditor();

    handle.setPointerCapture?.(e.pointerId);
    handle.focus?.();

    let moved = false;

    const onMove = (ev) => {
      moved = true;
      stop.pos = posFromClientX(ev.clientX);
      handle.style.left = `${pct(stop.pos)}%`;
      handle.setAttribute('aria-valuenow', String(stop.pos));
      // Sem reordenar aqui: a lista mudaria de ordem e a alça sob o dedo sumiria.
      paintBar();
      emit();
    };

    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
      if (!moved) return;
      // Só agora reordena e reconstrói, com o gesto encerrado.
      sortAsc(stops);
      renderAll();
      emit();
    };

    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  function onHandleKey(e, stop) {
    const step = e.shiftKey ? 26 : 3;
    let next = stop.pos;

    if (e.key === 'ArrowLeft') next = stop.pos - step;
    else if (e.key === 'ArrowRight') next = stop.pos + step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = 255;
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeStop(stop); return; }
    else return;

    e.preventDefault();
    selected = stop;
    stop.pos = clampPos(next);
    sortAsc(stops);
    renderAll();
    emit();

    // Devolve o foco à alça que acabou de se mover.
    handlesEl.children[stops.indexOf(stop)]?.focus();
  }

  function removeStop(stop) {
    if (stops.length <= MIN_STOPS) return;
    const index = stops.indexOf(stop);
    if (index < 0) return;
    stops.splice(index, 1);
    selected = stops[Math.min(index, stops.length - 1)];
    renderAll();
    emit();
  }

  // Tocar num vão insere um ponto ali, com a cor que o gradiente já mostra
  // naquele lugar — inserir não muda o desenho, só dá um ponto para ajustar.
  barEl.addEventListener('pointerdown', (e) => {
    if (stops.length >= MAX_STOPS) return;
    const pos = posFromClientX(e.clientX);
    const stop = { pos, ...colorAt(stops, pos) };
    stops.push(stop);
    sortAsc(stops);
    selected = stop;
    renderAll();
    emit();
  });

  renderPresets();
  renderAll();

  return {
    getStops,

    setStops(next) {
      const normalized = normalizeStops(next);
      if (!normalized) return;
      stops = normalized;
      selected = stops[0];
      renderAll();
    },

    // O comprimento da fita só é conhecido pela view (depende do selecionado);
    // com ele o editor mostra em qual LED o ponto cai.
    setLedCount(count) {
      const next = Number.isInteger(count) && count > 0 ? count : null;
      if (next === leds) return;
      leds = next;
      renderEditor();
    }
  };
}
