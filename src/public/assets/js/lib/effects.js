// Catálogo único dos efeitos que rodam no firmware.
// Antes havia três fontes de verdade para os mesmos 8 efeitos: o catálogo rico
// em views/led.js, uma lista de chaves cruas na antiga views/routines.js (que exibia
// "fire" no select) e um mapa de rótulos copiado à mão em views/dashboard.js.

export const EFFECTS = [
  { key: 'breathing', label: 'Respiração', desc: 'Pulsa o brilho suavemente', usesColor: true },
  { key: 'rainbow', label: 'Arco-íris', desc: 'Percorre todas as cores', usesColor: false },
  { key: 'fade', label: 'Transição', desc: 'Alterna entre cores', usesColor: false },
  { key: 'fire', label: 'Fogo', desc: 'Chama subindo pela fita', usesColor: false },
  { key: 'comet', label: 'Cometa', desc: 'Cabeça com cauda deslizando', usesColor: true },
  { key: 'twinkle', label: 'Estrelas', desc: 'Pontos piscando ao acaso', usesColor: true },
  { key: 'wave', label: 'Onda', desc: 'Cristas indo e voltando', usesColor: true },
  { key: 'wipe', label: 'Preenchimento', desc: 'Preenche e recomeça', usesColor: true }
];

const BY_KEY = Object.fromEntries(EFFECTS.map((e) => [e.key, e]));

export function effectByKey(key) {
  return BY_KEY[key] || null;
}

// Rótulo amigável, com a própria chave como último recurso — assim um efeito
// novo no firmware aparece legível mesmo antes de entrar no catálogo.
export function effectLabel(key) {
  return BY_KEY[key]?.label || key || '';
}

export function effectUsesColor(key) {
  return BY_KEY[key]?.usesColor !== false;
}

// O significado da intensidade muda por efeito; o rótulo do slider acompanha.
const INTENSITY_LABELS = {
  breathing: 'Profundidade',
  fire: 'Altura da chama',
  comet: 'Tamanho da cauda',
  twinkle: 'Densidade',
  wave: 'Número de cristas',
  wipe: 'Suavidade da borda'
};

export function intensityLabel(key) {
  return INTENSITY_LABELS[key] || 'Intensidade';
}
