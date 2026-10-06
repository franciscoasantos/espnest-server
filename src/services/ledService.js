// Camada de comandos de LED, independente de HTTP.
//
// Nasceu de dentro das rotas: as rotinas agendadas, o despertador e as
// notificações precisam mandar cor/efeito/padrão exatamente como o POST manda,
// incluindo persistência e SSE. Duplicar isso nas duas pontas ia divergir.

const { getClientByMac, setLastLedColor, setLastPattern } = require('../data/clientsStore');
const { sendCommandToESP } = require('../websocket/espTunnel');
const { notifyClientState, notifyClientEffect } = require('../utils/sse');

// Efeito ativo por dispositivo (em memória). O ESP roda o efeito no firmware e
// não reporta estado de volta, então o servidor é a fonte da verdade aqui.
//
// Guarda também cor base e parâmetros: sem eles, capturar uma cena com um
// fogo em intensidade 70 e reaplicá-la traria o fogo no padrão.
const activeEffects = new Map(); // espMac -> { effect, color, speed, intensity }

// O que a fita mostrava antes de ser apagada, para o botão de liga/desliga
// conseguir devolvê-la ao mesmo estado. Fica no servidor, e não no navegador,
// porque a fita continua apagada depois de um F5 — e porque apagar pode vir de
// qualquer lugar (o botão, uma rotina, o seletor de cor em preto).
const beforeOff = new Map(); // espMac -> snapshot

function setActiveEffect(espMac, effect, details = {}) {
  const next = (!effect || effect === 'none') ? null : effect;
  const previous = activeEffects.get(espMac)?.effect || null;

  if (next === null) {
    activeEffects.delete(espMac);
  } else {
    activeEffects.set(espMac, { effect: next, ...details });
  }

  // Só notifica quando o efeito realmente muda. Toda cor sólida passa por aqui
  // para interromper efeito, e um arraste no seletor manda ~7 cores por
  // segundo — sem esta guarda, viravam 7 eventos SSE/s re-renderizando a barra
  // de dispositivos e o dashboard em todos os navegadores abertos.
  if (previous !== next) {
    notifyClientEffect(espMac, next);
  }
}

// Só o nome — é o que a API e o SSE expõem.
function getActiveEffect(espMac) {
  return activeEffects.get(espMac)?.effect || null;
}

// Estado completo, para quem precisa reproduzir o efeito depois (cenas).
function getActiveEffectState(espMac) {
  return activeEffects.get(espMac) || null;
}

function buildResultSummary(action, results) {
  const okCount = results.filter((item) => item.ok).length;
  return {
    status: okCount > 0 ? 'ok' : 'error',
    action,
    okCount,
    failCount: results.length - okCount,
    results
  };
}

// Executa uma operação por dispositivo em paralelo, sempre resolvendo com um
// item de resultado — nunca rejeitando, para um ESP offline não derrubar os
// outros do lote.
async function forEachTarget(espMacs, action, operation) {
  const results = await Promise.all(espMacs.map(async (espMac) => {
    const client = getClientByMac(espMac);
    if (!client) {
      return { espMac, ok: false, error: 'Cliente não encontrado' };
    }

    try {
      return await operation(espMac, client);
    } catch (error) {
      return { espMac, ok: false, error: error.message };
    }
  }));

  return buildResultSummary(action, results);
}

// Qual branco descrever como o estado atual da fita depois de um comando de
// cor. O ACK nem sempre ecoa `w`, e um comando sem `w` deixa o branco como
// está no firmware — nos dois casos o valor anterior é o certo. Sem isto o
// servidor passava a achar que o branco era 0 e o apagava no comando seguinte.
function resolveWhite(ackW, requestedW, previousW) {
  if (Number.isInteger(ackW)) return ackW;
  if (Number.isInteger(requestedW)) return requestedW;
  return Number.isInteger(previousW) ? previousW : null;
}

// Cor sólida. `w` só vai para fitas SK6812; `fadeMs` faz o firmware interpolar.
function applyColor(espMacs, { r, g, b, w = null, fadeMs = null }) {
  return forEachTarget(espMacs, 'led', async (espMac, client) => {
    // Antes de sobrescrever: se isto está apagando, guarda o que havia.
    rememberBeforeOff(espMac, { r, g, b, w });

    const command = { action: 'led', r, g, b };
    if (client.ledType === 'sk6812' && w !== null) command.w = w;
    if (fadeMs) command.fadeMs = fadeMs;

    const response = await sendCommandToESP(espMac, command);
    if (response?.status === 'error') {
      return { espMac, ok: false, error: response.error || 'Falha na comunicação com ESP' };
    }

    // Usa valores confirmados pelo ACK (ou fallback para os do request)
    const confirmed = {
      r: typeof response?.r === 'number' ? response.r : r,
      g: typeof response?.g === 'number' ? response.g : g,
      b: typeof response?.b === 'number' ? response.b : b
    };
    const confirmedW = resolveWhite(response?.w, w, client.lastLedColor?.w);
    if (confirmedW !== null) confirmed.w = confirmedW;

    setLastLedColor(espMac, confirmed);
    setActiveEffect(espMac, 'none'); // cor sólida interrompe efeito (espelha o firmware)
    notifyClientState(espMac, confirmed, { type: 'solid', color: confirmed });

    return { espMac, ok: true, response };
  });
}

// Padrão estático (gradiente ou segmentos). `build(client)` devolve o comando,
// o padrão a persistir e a cor representativa.
function applyPattern(espMacs, action, build, fadeMs = null) {
  return forEachTarget(espMacs, action, async (espMac, client) => {
    const { command, pattern, representative } = build(client);
    if (fadeMs) command.fadeMs = fadeMs;

    const response = await sendCommandToESP(espMac, command);
    if (response?.status === 'error') {
      return { espMac, ok: false, error: response.error || 'Falha na comunicação com ESP' };
    }

    setLastPattern(espMac, pattern, representative);
    setActiveEffect(espMac, 'none');
    notifyClientState(espMac, { ...representative, w: representative.w || 0 }, pattern);

    return { espMac, ok: true, response };
  });
}

// Um único comando: a animação roda no firmware. 'none' interrompe.
function applyEffect(espMacs, { effect, color = null, speed = null, intensity = null }) {
  return forEachTarget(espMacs, 'effect', async (espMac) => {
    const command = { action: 'effect', effect };
    if (color) { command.r = color.r; command.g = color.g; command.b = color.b; }
    if (speed !== null) command.speed = speed;
    if (intensity !== null) command.intensity = intensity;

    const response = await sendCommandToESP(espMac, command);
    if (response?.status === 'error') {
      return { espMac, ok: false, error: response.error || 'Falha na comunicação com ESP' };
    }

    setActiveEffect(espMac, effect, { color, speed, intensity });
    return { espMac, ok: true, response };
  });
}

function sendWol(espMacs, targetMac) {
  return forEachTarget(espMacs, 'wol', async (espMac) => {
    if (!targetMac) {
      return { espMac, ok: false, error: 'MAC alvo não informado' };
    }

    const response = await sendCommandToESP(espMac, { action: 'wol', mac: targetMac });
    if (response?.status === 'error') {
      return { espMac, ok: false, error: response.error || 'Falha na comunicação com ESP' };
    }

    return { espMac, ok: true, response };
  });
}

// Estado atual de um dispositivo, para quem precisa restaurar depois de tomar
// a fita emprestada (notificação, ritual de WoL).
function snapshot(espMac) {
  const client = getClientByMac(espMac);
  if (!client) return null;

  // Guarda velocidade e intensidade junto: sem elas, restaurar um efeito o
  // devolvia nos valores padrão, e não como o usuário tinha deixado.
  const effectState = getActiveEffectState(espMac);

  return {
    espMac,
    effect: effectState?.effect || null,
    effectDetails: effectState
      ? { color: effectState.color, speed: effectState.speed, intensity: effectState.intensity }
      : null,
    pattern: client.lastPattern || (client.lastLedColor
      ? { type: 'solid', color: client.lastLedColor }
      : null)
  };
}

// A fita está mostrando alguma coisa? Preto puro não conta como estado a
// restaurar, senão o liga/desliga acenderia preto.
function isLit(state) {
  if (!state) return false;
  if (state.effect) return true;

  const pattern = state.pattern;
  if (!pattern) return false;
  if (pattern.type === 'gradient') return Array.isArray(pattern.stops) && pattern.stops.length > 0;
  if (pattern.type === 'segments') return Array.isArray(pattern.segments) && pattern.segments.length > 0;

  const c = pattern.color || {};
  return !!(c.r || c.g || c.b || c.w);
}

// Chamado sempre que uma cor sólida é aplicada. Preto guarda o estado atual;
// qualquer outra cor descarta a memória, porque ela virou o estado corrente.
function rememberBeforeOff(espMac, { r, g, b, w }) {
  if (r || g || b || w) { beforeOff.delete(espMac); return; }
  const current = snapshot(espMac);
  if (isLit(current)) beforeOff.set(espMac, current);
}

// Devolve a fita ao estado capturado por snapshot().
async function restore(state, { fadeMs = 400 } = {}) {
  if (!state) return;
  const macs = [state.espMac];

  if (state.effect) {
    await applyEffect(macs, { effect: state.effect, ...(state.effectDetails || {}) });
    return;
  }

  const pattern = state.pattern;
  if (!pattern) return;

  if (pattern.type === 'gradient') {
    await applyPattern(macs, 'gradient', () => ({
      command: { action: 'gradient', stops: pattern.stops },
      pattern,
      representative: { r: pattern.stops[0].r, g: pattern.stops[0].g, b: pattern.stops[0].b }
    }), fadeMs);
    return;
  }

  if (pattern.type === 'segments') {
    await applyPattern(macs, 'segments', () => ({
      command: { action: 'segments', segments: pattern.segments },
      pattern,
      representative: { r: pattern.segments[0].r, g: pattern.segments[0].g, b: pattern.segments[0].b }
    }), fadeMs);
    return;
  }

  await applyColor(macs, { ...pattern.color, fadeMs });
}

// Liga/desliga: apaga se estiver acesa, devolve ao estado anterior se estiver
// apagada. Reaproveita snapshot/restore, então cobre cor, gradiente, segmentos
// e efeito — e não só cor sólida.
async function toggle(espMacs) {
  const results = await Promise.all(espMacs.map(async (espMac) => {
    const client = getClientByMac(espMac);
    if (!client) return { espMac, ok: false, error: 'Cliente não encontrado' };

    try {
      if (isLit(snapshot(espMac))) {
        // applyColor cuida de guardar a memória por dentro.
        const summary = await applyColor([espMac], { r: 0, g: 0, b: 0, w: 0 });
        return summary.results[0];
      }

      const previous = beforeOff.get(espMac);
      if (!previous) {
        return { espMac, ok: false, error: 'Nada para restaurar: a fita não tem estado anterior' };
      }

      await restore(previous);
      beforeOff.delete(espMac);
      return { espMac, ok: true };
    } catch (error) {
      return { espMac, ok: false, error: error.message };
    }
  }));

  return buildResultSummary('toggle', results);
}

module.exports = {
  resolveWhite,
  setActiveEffect,
  getActiveEffect,
  getActiveEffectState,
  buildResultSummary,
  applyColor,
  applyPattern,
  applyEffect,
  sendWol,
  snapshot,
  restore,
  toggle,
  isLit
};
