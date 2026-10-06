// Primitivas de UI: ícones, helpers de DOM, toasts, modais e tema.

export const icons = {
  dashboard: '<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"/>',
  led: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"/>',
  wol: '<path stroke-linecap="round" stroke-linejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9"/>',
  devices: '<path stroke-linecap="round" stroke-linejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25A2.25 2.25 0 015.25 3h13.5A2.25 2.25 0 0121 5.25z"/>',
  clock: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/>',
  plus: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/>',
  trash: '<path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"/>',
  pencil: '<path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"/>',
  power: '<path stroke-linecap="round" stroke-linejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9"/>',
  search: '<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/>',
  sun: '<path stroke-linecap="round" stroke-linejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z"/>',
  moon: '<path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"/>',
  check: '<path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/>',
  x: '<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>',
  sparkles: '<path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"/>',
  chevron: '<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5"/>',
  signal: '<path stroke-linecap="round" stroke-linejoin="round" d="M9.348 14.652a3.75 3.75 0 010-5.304m5.304 0a3.75 3.75 0 010 5.304m-7.425 2.121a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12z"/>'
};

export function icon(name, cls = 'h-5 w-5') {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" class="${cls}" aria-hidden="true">${icons[name] || ''}</svg>`;
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Cria um elemento DOM a partir de uma string HTML (primeiro nó).
export function node(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html.trim();
  return tpl.content.firstElementChild;
}

export const $ = (sel, ctx = document) => ctx.querySelector(sel);
export const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

/* ---------------------------------- Tema --------------------------------- */

const THEME_KEY = 'espnest:theme';

export function isDark() {
  return document.documentElement.classList.contains('dark');
}

export function setTheme(theme) {
  const dark = theme === 'dark';
  document.documentElement.classList.toggle('dark', dark);
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#09090b' : '#fafafa');
  document.dispatchEvent(new CustomEvent('themechange', { detail: { dark } }));
}

export function toggleTheme() {
  setTheme(isDark() ? 'light' : 'dark');
}

export function themeIcon() {
  return icon(isDark() ? 'sun' : 'moon', 'h-5 w-5');
}

/* --------------------------------- Toasts -------------------------------- */

const TOAST_STYLES = {
  success: { ring: 'border-emerald-500/40', badge: 'bg-emerald-500/15 text-emerald-500', glyph: 'check' },
  error: { ring: 'border-red-500/40', badge: 'bg-red-500/15 text-red-500', glyph: 'x' },
  info: { ring: 'border-zinc-300 dark:border-zinc-700', badge: 'bg-zinc-500/15 text-zinc-500', glyph: 'sparkles' }
};

export function toast(type, message, { duration = 3500, detail = '' } = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const s = TOAST_STYLES[type] || TOAST_STYLES.info;
  const el = node(`
    <div class="pointer-events-auto flex items-start gap-3 rounded-xl border ${s.ring} bg-white px-4 py-3 shadow-lg dark:bg-zinc-900"
         style="opacity:0;transform:translateY(-8px);transition:opacity .15s,transform .15s">
      <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${s.badge}">${icon(s.glyph, 'h-4 w-4')}</span>
      <div class="min-w-0 flex-1 text-sm">
        <p class="font-medium leading-snug">${escapeHtml(message)}</p>
        ${detail ? `<p class="mt-0.5 text-xs muted leading-snug">${escapeHtml(detail)}</p>` : ''}
      </div>
    </div>`);
  root.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  }));
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    setTimeout(() => el.remove(), 200);
  }, duration);
}

/* --------------------------------- Modais -------------------------------- */

export function openModal(contentEl, { onClose } = {}) {
  const root = document.getElementById('modal-root');
  const overlay = node(`
    <div class="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
         style="opacity:0;transition:opacity .15s">
      <div class="w-full max-w-md rounded-t-2xl border border-zinc-200 bg-white p-5 shadow-xl dark:border-zinc-800 dark:bg-zinc-900 sm:rounded-2xl"
           style="transform:translateY(12px);transition:transform .15s"></div>
    </div>`);
  const panel = overlay.firstElementChild;
  panel.appendChild(contentEl);
  root.appendChild(overlay);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    overlay.style.opacity = '1';
    panel.style.transform = 'translateY(0)';
  }));

  function close() {
    overlay.style.opacity = '0';
    panel.style.transform = 'translateY(12px)';
    setTimeout(() => overlay.remove(), 180);
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
  return { close };
}

export function confirmModal({ title, message, confirmText = 'Confirmar', cancelText = 'Cancelar', danger = false }) {
  return new Promise((resolve) => {
    const content = node(`
      <div>
        <h3 class="text-lg font-semibold">${escapeHtml(title)}</h3>
        <p class="mt-2 text-sm muted">${escapeHtml(message)}</p>
        <div class="mt-5 flex justify-end gap-2">
          <button data-act="cancel" class="btn-ghost">${escapeHtml(cancelText)}</button>
          <button data-act="ok" class="${danger ? 'btn-danger' : 'btn-primary'}">${escapeHtml(confirmText)}</button>
        </div>
      </div>`);
    const { close } = openModal(content, { onClose: () => resolve(false) });
    content.querySelector('[data-act="cancel"]').addEventListener('click', () => { resolve(false); close(); });
    content.querySelector('[data-act="ok"]').addEventListener('click', () => { resolve(true); close(); });
  });
}
