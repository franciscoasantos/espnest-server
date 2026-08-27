// Matemática do gradiente, sem DOM.
//
// Fica separada do editor porque é a parte que dá para errar em silêncio: uma
// interpolação torta só aparece na fita, e não numa exceção. Aqui ela é
// testável isoladamente.
//
// Contrato de um stop: { pos: 0-255, r, g, b }. O firmware exige a lista em
// ordem crescente de pos — a busca por pixel assume isso.

import { rgbCss } from './color.js';

export const MAX_STOPS = 8;
export const MIN_STOPS = 2;

export const clampPos = (v) => Math.max(0, Math.min(255, Math.round(v)));
export const toPercent = (pos) => (pos / 255) * 100;

export function sortStops(stops) {
  return stops.sort((a, b) => a.pos - b.pos);
}

export function gradientCss(stops) {
  const parts = stops
    .slice()
    .sort((a, b) => a.pos - b.pos)
    .map((s) => `${rgbCss(s)} ${toPercent(s.pos).toFixed(2)}%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

// A cor que o gradiente já mostra numa posição. Inserir um stop com esta cor
// não muda nada visualmente — que é o que se espera de "adicionar um ponto".
export function colorAt(stops, pos) {
  const sorted = stops.slice().sort((a, b) => a.pos - b.pos);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (pos <= first.pos) return { r: first.r, g: first.g, b: first.b };
  if (pos >= last.pos) return { r: last.r, g: last.g, b: last.b };

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (pos >= a.pos && pos <= b.pos) {
      // Stops empilhados na mesma posição fazem um corte seco; sem o guarda
      // isto seria uma divisão por zero.
      const span = b.pos - a.pos || 1;
      const f = (pos - a.pos) / span;
      return {
        r: Math.round(a.r + (b.r - a.r) * f),
        g: Math.round(a.g + (b.g - a.g) * f),
        b: Math.round(a.b + (b.b - a.b) * f)
      };
    }
  }
  return { r: last.r, g: last.g, b: last.b };
}

// Normaliza o que vem do servidor (ou de uma cena) para o formato do editor.
export function normalizeStops(next) {
  if (!Array.isArray(next) || next.length < MIN_STOPS) return null;
  const stops = next.slice(0, MAX_STOPS).map((s) => ({
    pos: clampPos(s.pos | 0),
    r: s.r | 0,
    g: s.g | 0,
    b: s.b | 0
  }));
  return sortStops(stops);
}
