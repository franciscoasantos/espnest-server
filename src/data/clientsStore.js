const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'clients.json');

function normalizeMac(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/-/g, ':').toUpperCase();
  if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(cleaned)) return null;
  return cleaned;
}

function normalizeLedType(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'ws2812b' || normalized === 'sk6812') {
    return normalized;
  }
  return null;
}

function createDefaultStore() {
  return {
    clients: []
  };
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(createDefaultStore(), null, 2), 'utf-8');
  }
}

// O arquivo é lido uma vez e mantido em memória. Antes cada comando de LED
// fazia read + parse + stringify + write do arquivo inteiro, ~7x/s durante um
// arraste no seletor de cor, bloqueando o event loop — e duas atualizações
// simultâneas (Promise.all sobre vários ESPs) se sobrescreviam, porque cada uma
// carregava e salvava a sua própria cópia. Com um único objeto compartilhado o
// último write não perde mais a alteração do outro dispositivo.
let cache = null;
let pendingWrite = false;
let flushTimer = null;

const WRITE_DEBOUNCE_MS = 1000;

function loadStore() {
  if (cache) return cache;

  ensureDataFile();
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw);

    cache = (parsed && typeof parsed === 'object')
      ? { clients: Array.isArray(parsed.clients) ? parsed.clients : [] }
      : createDefaultStore();
  } catch (_e) {
    cache = createDefaultStore();
  }

  return cache;
}

function writeNow() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  pendingWrite = false;
  if (!cache) return;
  fs.writeFileSync(DATA_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

// Gravação imediata: ações explícitas do usuário (cadastro/edição de ESP).
function saveStore(store) {
  cache = store;
  writeNow();
}

// Gravação adiada: estado que muda em alta frequência (cor do LED). Janela
// máxima de WRITE_DEBOUNCE_MS a partir da primeira alteração.
function scheduleSave(store) {
  cache = store;
  pendingWrite = true;
  if (!flushTimer) {
    flushTimer = setTimeout(writeNow, WRITE_DEBOUNCE_MS);
  }
}

function flushPendingWrites() {
  if (pendingWrite) writeNow();
}

// Não perder a última cor se o processo cair no meio da janela de debounce.
process.on('exit', flushPendingWrites);
['SIGINT', 'SIGTERM'].forEach((signal) => {
  process.on(signal, () => {
    flushPendingWrites();
    process.exit(0);
  });
});

function getClients() {
  const store = loadStore();
  return store.clients;
}

function getClientByMac(espMac) {
  const normalized = normalizeMac(espMac);
  if (!normalized) return null;

  const store = loadStore();
  return store.clients.find((client) => client.espMac === normalized) || null;
}

function upsertClient(payload) {
  const espMac = normalizeMac(payload?.espMac);
  if (!espMac) {
    throw new Error('espMac inválido');
  }

  const nickname = typeof payload?.nickname === 'string' ? payload.nickname.trim() : '';
  if (!nickname) {
    throw new Error('nickname é obrigatório');
  }

  const ledCount = Number.parseInt(payload?.ledCount, 10);
  if (!Number.isInteger(ledCount) || ledCount < 1 || ledCount > 2048) {
    throw new Error('ledCount deve ser um inteiro entre 1 e 2048');
  }

  const ledPin = Number.parseInt(payload?.ledPin, 10);
  if (!Number.isInteger(ledPin) || ledPin < 0 || ledPin > 48) {
    throw new Error('ledPin deve ser um inteiro entre 0 e 48');
  }

  const ledType = normalizeLedType(payload?.ledType);
  if (!ledType) {
    throw new Error('ledType deve ser ws2812b ou sk6812');
  }

  const store = loadStore();
  // Permite cor no formato { r: 0-255, g: 0-255, b: 0-255 }
  let lastLedColor = undefined;
  if (payload?.lastLedColor && typeof payload.lastLedColor === 'object') {
    const { r, g, b } = payload.lastLedColor;
    if (
      Number.isInteger(r) && r >= 0 && r <= 255 &&
      Number.isInteger(g) && g >= 0 && g <= 255 &&
      Number.isInteger(b) && b >= 0 && b <= 255
    ) {
      lastLedColor = { r, g, b };
    }
  }
  const nextClient = {
    espMac,
    nickname,
    ledCount,
    ledPin,
    ledType,
    updatedAt: new Date().toISOString(),
    ...(lastLedColor ? { lastLedColor } : {})
  };

  const idx = store.clients.findIndex((item) => item.espMac === espMac);
  if (idx >= 0) {
    store.clients[idx] = {
      ...store.clients[idx],
      ...nextClient,
      createdAt: store.clients[idx].createdAt || new Date().toISOString()
    };
  } else {
    store.clients.push({
      ...nextClient,
      createdAt: new Date().toISOString()
    });
  }

  saveStore(store);
  return store.clients.find((item) => item.espMac === espMac);
}

// Atualiza só a última cor, sem passar pela validação completa do upsert e
// sem gravar o arquivo a cada comando. É o caminho quente: durante um arraste
// no seletor chegam ~7 cores por segundo por dispositivo.
function setLastLedColor(espMac, color) {
  const normalized = normalizeMac(espMac);
  if (!normalized) return null;

  const { r, g, b, w } = color || {};
  const valid = [r, g, b].every((value) => Number.isInteger(value) && value >= 0 && value <= 255);
  if (!valid) return null;

  // O branco do SK6812 faz parte da cor: sem guardá-lo aqui, reconectar,
  // recarregar a página ou capturar uma cena devolvia a fita sem o canal W.
  const stored = (Number.isInteger(w) && w >= 0 && w <= 255) ? { r, g, b, w } : { r, g, b };

  const store = loadStore();
  const client = store.clients.find((item) => item.espMac === normalized);
  if (!client) return null;

  client.lastLedColor = stored;
  client.lastPattern = { type: 'solid', color: stored };
  client.updatedAt = new Date().toISOString();
  scheduleSave(store);

  return client;
}

// Padrão completo (gradiente/segmentos). `lastLedColor` continua sendo
// gravado com a cor representativa, para o swatch do dashboard e para ESPs
// que só entendem cor sólida.
function setLastPattern(espMac, pattern, representativeColor) {
  const normalized = normalizeMac(espMac);
  if (!normalized) return null;

  const store = loadStore();
  const client = store.clients.find((item) => item.espMac === normalized);
  if (!client) return null;

  client.lastPattern = pattern;
  if (representativeColor) client.lastLedColor = representativeColor;
  client.updatedAt = new Date().toISOString();
  scheduleSave(store);

  return client;
}


// Versão de firmware reportada pelo ESP no handshake. Fica no mesmo arquivo
// dos demais dados do dispositivo para a UI poder comparar com o manifesto do
// firmware publicado mesmo enquanto o ESP está offline.
function setFirmwareVersion(espMac, version) {
  const normalized = normalizeMac(espMac);
  if (!normalized) return null;
  if (typeof version !== 'string' || !version.trim()) return null;

  const store = loadStore();
  const client = store.clients.find((item) => item.espMac === normalized);
  if (!client) return null;

  const next = version.trim().slice(0, 64);
  if (client.firmwareVersion === next) return client;

  client.firmwareVersion = next;
  client.updatedAt = new Date().toISOString();
  scheduleSave(store);

  return client;
}

module.exports = {
  normalizeMac,
  getClients,
  getClientByMac,
  upsertClient,
  setLastLedColor,
  setLastPattern,
  setFirmwareVersion,
  flushPendingWrites
};
