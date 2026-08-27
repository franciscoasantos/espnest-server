// O palco: a fita desenhada em 1D, do jeito que ela está agora.
//
// O SSE já manda tudo que é preciso — utils/sse.js envia `pattern` junto da cor
// representativa, e o pattern é solid | gradient (stops) | segments (índices de
// LED). Os três viram um linear-gradient CSS.
//
// Generaliza o previewStyle que existia só para a miniatura de cenas
// (components/sceneCard.js), e de quebra torna **segmentos visíveis** mesmo sem
// existir um editor de segmentos: o palco desenha o que a fita está mostrando.

import { store } from '../store.js';
import { rgbCss, isOff } from '../lib/color.js';
import { gradientCss } from '../lib/gradient.js';

const RAINBOW = 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)';

// Reexportado para os testes; a implementação é compartilhada com o editor.
export { gradientCss as gradientFromStops } from '../lib/gradient.js';

// Segmentos são índices de LED, então precisam do comprimento da fita para
// virar porcentagem. Pixel fora de todo segmento fica apagado — o mesmo que o
// firmware faz —, então os vãos entram como transparente sobre o fundo escuro.
export function gradientFromSegments(segments, ledCount) {
  const total = Number.isInteger(ledCount) && ledCount > 0
    ? ledCount
    : Math.max(...segments.map((s) => s.to + 1), 1);

  const pct = (i) => Math.max(0, Math.min(100, (i / total) * 100));
  const parts = [];
  let cursor = 0;

  segments
    .slice()
    .sort((a, b) => a.from - b.from)
    .forEach((seg) => {
      const from = pct(seg.from);
      const to = pct(seg.to + 1);
      if (from > cursor) parts.push(`transparent ${cursor}%`, `transparent ${from}%`);
      parts.push(`${rgbCss(seg)} ${from}%`, `${rgbCss(seg)} ${to}%`);
      cursor = to;
    });

  if (cursor < 100) parts.push(`transparent ${cursor}%`, 'transparent 100%');
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

// Descreve o que a fita mostra: { background, lit, effect, color }.
// `lit` = há luz acesa; `color` é a cor representativa (alimenta --led).
export function describeStrip(client) {
  const mac = client.espMac;
  const online = store.isConnected(mac);
  const effect = store.effectOf(mac);
  const color = store.colorOf(mac);

  if (!online) return { background: null, lit: false, effect: null, color: null, label: 'Offline' };

  if (effect) {
    const background = effect === 'rainbow'
      ? RAINBOW
      : (color && !isOff(color) ? rgbCss(color) : null);
    return { background, lit: !!background, effect, color, label: background ? '' : 'Apagada' };
  }

  const pattern = client.lastPattern;
  if (pattern && pattern.type === 'gradient' && Array.isArray(pattern.stops) && pattern.stops.length) {
    return { background: gradientCss(pattern.stops), lit: true, effect: null, color, label: '' };
  }
  if (pattern && pattern.type === 'segments' && Array.isArray(pattern.segments) && pattern.segments.length) {
    return {
      background: gradientFromSegments(pattern.segments, client.ledCount),
      lit: true,
      effect: null,
      color,
      label: ''
    };
  }

  if (isOff(color)) return { background: null, lit: false, effect: null, color: null, label: 'Apagada' };
  return { background: rgbCss(color), lit: true, effect: null, color, label: '' };
}

export function stageClass(strip, size = 'lg') {
  const base = `stage stage-${size}`;
  if (!strip.lit) return `${base} stage-off`;
  return `${base} stage-lit${strip.effect ? ' stage-effect' : ''}`;
}

// --led acompanha o palco para que o card inteiro (halo, botões) herde a cor.
export function ledVar(color) {
  if (!color) return '';
  return `--led: ${color.r | 0} ${color.g | 0} ${color.b | 0}`;
}

// Apagada ou offline, o palco não pode ser só uma caixa tracejada vazia: sem
// texto ele lê como erro de carregamento, e não como "a fita está apagada".
function labelHtml(strip) {
  if (!strip.label) return '';
  return `<span data-stage-label class="absolute inset-0 flex items-center justify-center text-xs muted">${strip.label}</span>`;
}

// showLabel: onde o palco já vem acompanhado de uma linha de status (o cartão
// do Início), o rótulo interno seria a mesma informação duas vezes.
export function stageHtml(client, { size = 'lg', extra = '', showLabel = true } = {}) {
  const strip = describeStrip(client);
  const style = [strip.background ? `background:${strip.background}` : '', ledVar(strip.color)]
    .filter(Boolean)
    .join(';');
  // `extra` fica no dataset para o patch conseguir recompor a classe sem
  // perder o que o chamador acrescentou.
  return `<div data-stage="${client.espMac}" data-extra="${extra}" data-label="${showLabel ? '1' : '0'}" class="${stageClass(strip, size)} ${extra}" style="${style}">${showLabel ? labelHtml(strip) : ''}</div>`;
}

// Atualiza o palco sem recriar o nó: é o que permite o SSE chegar a cada frame
// sem remontar a árvore inteira (e sem perder foco ou scroll).
export function patchStage(el, client, size = 'lg') {
  if (!el) return;
  const strip = describeStrip(client);
  el.className = `${stageClass(strip, size)} ${el.dataset.extra || ''}`.trim();
  el.style.background = strip.background || '';
  el.innerHTML = el.dataset.label === '0' ? '' : labelHtml(strip);
  if (strip.color) el.style.setProperty('--led', `${strip.color.r | 0} ${strip.color.g | 0} ${strip.color.b | 0}`);
  else el.style.removeProperty('--led');
}
