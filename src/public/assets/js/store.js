// Estado central do app + ponte SSE. Views se inscrevem via store.on(evt, cb).
// Eventos: 'clients', 'status', 'state', 'effect', 'ota', 'selection'.

import { api } from './api.js';

const SELECTION_KEY = 'espnest:selection';

const bus = new EventTarget();

const state = {
  clients: [],                 // [{ espMac, nickname, ledCount, ledPin, ledType, lastLedColor, connected, activeEffect }]
  connected: new Set(),        // macs online (via SSE)
  liveColors: new Map(),       // mac -> { r, g, b, w }
  effects: new Map(),          // mac -> nome do efeito ativo (ver EFFECTS em views/led.js)
  ota: new Map(),              // mac -> { phase, pct, error } durante um update

  selection: new Set(),        // macs selecionados (persistido)
  sseReady: false
};

/* ------------------------------ pub/sub ------------------------------ */

function emit(type, detail) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}

export const store = {
  on(type, cb) {
    const handler = (e) => cb(e.detail);
    bus.addEventListener(type, handler);
    return () => bus.removeEventListener(type, handler);
  },

  /* --------------------------- getters --------------------------- */
  get clients() { return state.clients; },
  get connectedSet() { return state.connected; },
  isConnected(mac) { return state.connected.has(mac); },
  liveColor(mac) {
    return state.liveColors.get(mac) || null;
  },
  // Efeito ativo de um cliente (ou null se cor sólida)
  effectOf(mac) {
    return state.effects.get(mac) || null;
  },
  // Estado do OTA em curso (ou null). Some sozinho quando o ESP volta online.
  otaOf(mac) {
    return state.ota.get(mac) || null;
  },
  setOta(mac, value) {
    if (value) state.ota.set(mac, value);
    else state.ota.delete(mac);
    emit('ota', { espMac: mac, ota: value || null });
  },
  // Cor "atual" de um cliente: a ao vivo (SSE) tem prioridade sobre a salva.
  colorOf(mac) {
    const live = state.liveColors.get(mac);
    if (live) return live;
    const c = state.clients.find((x) => x.espMac === mac);
    return c && c.lastLedColor ? c.lastLedColor : null;
  },
  clientByMac(mac) { return state.clients.find((c) => c.espMac === mac) || null; },

  /* ------------------------- seleção global ---------------------- */
  get selection() { return state.selection; },
  selectedMacs() { return [...state.selection]; },
  selectedClients() { return state.clients.filter((c) => state.selection.has(c.espMac)); },
  isSelected(mac) { return state.selection.has(mac); },

  toggleSelection(mac) {
    if (state.selection.has(mac)) state.selection.delete(mac);
    else state.selection.add(mac);
    persistSelection();
    emit('selection', state.selection);
  },
  selectAll() {
    state.clients.forEach((c) => state.selection.add(c.espMac));
    persistSelection();
    emit('selection', state.selection);
  },
  clearSelection() {
    state.selection.clear();
    persistSelection();
    emit('selection', state.selection);
  },
  setSelection(macs) {
    state.selection = new Set(macs);
    persistSelection();
    emit('selection', state.selection);
  },

  /* --------------------------- dados ----------------------------- */
  async refreshClients() {
    const clients = await api.getClients();
    state.clients = clients;
    // marca como connected também via flag do GET (caso SSE ainda não chegou)
    // e sincroniza o efeito ativo reportado pelo servidor
    clients.forEach((c) => {
      if (c.connected) state.connected.add(c.espMac);
      if (c.activeEffect) state.effects.set(c.espMac, c.activeEffect);
      else state.effects.delete(c.espMac);
    });
    pruneSelection();
    emit('clients', clients);
    return clients;
  },

  /* ----------------------------- SSE ----------------------------- */
  initSSE() {
    if (state._sse) return;
    const es = new EventSource('/api/status');
    state._sse = es;

    es.onerror = () => {
      // CONNECTING = queda de rede, o próprio EventSource reconecta.
      // CLOSED = 401/sessão morta — não há retry, então volta pro login.
      if (es.readyState === EventSource.CLOSED) location.href = '/login';
    };

    es.addEventListener('status', (ev) => {
      try {
        const data = JSON.parse(ev.data);
        state.connected = new Set(data.connectedClients || []);
        state.sseReady = true;
        // sincroniza flag connected nos clients em memória
        state.clients.forEach((c) => { c.connected = state.connected.has(c.espMac); });
        emit('status', { connected: data.connected, set: state.connected });
      } catch (e) {}
    });

    es.addEventListener('state', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (!d.espMac) return;
        const color = { r: d.r | 0, g: d.g | 0, b: d.b | 0, w: d.w | 0 };
        state.liveColors.set(d.espMac, color);
        const c = state.clients.find((x) => x.espMac === d.espMac);
        if (c) {
          c.lastLedColor = color;
          if (d.pattern) c.lastPattern = d.pattern;
        }
        emit('state', { espMac: d.espMac, color });
      } catch (e) {}
    });

    es.addEventListener('ota', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (!d.espMac) return;
        state.ota.set(d.espMac, { phase: d.phase, pct: d.pct ?? null, error: d.error || null });
        emit('ota', { espMac: d.espMac, ota: state.ota.get(d.espMac) });
      } catch (e) {}
    });

    es.addEventListener('effect', (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (!d.espMac) return;
        if (d.effect) state.effects.set(d.espMac, d.effect);
        else state.effects.delete(d.espMac);
        const c = state.clients.find((x) => x.espMac === d.espMac);
        if (c) c.activeEffect = d.effect || null;
        emit('effect', { espMac: d.espMac, effect: d.effect || null });
      } catch (e) {}
    });
  }
};

function persistSelection() {
  try { localStorage.setItem(SELECTION_KEY, JSON.stringify([...state.selection])); } catch (e) {}
}

function loadSelection() {
  try {
    const raw = localStorage.getItem(SELECTION_KEY);
    if (raw) state.selection = new Set(JSON.parse(raw));
  } catch (e) {}
}

function pruneSelection() {
  const valid = new Set(state.clients.map((c) => c.espMac));
  let changed = false;
  for (const mac of state.selection) {
    if (!valid.has(mac)) { state.selection.delete(mac); changed = true; }
  }
  // Seleção padrão: se nada selecionado e há clientes, seleciona todos.
  if (state.selection.size === 0 && state.clients.length) {
    state.clients.forEach((c) => state.selection.add(c.espMac));
    changed = true;
  }
  if (changed) { persistSelection(); emit('selection', state.selection); }
}

loadSelection();
