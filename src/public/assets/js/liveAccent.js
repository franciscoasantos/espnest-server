// O acento do app é a cor que a fita está mostrando agora.
//
// Escreve --led (canais separados por espaço) e --led-ink em <html>, e todo o
// resto do CSS herda dali. Vive no chrome, iniciado uma vez pelo main.js.
//
// Duas salvaguardas, sem as quais a ideia vira um problema de legibilidade:
//   - a tinta é escolhida por luminância, então um amarelo puro recebe texto
//     escuro em vez de branco;
//   - fita apagada, offline ou sem seleção cai para um cinza neutro, para o
//     app nunca ficar sem acento visível.

import { store } from './store.js';
import { isDarkColor, isOff } from './lib/color.js';

// zinc-500: o piso neutro, igual ao valor declarado em :root no index.html.
const NEUTRAL = '113 113 122';

const INK_LIGHT = '255 255 255';
const INK_DARK = '9 9 11';

// A seleção pode ter várias fitas em cores diferentes; usamos a primeira, que é
// a mesma regra que o controle de cor já segue ao se hidratar (hydrateFromStore).
function currentColor() {
  const [mac] = store.selectedMacs();
  if (!mac) return null;
  if (!store.isConnected(mac)) return null;

  const color = store.colorOf(mac);
  if (isOff(color)) return null;

  // Num efeito a cor representativa muda o tempo todo (ou nem existe, no
  // rainbow); manter o acento na última cor conhecida é mais estável do que
  // piscar junto com a animação.
  return color;
}

function apply() {
  const root = document.documentElement;
  const color = currentColor();

  if (!color) {
    root.style.setProperty('--led', NEUTRAL);
    root.style.setProperty('--led-ink', INK_LIGHT);
    return;
  }

  root.style.setProperty('--led', `${color.r | 0} ${color.g | 0} ${color.b | 0}`);
  root.style.setProperty('--led-ink', isDarkColor(color) ? INK_LIGHT : INK_DARK);
}

export function initLiveAccent() {
  apply();
  const offs = [
    store.on('state', apply),
    store.on('effect', apply),
    store.on('selection', apply),
    store.on('status', apply),
    store.on('clients', apply)
  ];
  return () => offs.forEach((off) => off());
}
