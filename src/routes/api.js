const { appShell } = require('../views');
const { normalizeMac, getClients, upsertClient } = require('../data/clientsStore');
const { getWolTargets, upsertWolTarget } = require('../data/wolTargetsStore');
const {
  getScenes,
  getSceneById,
  saveScene,
  renameScene,
  reorderScenes,
  deleteScene
} = require('../data/scenesStore');
const {
  isESPConnected,
  getConnectedClients,
  getConnectedClientDetails,
  getFirmwareVersion
} = require('../websocket/espTunnel');
const {
  getActiveEffect,
  applyColor,
  applyPattern,
  applyEffect,
  sendWol,
  toggle
} = require('../services/ledService');
const { addClient, removeClient } = require('../utils/sse');
const { saveConfig: saveAwayConfig } = require('../data/awayStore');
const awayMode = require('../services/awayMode');
const { applyScene, captureDevices } = require('../services/sceneService');
const wakeRitual = require('../services/wakeRitual');
const { pulse } = require('../services/notify');
const { getSchedules, upsertSchedule, deleteSchedule } = require('../data/schedulesStore');
const { startUpdate } = require('../services/otaService');
const { describeToday, runAction } = require('../services/scheduler');
const sunrise = require('../services/sunrise');

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';

    req.on('data', (chunk) => {
      body += chunk;
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (_e) {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function getClientsWithStatus() {
  const connected = new Set(getConnectedClients());
  return getClients().map((client) => ({
    ...client,
    connected: connected.has(client.espMac),
    activeEffect: getActiveEffect(client.espMac),
    // A versão viva do handshake ganha da persistida: depois de um OTA o
    // arquivo pode estar um passo atrás até o próximo save com debounce.
    firmwareVersion: getFirmwareVersion(client.espMac) || client.firmwareVersion || null
  }));
}

// Todas as rotas de página servem o mesmo shell SPA; o roteador no cliente
// renderiza a view correta a partir do pathname.
function handleAppShell(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
  res.end(appShell);
}

function handleStatus(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  const connectedClients = getConnectedClients();
  const initialStatus = JSON.stringify({
    connected: connectedClients.length > 0,
    connectedClients
  });

  res.write(`event: status\ndata: ${initialStatus}\n\n`);
  addClient(res);

  req.on('close', () => {
    removeClient(res);
  });
}

function handleGetClients(_req, res) {
  return sendJson(res, 200, { clients: getClientsWithStatus() });
}

function handleGetDiscoveredClients(_req, res) {
  const registered = new Set(getClients().map((client) => client.espMac));
  const discovered = getConnectedClientDetails().filter((item) => !registered.has(item.espMac));
  return sendJson(res, 200, { discovered });
}

function handleGetWolTargets(_req, res) {
  return sendJson(res, 200, { targets: getWolTargets() });
}

async function handleUpsertWolTarget(req, res) {
  try {
    const body = await parseJsonBody(req);
    const saved = upsertWolTarget(body);
    return sendJson(res, 200, { target: saved });
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

async function handleUpsertClient(req, res) {
  try {
    const body = await parseJsonBody(req);
    const saved = upsertClient(body);
    return sendJson(res, 200, { client: { ...saved, connected: isESPConnected(saved.espMac) } });
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

function parseRgb(body) {
  const { r, g, b } = body;
  const values = [r, g, b];
  const valid = values.every((value) => Number.isInteger(value) && value >= 0 && value <= 255);

  if (!valid) {
    throw new Error('RGB values must be integers between 0 and 255');
  }

  return { r, g, b };
}

function parseWhite(body) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, 'w')) {
    return null;
  }

  const white = body?.w;
  if (!Number.isInteger(white) || white < 0 || white > 255) {
    throw new Error('W must be an integer between 0 and 255');
  }

  return white;
}

// Duração da transição no firmware. Ausente ou 0 = aplica na hora, que é o
// que o seletor de cor manda (ele já envia uma cor a cada 140 ms).
function parseFadeMs(body) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, 'fadeMs')) {
    return null;
  }

  const fadeMs = body?.fadeMs;
  if (!Number.isInteger(fadeMs) || fadeMs < 0 || fadeMs > 60000) {
    throw new Error('fadeMs deve ser um inteiro entre 0 e 60000');
  }

  return fadeMs;
}

function parseEspTargets(body) {
  const raw = Array.isArray(body?.espMacs)
    ? body.espMacs
    : (body?.espMac ? [body.espMac] : []);

  const targets = [...new Set(raw
    .map((value) => normalizeMac(value))
    .filter(Boolean))];

  if (!targets.length) {
    throw new Error('espMac/espMacs é obrigatório');
  }

  return targets;
}

async function handleWOL(req, res) {
  try {
    const body = await parseJsonBody(req);
    const targets = parseEspTargets(body);

    const explicitMac = body?.mac ? normalizeMac(body.mac) : null;
    if (body?.mac && !explicitMac) {
      return sendJson(res, 400, { error: 'MAC alvo inválido' });
    }

    const targetMacFromList = body?.targetMac ? normalizeMac(body.targetMac) : null;
    if (body?.targetMac && !targetMacFromList) {
      return sendJson(res, 400, { error: 'MAC alvo inválido' });
    }

    const targetMac = explicitMac || targetMacFromList;
    return sendJson(res, 200, await sendWol(targets, targetMac));
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

function handleGetScenes(_req, res) {
  return sendJson(res, 200, { scenes: getScenes() });
}

async function handleSaveScene(req, res) {
  try {
    const body = await parseJsonBody(req);
    const scene = saveScene(body);
    return sendJson(res, 200, { scene });
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

function handleDeleteScene(req, res, id) {
  try {
    deleteScene(id);
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return sendJson(res, 404, { error: error.message });
  }
}

async function handleLED(req, res) {
  try {
    const body = await parseJsonBody(req);
    const targets = parseEspTargets(body);

    const color = parseRgb(body);
    const white = parseWhite(body);
    const fadeMs = parseFadeMs(body);

    return sendJson(res, 200, await applyColor(targets, { ...color, w: white, fadeMs }));
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

// Cor de um stop/segmento: r/g/b obrigatórios, w opcional.
function parsePatternColor(entry, label) {
  const { r, g, b } = entry || {};
  const valid = [r, g, b].every((value) => Number.isInteger(value) && value >= 0 && value <= 255);
  if (!valid) {
    throw new Error(`${label}: r/g/b devem ser inteiros entre 0 e 255`);
  }

  const color = { r, g, b };
  if (Object.prototype.hasOwnProperty.call(entry, 'w')) {
    if (!Number.isInteger(entry.w) || entry.w < 0 || entry.w > 255) {
      throw new Error(`${label}: w deve ser um inteiro entre 0 e 255`);
    }
    color.w = entry.w;
  }
  return color;
}

const MAX_STOPS = 8;
const MAX_SEGMENTS = 8;

// Gradiente por stops (pos 0-255). O firmware interpola, então o payload não
// cresce com o tamanho da fita — importante para os 589 LEDs da sala.
function parseStops(body) {
  const stops = body?.stops;
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new Error('stops deve ser um array com pelo menos 2 itens');
  }
  if (stops.length > MAX_STOPS) {
    throw new Error(`stops aceita no máximo ${MAX_STOPS} itens`);
  }

  let previous = -1;
  return stops.map((stop, index) => {
    const pos = stop?.pos;
    if (!Number.isInteger(pos) || pos < 0 || pos > 255) {
      throw new Error(`stop ${index}: pos deve ser um inteiro entre 0 e 255`);
    }
    if (pos < previous) {
      throw new Error('stops devem vir em ordem crescente de pos');
    }
    previous = pos;
    return { pos, ...parsePatternColor(stop, `stop ${index}`) };
  });
}

// Trechos da fita com cores próprias; pixel fora de todos fica apagado.
function parseSegments(body, ledCount) {
  const segments = body?.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new Error('segments deve ser um array com pelo menos 1 item');
  }
  if (segments.length > MAX_SEGMENTS) {
    throw new Error(`segments aceita no máximo ${MAX_SEGMENTS} itens`);
  }

  return segments.map((segment, index) => {
    const { from, to } = segment || {};
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from) {
      throw new Error(`segmento ${index}: from/to inválidos`);
    }
    return { from, to, ...parsePatternColor(segment, `segmento ${index}`) };
  });
}

function assertSegmentsFit(segments, ledCount) {
  if (!Number.isInteger(ledCount)) return;
  segments.forEach((segment, index) => {
    if (segment.to >= ledCount) {
      throw new Error(`segmento ${index}: to (${segment.to}) fora da fita de ${ledCount} LEDs`);
    }
  });
}

// Envia um padrão estático (gradiente ou segmentos). Como a cor sólida, ele
// interrompe qualquer efeito ativo no dispositivo.
async function sendPattern(req, res, action, parsePayload, buildCommand) {
  try {
    const body = await parseJsonBody(req);
    const targets = parseEspTargets(body);
    const fadeMs = parseFadeMs(body);
    // Validação do payload acontece uma vez, fora do laço: erro de formato é
    // 422 da requisição inteira, não uma falha por dispositivo.
    const parsed = parsePayload(body);

    const summary = await applyPattern(targets, action, (client) => buildCommand(parsed, client), fadeMs);
    return sendJson(res, 200, summary);
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

function handleGradient(req, res) {
  return sendPattern(req, res, 'gradient', parseStops, (stops) => ({
    command: { action: 'gradient', stops },
    pattern: { type: 'gradient', stops },
    representative: { r: stops[0].r, g: stops[0].g, b: stops[0].b }
  }));
}

function handleSegments(req, res) {
  // O formato é validado uma vez; o limite de índice depende do ledCount de
  // cada ESP, então esse fica no laço e vira erro daquele dispositivo.
  return sendPattern(req, res, 'segments', (body) => parseSegments(body, null), (segments, client) => {
    assertSegmentsFit(segments, client.ledCount);
    return {
      command: { action: 'segments', segments },
      pattern: { type: 'segments', segments },
      representative: { r: segments[0].r, g: segments[0].g, b: segments[0].b }
    };
  });
}
// Os efeitos rodam no firmware; esta lista tem que acompanhar o enum de
// led_controller.h e o dispatch em ws_protocol_commands.c.
const ALLOWED_EFFECTS = new Set([
  'breathing', 'rainbow', 'fade', 'fire', 'comet', 'twinkle', 'wave', 'wipe', 'none'
]);

// Parâmetro 0-100 opcional. Ausente = o firmware usa o padrão do efeito,
// que varia (profundidade no breathing, densidade no twinkle, etc).
function parseEffectParam(body, key) {
  if (!Object.prototype.hasOwnProperty.call(body || {}, key)) {
    return null;
  }

  const value = body?.[key];
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error(`${key} deve ser um inteiro entre 0 e 100`);
  }

  return value;
}

// Envia UM único comando de efeito ao ESP. A animação roda no firmware;
// o servidor não fica mandando frames. effect 'none' interrompe o efeito.
// Liga/desliga por dispositivo. Quem decide o que fazer é o servidor, porque só
// ele sabe o que a fita mostrava antes de apagar.
async function handleToggle(req, res) {
  try {
    const body = await parseJsonBody(req);
    const targets = parseEspTargets(body);
    return sendJson(res, 200, await toggle(targets));
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

async function handleEffect(req, res) {
  try {
    const body = await parseJsonBody(req);
    const targets = parseEspTargets(body);

    const effect = typeof body?.effect === 'string' ? body.effect.trim().toLowerCase() : '';
    if (!ALLOWED_EFFECTS.has(effect)) {
      return sendJson(res, 422, { error: 'effect inválido' });
    }

    // Cor base opcional (usada por efeitos como breathing/fade)
    let color = null;
    if (['r', 'g', 'b'].every((k) => Object.prototype.hasOwnProperty.call(body || {}, k))) {
      color = parseRgb(body);
    }

    const speed = parseEffectParam(body, 'speed');
    const intensity = parseEffectParam(body, 'intensity');

    return sendJson(res, 200, await applyEffect(targets, { effect, color, speed, intensity }));
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

// Rampa do nascer do sol sob demanda (o agendador usa o mesmo serviço).
async function handleSunrise(req, res) {
  try {
    const body = await parseJsonBody(req);
    const targets = parseEspTargets(body);

    if (body?.stop) {
      const stopped = targets.filter((espMac) => sunrise.stop(espMac));
      return sendJson(res, 200, { status: 'ok', action: 'sunrise', stopped });
    }

    const durationMin = Number.isInteger(body?.durationMin) ? body.durationMin : 20;
    if (durationMin < 1 || durationMin > 120) {
      return sendJson(res, 422, { error: 'durationMin deve estar entre 1 e 120' });
    }

    const started = targets.map((espMac) => ({ espMac, ...sunrise.start(espMac, durationMin) }));
    return sendJson(res, 200, { status: 'ok', action: 'sunrise', started });
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

function handleGetSchedules(_req, res) {
  // Junta o horário calculado de hoje: para gatilhos solares o cadastro só
  // guarda o deslocamento, então a UI não teria como mostrar a hora.
  const timing = new Map(describeToday().map((item) => [item.id, item]));
  const schedules = getSchedules().map((schedule) => ({
    ...schedule,
    todayMinutes: timing.get(schedule.id)?.minutes ?? null,
    ranToday: timing.get(schedule.id)?.ranToday ?? false
  }));
  return sendJson(res, 200, { schedules });
}

async function handleUpsertSchedule(req, res) {
  try {
    const body = await parseJsonBody(req);
    return sendJson(res, 200, { schedule: upsertSchedule(body) });
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

function handleDeleteSchedule(req, res, id) {
  try {
    deleteSchedule(id);
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return sendJson(res, 404, { error: error.message });
  }
}

// Dispara a rotina na hora, sem esperar o gatilho. Útil para conferir se o
// que foi cadastrado faz o que se espera.
async function handleRunSchedule(req, res, id) {
  const schedule = getSchedules().find((item) => item.id === id);
  if (!schedule) {
    return sendJson(res, 404, { error: 'Rotina não encontrada' });
  }

  try {
    const result = await runAction(schedule);
    return sendJson(res, 200, result || { status: 'ok' });
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

// Pisca uma cor e devolve a fita ao que estava.
async function handleNotify(req, res) {
  try {
    const body = await parseJsonBody(req);
    const targets = parseEspTargets(body);
    const color = parseRgb(body?.color || body);

    const times = Number.isInteger(body?.times) ? body.times : 3;
    if (times < 1 || times > 10) {
      return sendJson(res, 422, { error: 'times deve estar entre 1 e 10' });
    }

    const result = await pulse(targets, color, { times, restoreAfter: body?.restore !== false });
    return sendJson(res, 200, { status: 'ok', action: 'notify', ...result });
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

// WoL + fita como barra de progresso enquanto sonda o alvo.
async function handleWakeRitual(req, res) {
  try {
    const body = await parseJsonBody(req);
    const targets = parseEspTargets(body);

    const targetMac = body?.targetMac ? normalizeMac(body.targetMac) : null;
    if (!targetMac) {
      return sendJson(res, 422, { error: 'targetMac é obrigatório' });
    }

    const host = typeof body?.host === 'string' ? body.host.trim() : null;
    const timeoutMs = Number.isInteger(body?.timeoutMs) ? body.timeoutMs : 90000;
    if (timeoutMs < 5000 || timeoutMs > 600000) {
      return sendJson(res, 422, { error: 'timeoutMs deve estar entre 5000 e 600000' });
    }

    const result = await wakeRitual.run({ espMacs: targets, targetMac, host, timeoutMs });
    return sendJson(res, 200, { status: 'ok', action: 'wake-ritual', ...result });
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

/* ------------------------------ CENAS ------------------------------ */

// Aplicar virou trabalho do servidor: cada dispositivo da cena pode estar
// num modo diferente, e o cliente teria que orquestrar comando a comando.
async function handleApplyScene(req, res, id) {
  const scene = getSceneById(id);
  if (!scene) {
    return sendJson(res, 404, { error: 'Cena não encontrada' });
  }

  try {
    return sendJson(res, 200, await applyScene(scene));
  } catch (error) {
    return sendJson(res, 500, { error: error.message });
  }
}

// Fotografa o estado atual dos dispositivos e salva como cena.
async function handleCaptureScene(req, res) {
  try {
    const body = await parseJsonBody(req);
    const targets = parseEspTargets(body);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';

    const scene = saveScene({ name, devices: captureDevices(targets) });
    return sendJson(res, 200, { scene });
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

async function handleRenameScene(req, res, id) {
  try {
    const body = await parseJsonBody(req);
    return sendJson(res, 200, { scene: renameScene(id, body?.name) });
  } catch (error) {
    const status = error.message === 'Cena não encontrada' ? 404 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

async function handleReorderScenes(req, res) {
  try {
    const body = await parseJsonBody(req);
    return sendJson(res, 200, { scenes: reorderScenes(body?.ids) });
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

/* --------------------------- MODO AUSENTE --------------------------- */

function handleGetAway(_req, res) {
  return sendJson(res, 200, { away: awayMode.describe() });
}

async function handleSaveAway(req, res) {
  try {
    const body = await parseJsonBody(req);
    const saved = saveAwayConfig(body);
    // A máquina de estados guarda dispositivos e horários da configuração
    // anterior; sem zerar, um ESP removido continuaria sendo comandado.
    awayMode.reset();
    return sendJson(res, 200, { away: { ...saved, devices: [] } });
  } catch (error) {
    const status = error.message === 'Invalid JSON' ? 400 : 422;
    return sendJson(res, status, { error: error.message });
  }
}

// POST /api/clients/{mac}/ota — dispara o update no dispositivo. Responde 202
// assim que o ESP aceita o comando: o flash leva ~1 min e o progresso chega
// depois pelo evento SSE `ota`.
async function handleStartOta(req, res, espMac) {
  const normalized = normalizeMac(espMac);
  if (!normalized) return sendJson(res, 400, { error: 'MAC inválido' });

  let body = {};
  try {
    body = await parseJsonBody(req);
  } catch (_e) {
    // Corpo é opcional; só carrega o `force`.
  }

  const result = await startUpdate(normalized, { force: body?.force === true });
  if (!result.ok) return sendJson(res, 409, { error: result.error });

  return sendJson(res, 202, { started: true, version: result.version });
}

module.exports = {
  handleAppShell,
  handleStatus,
  handleGetClients,
  handleGetDiscoveredClients,
  handleGetWolTargets,
  handleUpsertWolTarget,
  handleUpsertClient,
  handleWOL,
  handleLED,
  handleToggle,
  handleEffect,
  handleGradient,
  handleSegments,
  handleGetScenes,
  handleSaveScene,
  handleDeleteScene,
  handleSunrise,
  handleGetSchedules,
  handleUpsertSchedule,
  handleDeleteSchedule,
  handleRunSchedule,
  handleNotify,
  handleWakeRitual,
  handleApplyScene,
  handleCaptureScene,
  handleRenameScene,
  handleReorderScenes,
  handleGetAway,
  handleSaveAway,
  handleStartOta
};
