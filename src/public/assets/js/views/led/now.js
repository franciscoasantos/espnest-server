// Agora: a cor que a fita está mostrando, os efeitos e o gradiente.
//
// É o painel de abertura de /led — abrir o app e mudar a luz não pode custar
// mais que um toque, então o seletor de cor é a primeira coisa da tela.
//
// Sai do antigo views/led.js; cenas e rotinas viraram painéis irmãos.

import { store } from '../../store.js';
import { api } from '../../api.js';
import { icon, escapeHtml, toast } from '../../ui.js';
import { createColorControl } from '../../components/colorControl.js';
import { hexToRgb, rgbToHex, BLACK } from '../../lib/color.js';
import { EFFECTS, intensityLabel as intensityLabelFor } from '../../lib/effects.js';
import { createGradientEditor } from '../../components/gradientEditor.js';
import { showResult } from '../../components/resultToast.js';
import { stageHtml, patchStage } from '../../components/stripStage.js';

// Doze cores fixas, todas no mesmo grau de saturação. O roxo e o rosa eram os
// únicos com canal mínimo diferente de zero (44 e 77 no verde), o que os
// deixava lavados ao lado dos vizinhos; agora seguem o mesmo matiz com S=100%.
const FAVORITES = ['#FFFFFF', '#FF0000', '#FF7A00', '#FBFF00', '#8BFF00', '#00FF00', '#00D4FF', '#0095FF', '#0022FF', '#4C00FF', '#EA00FF', '#FF0066'];

// Gradiente é um padrão estático: vale um fade mais longo ao aplicar.
// O seletor ao vivo não usa fade — ele já manda uma cor a cada 140 ms e um
// crossfade longo faria o arraste parecer atrasado.
const GRADIENT_FADE_MS = 800;

function mixRgb(a, b, f) {
  return {
    r: Math.round(a.r + (b.r - a.r) * f),
    g: Math.round(a.g + (b.g - a.g) * f),
    b: Math.round(a.b + (b.b - a.b) * f)
  };
}

export function mount(el) {
  el.innerHTML = `
    <div class="flex flex-col gap-5">
      <section class="card p-4 sm:p-5">
        <div class="mb-4" data-preview></div>
        <div data-color></div>
        <div class="mt-5">
          <span class="label">Paleta</span>
          <div class="grid grid-cols-10 gap-2" data-tones></div>
          <div class="mt-2 grid grid-cols-12 gap-2" data-favorites></div>
        </div>
      </section>

      <section class="card p-4 sm:p-5">
        <h2 class="mb-1 text-sm font-semibold">Efeitos</h2>
        <p class="mb-4 text-xs muted">Rodam no próprio ESP32 — o servidor envia só um comando.</p>
        <div class="grid grid-cols-2 gap-2 lg:grid-cols-4" data-effects>
          ${EFFECTS.map((e) => `
            <button data-effect="${e.key}" class="surface flex flex-col items-start gap-1 p-3 text-left transition">
              <span class="text-sm font-medium">${e.label}</span>
              <span class="text-xs muted">${e.desc}</span>
            </button>`).join('')}
        </div>
        <div data-params class="mt-4 hidden grid gap-3 sm:grid-cols-2">
          <div>
            <div class="flex items-center justify-between text-sm">
              <span class="muted">Velocidade</span>
              <span data-speed-val class="tabular font-medium">50</span>
            </div>
            <input data-speed type="range" min="0" max="100" value="50" class="mt-1 w-full accent-indigo-500" />
          </div>
          <div>
            <div class="flex items-center justify-between text-sm">
              <span data-intensity-label class="muted">Intensidade</span>
              <span data-intensity-val class="tabular font-medium">50</span>
            </div>
            <input data-intensity type="range" min="0" max="100" value="50" class="mt-1 w-full accent-indigo-500" />
          </div>
        </div>
        <button data-stop class="btn-ghost mt-3 hidden w-full">${icon('x', 'h-4 w-4')} Parar efeito</button>
      </section>

      <section class="card p-4 sm:p-5">
        <h2 class="mb-1 text-sm font-semibold">Gradiente</h2>
        <p class="mb-4 text-xs muted">O ESP interpola entre as cores ao longo da fita.</p>
        <div data-gradient></div>
        <button data-apply-gradient class="btn-led mt-4 w-full">Aplicar gradiente</button>
      </section>
    </div>`;

  const previewEl = el.querySelector('[data-preview]');
  const colorMount = el.querySelector('[data-color]');
  const tonesEl = el.querySelector('[data-tones]');
  const favoritesEl = el.querySelector('[data-favorites]');
  const stopBtn = el.querySelector('[data-stop]');
  const paramsEl = el.querySelector('[data-params]');
  const speedInput = el.querySelector('[data-speed]');
  const speedVal = el.querySelector('[data-speed-val]');
  const intensityInput = el.querySelector('[data-intensity]');
  const intensityVal = el.querySelector('[data-intensity-val]');
  const intensityLabel = el.querySelector('[data-intensity-label]');
  const gradientMount = el.querySelector('[data-gradient]');

  let applyTimer = null;
  let effectTimer = null;
  let effectKey = null;
  // Cor-base da rampa de tons. Declarada aqui, e não junto da paleta, porque o
  // onChange do seletor logo abaixo já a referencia.
  let toneAnchor = null;

  const control = createColorControl(colorMount, {
    hasWhite: false,
    onChange: (color) => {
      if (effectKey) clearEffect();
      // Mexer no anel escolhe uma cor-base nova: aí sim a rampa acompanha.
      toneAnchor = { r: color.r, g: color.g, b: color.b };
      renderPalette();
      scheduleApply(color);
    }
  });

  const gradient = createGradientEditor(gradientMount);

  function selectedOnline() {
    return store.selectedMacs().filter((m) => store.isConnected(m));
  }

  function anySk6812() {
    return store.selectedClients().some((c) => c.ledType === 'sk6812');
  }

  /* ------------------------------- palco ---------------------------------- */
  // O palco mostra o que a fita do primeiro selecionado está mostrando de fato,
  // e não o que o seletor tem — é a diferença entre "o que eu escolhi" e "o que
  // está aceso" quando o comando ainda não saiu ou o dispositivo está offline.
  function renderPreview() {
    const first = store.selectedClients()[0];
    if (!first) { previewEl.innerHTML = ''; return; }

    // A legenda existe porque o palco sozinho não se explica: uma faixa no topo
    // da tela pode ser lida como decoração, ou como erro quando está apagada.
    const others = store.selection.size - 1;
    previewEl.innerHTML = `
      <div class="mb-1.5 flex items-baseline gap-2">
        <span class="label mb-0">A fita agora</span>
        <span class="truncate text-xs muted">${escapeHtml(first.nickname)}${others > 0 ? ` · +${others}` : ''}</span>
      </div>
      ${stageHtml(first, { size: 'lg' })}`;
  }

  function patchPreview() {
    const first = store.selectedClients()[0];
    if (!first) return;
    const stage = previewEl.querySelector('[data-stage]');
    if (stage) patchStage(stage, first, 'lg');
    else renderPreview();
  }

  function scheduleApply(color) {
    const macs = store.selectedMacs();
    if (!macs.length) return;
    clearTimeout(applyTimer);
    clearTimeout(effectTimer);
    // 140 ms: o arraste do anel dispara muito mais rápido do que o WebSocket do
    // ESP aguenta. Não trocar por rAF.
    applyTimer = setTimeout(async () => {
      try { await api.sendLed({ espMacs: macs, ...color }); }
      catch (e) { toast('error', e.message); }
    }, 140);
  }

  /* ------------------------------- paleta --------------------------------- */
  // Tons: branco -> cor-base (âncora) -> preto, em 10 amostras.
  //
  // A âncora é a cor escolhida no anel ou num favorito — nunca o tom clicado.
  // Antes, clicar num tom reancorava a rampa nele: as 10 amostras eram
  // recalculadas e saíam de baixo do dedo, então não dava para percorrer os
  // tons de uma cor. Agora clicar num tom só move o cursor do seletor e o anel
  // de seleção; a rampa fica parada.

  // Clicar num tom: move o cursor até ele e mantém a rampa onde está.
  function pickTone(rgb) {
    clearEffect();
    control.setColor(rgb);
    paintSelection();
    scheduleApply(control.getColor());
  }

  // Clicar num favorito é escolher outra cor-base, então a rampa reancora.
  function pickFavorite(rgb) {
    clearEffect();
    control.setColor(rgb);
    toneAnchor = { r: rgb.r, g: rgb.g, b: rgb.b };
    renderPalette();
    scheduleApply(control.getColor());
  }

  function swatchButton(hex, rgb, onPick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'h-6 rounded-lg border border-black/10 p-0 dark:border-white/10';
    btn.dataset.hex = hex.toUpperCase();
    btn.style.background = hex;
    btn.title = hex;
    btn.addEventListener('click', () => onPick(rgb));
    return btn;
  }

  // Move só o anel de seleção, sem reconstruir as amostras.
  function paintSelection() {
    const activeHex = rgbToHex(control.getColor());
    [...tonesEl.children, ...favoritesEl.children].forEach((btn) => {
      const on = btn.dataset.hex === activeHex;
      btn.classList.toggle('ring-2', on);
      btn.classList.toggle('ring-inset', on);
      btn.classList.toggle('ring-white/70', on);
    });
  }

  function renderPalette() {
    const base = toneAnchor || control.getColor();

    tonesEl.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const rgb = i <= 4
        ? mixRgb({ r: 255, g: 255, b: 255 }, base, i / 4)
        : mixRgb(base, { r: 0, g: 0, b: 0 }, (i - 4) / 5);
      tonesEl.appendChild(swatchButton(rgbToHex(rgb), rgb, pickTone));
    }

    favoritesEl.innerHTML = '';
    FAVORITES.forEach((hex) => {
      favoritesEl.appendChild(swatchButton(hex, hexToRgb(hex, BLACK), pickFavorite));
    });

    paintSelection();
  }

  /* ------------------------------- efeitos -------------------------------- */
  function setEffectUI() {
    el.querySelectorAll('[data-effect]').forEach((b) => {
      const active = b.dataset.effect === effectKey;
      // O estado ativo veste a cor da fita, e não um acento fixo.
      b.classList.toggle('led-ring', active);
    });
    stopBtn.classList.toggle('hidden', !effectKey);
    paramsEl.classList.toggle('hidden', !effectKey);
    if (effectKey) intensityLabel.textContent = intensityLabelFor(effectKey);
  }

  // Limpa só o destaque local (sem rede). Usado quando uma cor sólida assume o
  // controle — o próprio comando /led já interrompe o efeito no ESP.
  function clearEffect() {
    effectKey = null;
    setEffectUI();
  }

  async function startEffect(key) {
    const macs = selectedOnline();
    if (!macs.length) { toast('info', 'Nenhum dispositivo online selecionado'); return; }
    if (effectKey === key) { stopEffect(); return; }

    effectKey = key;
    setEffectUI();
    const c = control.getColor();
    const label = (EFFECTS.find((e) => e.key === key) || {}).label || 'Efeito';
    try {
      const res = await api.sendEffect({
        espMacs: macs,
        effect: key,
        r: c.r, g: c.g, b: c.b,
        speed: Number(speedInput.value),
        intensity: Number(intensityInput.value)
      });
      showResult(res, { actionLabel: label, clientsByMac: store.clientsByMac() });
    } catch (e) {
      toast('error', e.message);
      clearEffect();
    }
  }

  async function stopEffect() {
    const wasActive = effectKey;
    clearEffect();
    if (!wasActive) return;
    const macs = selectedOnline();
    if (!macs.length) return;
    try { await api.sendEffect({ espMacs: macs, effect: 'none' }); }
    catch (e) { toast('error', e.message); }
  }

  // Mexer num slider com efeito ativo reenvia o comando (um só, com debounce) —
  // a animação segue rodando no ESP com os novos parâmetros.
  function scheduleEffectParams() {
    if (!effectKey) return;
    const macs = selectedOnline();
    if (!macs.length) return;
    const c = control.getColor();
    clearTimeout(effectTimer);
    effectTimer = setTimeout(async () => {
      try {
        await api.sendEffect({
          espMacs: macs,
          effect: effectKey,
          r: c.r, g: c.g, b: c.b,
          speed: Number(speedInput.value),
          intensity: Number(intensityInput.value)
        });
      } catch (e) { toast('error', e.message); }
    }, 200);
  }

  speedInput.addEventListener('input', () => {
    speedVal.textContent = speedInput.value;
    scheduleEffectParams();
  });
  intensityInput.addEventListener('input', () => {
    intensityVal.textContent = intensityInput.value;
    scheduleEffectParams();
  });

  el.querySelectorAll('[data-effect]').forEach((b) => {
    b.onclick = () => startEffect(b.dataset.effect);
  });
  stopBtn.onclick = stopEffect;

  el.querySelector('[data-apply-gradient]').onclick = async () => {
    const macs = selectedOnline();
    if (!macs.length) { toast('info', 'Nenhum dispositivo online selecionado'); return; }
    clearEffect();
    try {
      const res = await api.sendGradient({ espMacs: macs, stops: gradient.getStops(), fadeMs: GRADIENT_FADE_MS });
      showResult(res, { actionLabel: 'Gradiente', clientsByMac: store.clientsByMac() });
    } catch (e) { toast('error', e.message); }
  };

  /* -------------------------------- init ---------------------------------- */
  // Reidrata a partir do estado central (cor e efeito do primeiro selecionado).
  // Sem isto, voltar para /led com um efeito rodando mostrava tudo apagado.
  function hydrateFromStore() {
    control.setWhiteEnabled(anySk6812());
    renderPreview();

    const first = store.selectedClients()[0];
    // O editor de gradiente mostra em qual LED cada ponto cai; o comprimento da
    // fita depende de quem está selecionado, então quem informa é a view.
    gradient.setLedCount(first ? first.ledCount : null);
    if (!first) { effectKey = null; setEffectUI(); renderPalette(); return; }

    const col = store.colorOf(first.espMac);
    if (col) {
      control.setColor(col);
      // A cor que a fita está mostrando é a cor-base natural da rampa.
      toneAnchor = { r: col.r, g: col.g, b: col.b };
    }
    effectKey = store.effectOf(first.espMac);
    setEffectUI();
    renderPalette();

    const pattern = first.lastPattern;
    if (pattern?.type === 'gradient' && Array.isArray(pattern.stops)) gradient.setStops(pattern.stops);
  }

  function isFirstSelected(espMac) {
    const first = store.selectedClients()[0];
    return !!first && first.espMac === espMac;
  }

  hydrateFromStore();

  const offs = [
    store.on('selection', hydrateFromStore),
    store.on('clients', hydrateFromStore),
    store.on('status', () => { control.setWhiteEnabled(anySk6812()); renderPreview(); }),
    store.on('state', patchPreview),
    store.on('effect', ({ espMac }) => {
      patchPreview();
      if (!isFirstSelected(espMac)) return;
      effectKey = store.effectOf(espMac);
      setEffectUI();
    })
  ];

  return () => {
    offs.forEach((off) => off());
    clearTimeout(applyTimer);
    clearTimeout(effectTimer);
    // Não interrompe o efeito ao sair da tela — ele continua rodando no ESP.
    clearEffect();
    // Solta os listeners de window; sem isto eles vazam a cada navegação.
    control.destroy();
  };
}
