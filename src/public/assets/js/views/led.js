// Controle de LED: cor, branco (sk6812), efeitos e cenas/favoritos.
// Atua sobre a seleção global de dispositivos.

import { store } from '../store.js';
import { api } from '../api.js';
import { icon, escapeHtml, toast, openModal, confirmModal, node } from '../ui.js';
import { createColorControl } from '../components/colorControl.js';
import { rgbToHex } from '../lib/color.js';
import { createGradientEditor } from '../components/gradientEditor.js';
import { sceneCard } from '../components/sceneCard.js';
import { showResult } from '../components/resultToast.js';

// Cores favoritas fixas (como na versão anterior)
const FAVORITES = ['#FFFFFF', '#FF0000', '#FF7A00', '#FBFF00', '#8BFF00', '#00FF00', '#00D4FF', '#0095FF', '#0022FF', '#6B2CFF', '#EA00FF', '#FF4D94'];

function mixRgb(a, b, f) {
  return { r: Math.round(a.r + (b.r - a.r) * f), g: Math.round(a.g + (b.g - a.g) * f), b: Math.round(a.b + (b.b - a.b) * f) };
}

// Transição ao aplicar uma cena. O seletor ao vivo não usa fade: ele já manda
// uma cor a cada 140 ms e um crossfade longo faria o arraste parecer atrasado.
const SCENE_FADE_MS = 600;

// Gradiente é um padrão estático: vale um fade mais longo ao aplicar.
const GRADIENT_FADE_MS = 800;

// Todos rodam no firmware. `usesColor` diz se o efeito parte da cor
// escolhida no seletor — fogo, arco-íris e transição têm paleta própria.
const EFFECTS = [
  { key: 'breathing', label: 'Respiração', desc: 'Pulsa o brilho suavemente', usesColor: true },
  { key: 'rainbow', label: 'Arco-íris', desc: 'Percorre todas as cores', usesColor: false },
  { key: 'fade', label: 'Transição', desc: 'Alterna entre cores', usesColor: false },
  { key: 'fire', label: 'Fogo', desc: 'Chama subindo pela fita', usesColor: false },
  { key: 'comet', label: 'Cometa', desc: 'Cabeça com cauda deslizando', usesColor: true },
  { key: 'twinkle', label: 'Estrelas', desc: 'Pontos piscando ao acaso', usesColor: true },
  { key: 'wave', label: 'Onda', desc: 'Cristas indo e voltando', usesColor: true },
  { key: 'wipe', label: 'Preenchimento', desc: 'Preenche e recomeça', usesColor: true }
];

// Significado da intensidade muda por efeito; o rótulo acompanha.
const INTENSITY_LABELS = {
  breathing: 'Profundidade',
  fire: 'Altura da chama',
  comet: 'Tamanho da cauda',
  twinkle: 'Densidade',
  wave: 'Número de cristas',
  wipe: 'Suavidade da borda'
};

export async function mount(view) {
  view.innerHTML = `
    <div data-guard></div>
    <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div class="flex flex-col gap-6">
        <section class="card p-5">
          <h2 class="mb-4 text-sm font-semibold">Cor</h2>
          <div data-color></div>
          <div class="mt-5">
            <span class="label">Paleta</span>
            <div class="grid grid-cols-10 gap-2" data-tones></div>
            <div class="mt-2 grid grid-cols-12 gap-2" data-favorites></div>
          </div>
        </section>

        <section class="card p-5">
          <h2 class="mb-1 text-sm font-semibold">Efeitos</h2>
          <p class="mb-4 text-xs muted">Rodam no próprio ESP32 — o servidor envia só um comando.</p>
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4" data-effects>
            ${EFFECTS.map((e) => `
              <button data-effect="${e.key}" class="surface flex flex-col items-start gap-1 p-3 text-left transition hover:border-indigo-400">
                <span class="text-sm font-medium">${e.label}</span>
                <span class="text-xs muted">${e.desc}</span>
              </button>`).join('')}
          </div>
          <div data-params class="mt-4 hidden grid gap-3 sm:grid-cols-2">
            <div>
              <div class="flex items-center justify-between text-sm">
                <span class="muted">Velocidade</span>
                <span data-speed-val class="font-medium tabular-nums">50</span>
              </div>
              <input data-speed type="range" min="0" max="100" value="50" class="mt-1 w-full accent-indigo-500" />
            </div>
            <div>
              <div class="flex items-center justify-between text-sm">
                <span data-intensity-label class="muted">Intensidade</span>
                <span data-intensity-val class="font-medium tabular-nums">50</span>
              </div>
              <input data-intensity type="range" min="0" max="100" value="50" class="mt-1 w-full accent-indigo-500" />
            </div>
          </div>
          <button data-stop class="btn-ghost mt-3 hidden w-full">${icon('x', 'h-4 w-4')} Parar efeito</button>
        </section>

        <section class="card p-5">
          <h2 class="mb-1 text-sm font-semibold">Gradiente</h2>
          <p class="mb-4 text-xs muted">O ESP interpola entre as cores ao longo da fita.</p>
          <div data-gradient></div>
          <button data-apply-gradient class="btn-primary mt-4 w-full">Aplicar gradiente</button>
        </section>
      </div>

      <aside class="card flex flex-col p-5">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="text-sm font-semibold">Cenas</h2>
          <button data-save class="btn-subtle px-2.5 py-1 text-xs">${icon('plus', 'h-4 w-4')} Salvar atual</button>
        </div>
        <div data-scenes class="flex flex-col gap-2"></div>
      </aside>
    </div>`;

  const guard = view.querySelector('[data-guard]');
  const colorMount = view.querySelector('[data-color]');
  const tonesEl = view.querySelector('[data-tones]');
  const favoritesEl = view.querySelector('[data-favorites]');
  const scenesEl = view.querySelector('[data-scenes]');
  const stopBtn = view.querySelector('[data-stop]');
  const paramsEl = view.querySelector('[data-params]');
  const speedInput = view.querySelector('[data-speed]');
  const speedVal = view.querySelector('[data-speed-val]');
  const intensityInput = view.querySelector('[data-intensity]');
  const intensityVal = view.querySelector('[data-intensity-val]');
  const intensityLabel = view.querySelector('[data-intensity-label]');
  const gradientMount = view.querySelector('[data-gradient]');

  let applyTimer = null;
  let effectTimer = null;
  let effectKey = null;

  const control = createColorControl(colorMount, {
    hasWhite: false,
    onChange: (color) => { if (effectKey) clearEffect(); renderPalette(); scheduleApply(color); }
  });

  const gradient = createGradientEditor(gradientMount);

  function selectedOnline() {
    return store.selectedMacs().filter((m) => store.isConnected(m));
  }

  function anySk6812() {
    return store.selectedClients().some((c) => c.ledType === 'sk6812');
  }

  function refreshGuard() {
    const sel = store.selection.size;
    if (!store.clients.length) {
      guard.innerHTML = `<div class="card mb-6 flex items-center gap-3 p-4 text-sm">
        ${icon('devices', 'h-5 w-5')} Nenhum dispositivo cadastrado.
        <a href="/devices" data-link class="font-medium text-indigo-600 hover:underline dark:text-indigo-400">Adicionar</a></div>`;
    } else if (!sel) {
      guard.innerHTML = `<div class="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
        Selecione ao menos um dispositivo na barra acima para controlar.</div>`;
    } else {
      guard.innerHTML = '';
    }
    control.setWhiteEnabled(anySk6812());
  }

  function scheduleApply(color) {
    const macs = store.selectedMacs();
    if (!macs.length) return;
    clearTimeout(applyTimer);
    clearTimeout(effectTimer);
    applyTimer = setTimeout(async () => {
      try { await api.sendLed({ espMacs: macs, ...color }); }
      catch (e) { toast('error', e.message); }
    }, 140);
  }

  /* ------------------------------ paleta ---------------------------- */
  // Tons: branco -> cor atual (âncora) -> preto, em 10 amostras.
  // Favoritos: 12 cores fixas. (mesma lógica da versão anterior)
  function hexToRgb(hex) {
    return { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
  }

  function pickColor(rgb) {
    clearEffect();
    control.setColor(rgb);
    renderPalette();
    scheduleApply(control.getColor());
  }

  function renderPalette() {
    const anchor = control.getColor();
    const activeHex = rgbToHex(anchor);

    tonesEl.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const rgb = i <= 4
        ? mixRgb({ r: 255, g: 255, b: 255 }, anchor, i / 4)
        : mixRgb(anchor, { r: 0, g: 0, b: 0 }, (i - 4) / 5);
      const hex = rgbToHex(rgb);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `h-6 rounded-lg p-0 border border-black/10 dark:border-white/10${hex === activeHex ? ' ring-2 ring-inset ring-white/70' : ''}`;
      btn.style.background = hex;
      btn.title = hex;
      btn.addEventListener('click', () => pickColor(rgb));
      tonesEl.appendChild(btn);
    }

    favoritesEl.innerHTML = '';
    FAVORITES.forEach((hex) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `h-6 rounded-lg p-0 border border-black/10 dark:border-white/10${hex.toUpperCase() === activeHex ? ' ring-2 ring-inset ring-white/70' : ''}`;
      btn.style.background = hex;
      btn.title = hex;
      btn.addEventListener('click', () => pickColor(hexToRgb(hex)));
      favoritesEl.appendChild(btn);
    });
  }

  /* ------------------------------ efeitos --------------------------- */
  // O efeito roda no firmware do ESP; o servidor envia um único comando.
  function setEffectUI() {
    view.querySelectorAll('[data-effect]').forEach((b) => {
      const active = b.dataset.effect === effectKey;
      b.classList.toggle('border-indigo-500', active);
      b.classList.toggle('bg-indigo-500/10', active);
    });
    stopBtn.classList.toggle('hidden', !effectKey);
    paramsEl.classList.toggle('hidden', !effectKey);
    if (effectKey) {
      intensityLabel.textContent = INTENSITY_LABELS[effectKey] || 'Intensidade';
    }
  }

  // Limpa só o destaque local (sem rede). Usado quando uma cor sólida assume
  // o controle — o próprio comando /led já interrompe o efeito no ESP.
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
      const byMac = Object.fromEntries(store.clients.map((x) => [x.espMac, x]));
      showResult(res, { actionLabel: label, clientsByMac: byMac });
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

  // Mexer num slider com efeito ativo reenvia o comando (um só, com
  // debounce) — a animação segue rodando no ESP com os novos parâmetros.
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

  view.querySelector('[data-apply-gradient]').onclick = async () => {
    const macs = selectedOnline();
    if (!macs.length) { toast('info', 'Nenhum dispositivo online selecionado'); return; }
    clearEffect();
    const stops = gradient.getStops();
    try {
      const res = await api.sendGradient({ espMacs: macs, stops, fadeMs: GRADIENT_FADE_MS });
      const byMac = Object.fromEntries(store.clients.map((c) => [c.espMac, c]));
      showResult(res, { actionLabel: 'Gradiente', clientsByMac: byMac });
    } catch (e) { toast('error', e.message); }
  };

  view.querySelectorAll('[data-effect]').forEach((b) => { b.onclick = () => startEffect(b.dataset.effect); });
  stopBtn.onclick = stopEffect;

  /* ------------------------------ cenas ----------------------------- */
  async function loadScenes() {
    let scenes = [];
    try { scenes = await api.getScenes(); } catch (e) { toast('error', e.message); }
    const byMac = Object.fromEntries(store.clients.map((c) => [c.espMac, c]));
    scenesEl.innerHTML = '';
    if (!scenes.length) {
      scenesEl.innerHTML = `<p class="py-6 text-center text-sm muted">Nenhuma cena salva ainda.<br/>Ajuste a cor e toque em “Salvar atual”.</p>`;
      return;
    }
    scenes.forEach((scene, index) => {
      scenesEl.appendChild(sceneCard(scene, {
        clientsByMac: byMac,
        canMoveUp: index > 0,
        canMoveDown: index < scenes.length - 1,

        // A cena guarda um estado por dispositivo, então quem aplica é o
        // servidor — o cliente não teria como orquestrar modos diferentes.
        onApply: async (item) => {
          try {
            const res = await api.applyScene(item.id);
            showResult(res, { actionLabel: `Cena "${item.name}"`, clientsByMac: byMac });
            // Reidrata para o controle refletir o que a cena acabou de aplicar.
            await store.refreshClients().catch(() => {});
            hydrateFromStore();
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
          const ok = await confirmModal({ title: 'Excluir cena?', message: `"${item.name}" será removida.`, confirmText: 'Excluir', danger: true });
          if (!ok) return;
          try { await api.deleteScene(item.id); toast('success', 'Cena excluída'); loadScenes(); }
          catch (e) { toast('error', e.message); }
        }
      }));
    });
  }

  // Modal simples de nome, usado por salvar e renomear.
  function promptName(title, initial = '') {
    return new Promise((resolve) => {
      const content = node(`
        <div>
          <h3 class="text-lg font-semibold">${title}</h3>
          <div class="mt-4">
            <input data-name class="field w-full" placeholder="Nome da cena" maxlength="40" />
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

  // "Salvar atual" fotografa o que os ESPs estão mostrando de verdade —
  // efeito, gradiente ou cor, cada um no seu modo — em vez de só a cor do
  // seletor. Quem sabe o estado é o servidor, então a captura é lá.
  view.querySelector('[data-save]').onclick = async () => {
    const macs = store.selectedMacs();
    if (!macs.length) { toast('info', 'Selecione um dispositivo'); return; }

    const name = await promptName('Salvar cena');
    if (!name) return;

    try {
      await api.captureScene({ name, espMacs: macs });
      toast('success', 'Cena salva');
      loadScenes();
    } catch (e) { toast('error', e.message); }
  };

  /* ------------------------------ init ------------------------------ */
  // Reidrata o controle a partir do estado central (cor e efeito ativo do
  // primeiro selecionado). Sem isto, voltar para /led com um efeito rodando
  // mostrava todos os botões apagados, embora o dashboard mostrasse certo.
  function hydrateFromStore() {
    const first = store.selectedClients()[0];
    if (!first) { effectKey = null; setEffectUI(); return; }
    const col = store.colorOf(first.espMac);
    if (col) control.setColor(col);
    effectKey = store.effectOf(first.espMac);
    setEffectUI();
    renderPalette();

    // Reidrata o editor de gradiente quando o dispositivo está mostrando um.
    const pattern = first.lastPattern;
    if (pattern?.type === 'gradient' && Array.isArray(pattern.stops)) gradient.setStops(pattern.stops);
  }

  function isFirstSelected(espMac) {
    const first = store.selectedClients()[0];
    return !!first && first.espMac === espMac;
  }

  await store.refreshClients().catch(() => {});
  refreshGuard();
  hydrateFromStore();
  renderPalette();
  loadScenes();

  const offs = [
    store.on('selection', () => { refreshGuard(); hydrateFromStore(); }),
    store.on('clients', () => { refreshGuard(); loadScenes(); }),
    store.on('status', refreshGuard),
    store.on('effect', ({ espMac }) => {
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
    control.destroy();
  };
}
