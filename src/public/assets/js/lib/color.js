// Conversões de cor compartilhadas. Antes existiam quatro cópias de hexToRgb e
// três de rgbToHex espalhadas entre views e componentes; esta é a única fonte.

const BLACK = { r: 0, g: 0, b: 0 };

// Aceita "#RRGGBB" ou "RRGGBB". Devolve `fallback` quando o hex não presta —
// o seletor de cor passa null para rejeitar o que o usuário digitou, o resto
// passa preto para nunca quebrar o render.
export function hexToRgb(hex, fallback = null) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return fallback;
  const int = parseInt(m[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

export function rgbToHex({ r, g, b }) {
  const p = (n) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`.toUpperCase();
}

export function rgbCss({ r, g, b }) {
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// O LED branco do SK6812 soma luz por cima do RGB. Qualquer preview que
// ignore `w` mostra a fita mais escura do que ela está — e o slider de
// branco parece não fazer nada.
export function rgbwCss({ r, g, b, w = 0 }) {
  const mix = (c) => Math.min(255, (c | 0) + (w | 0));
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

// Luminância relativa (WCAG). Usada para decidir se a tinta sobre uma cor da
// fita deve ser clara ou escura — sem isso um amarelo puro recebe texto branco.
export function luminance({ r, g, b }) {
  const ch = (v) => {
    const s = (v | 0) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function isDarkColor(rgb) {
  return luminance(rgb) < 0.45;
}

export function isOff(color) {
  if (!color) return true;
  return !(color.r || color.g || color.b || color.w);
}

export { BLACK };
