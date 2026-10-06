// Seletor de cor "clássico": anel de matiz (externo) + quadrado de
// saturação/valor (interno), com branco opcional e hex.
// Portado do seletor antigo. API pública estável:
//   createColorControl(container, { onChange, hasWhite })
//   -> { getColor, setColor, setWhiteEnabled, destroy }

export function hsvToRgb(h, s, v) {
  h = (h % 360 + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

// O LED branco do SK6812 soma luz por cima do RGB. Qualquer preview que
// ignore `w` mostra a fita mais escura do que ela está — e o slider de
// branco parece não fazer nada.
export function rgbwCss({ r, g, b, w = 0 }) {
  const add = (c) => Math.min(255, (c || 0) + (w || 0));
  return `rgb(${add(r)},${add(g)},${add(b)})`;
}

export function toHex({ r, g, b }) {
  const p = (n) => n.toString(16).padStart(2, '0');
  return `#${p(r)}${p(g)}${p(b)}`.toUpperCase();
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const int = parseInt(m[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

// Geometria lógica (coordenadas internas); a exibição é escalada por CSS.
const SIZE = 280;
const RADIUS = SIZE / 2;
const THICKNESS = 26;
const SV = 150;
const SV_OFF = (SIZE - SV) / 2;

export function createColorControl(container, { onChange, hasWhite = false } = {}) {
  let hue = 27, sat = 0.78, val = 1, w = 0;
  let raf = null;

  container.innerHTML = `
    <div class="flex flex-col items-center gap-5">
      <div data-area class="relative mx-auto aspect-square w-full max-w-[280px] touch-none select-none">
        <canvas data-ring width="${SIZE}" height="${SIZE}" class="absolute inset-0 h-full w-full"></canvas>
        <canvas data-sv width="${SV}" height="${SV}" class="absolute rounded-xl"
          style="left:${SV_OFF / SIZE * 100}%;top:${SV_OFF / SIZE * 100}%;width:${SV / SIZE * 100}%;height:${SV / SIZE * 100}%"></canvas>
        <div data-ring-sel class="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white" style="box-shadow:0 0 0 1px rgba(0,0,0,.5)"></div>
        <div data-sv-sel class="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white" style="box-shadow:0 0 0 1px rgba(0,0,0,.5)"></div>
      </div>

      <div data-white-wrap class="w-full ${hasWhite ? '' : 'hidden'}">
        <div class="flex items-center justify-between text-sm">
          <span class="muted">Branco (W)</span>
          <span data-white-val class="font-medium tabular-nums">0</span>
        </div>
        <input data-white type="range" min="0" max="255" value="0" class="mt-1 w-full accent-zinc-400" />
      </div>

      <div class="flex w-full items-center gap-3">
        <div data-preview class="h-10 w-10 shrink-0 rounded-xl border border-zinc-200 shadow-sm dark:border-zinc-800"></div>
        <span class="text-sm muted">HEX</span>
        <input data-hex type="text" maxlength="7" class="field w-32 font-mono uppercase" value="#FFFFFF" />
      </div>
    </div>`;

  const area = container.querySelector('[data-area]');
  const ringCanvas = container.querySelector('[data-ring]');
  const svCanvas = container.querySelector('[data-sv]');
  const ringCtx = ringCanvas.getContext('2d');
  const svCtx = svCanvas.getContext('2d');
  const ringSel = container.querySelector('[data-ring-sel]');
  const svSel = container.querySelector('[data-sv-sel]');
  const whiteWrap = container.querySelector('[data-white-wrap]');
  const white = container.querySelector('[data-white]');
  const whiteVal = container.querySelector('[data-white-val]');
  const hex = container.querySelector('[data-hex]');
  const preview = container.querySelector('[data-preview]');

  function drawRing() {
    const img = ringCtx.createImageData(SIZE, SIZE);
    const data = img.data;
    const inner = RADIUS - THICKNESS;
    const soft = 1.5;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = x - RADIUS, dy = y - RADIUS;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const idx = (y * SIZE + x) * 4;
        if (dist >= inner - soft && dist <= RADIUS + soft) {
          const ang = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
          const rgb = hsvToRgb(ang, 1, 1);
          let a = 1;
          if (dist < inner) a = (dist - (inner - soft)) / soft;
          else if (dist > RADIUS) a = ((RADIUS + soft) - dist) / soft;
          data[idx] = rgb.r; data[idx + 1] = rgb.g; data[idx + 2] = rgb.b;
          data[idx + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
        } else {
          data[idx + 3] = 0;
        }
      }
    }
    ringCtx.putImageData(img, 0, 0);
  }

  function drawSv() {
    const hr = hsvToRgb(hue, 1, 1);
    svCtx.clearRect(0, 0, SV, SV);
    const gs = svCtx.createLinearGradient(0, 0, SV, 0);
    gs.addColorStop(0, '#FFF');
    gs.addColorStop(1, `rgb(${hr.r},${hr.g},${hr.b})`);
    svCtx.fillStyle = gs; svCtx.fillRect(0, 0, SV, SV);
    const gv = svCtx.createLinearGradient(0, 0, 0, SV);
    gv.addColorStop(0, 'rgba(0,0,0,0)');
    gv.addColorStop(1, 'rgba(0,0,0,1)');
    svCtx.fillStyle = gv; svCtx.fillRect(0, 0, SV, SV);
  }

  function color() {
    const rgb = hsvToRgb(hue, sat, val);
    return hasWhite ? { ...rgb, w } : rgb;
  }

  function pct(px) { return px / SIZE * 100; }

  function syncUI() {
    drawSv();
    const ang = hue * Math.PI / 180;
    const mid = RADIUS - THICKNESS / 2;
    ringSel.style.left = `${pct(RADIUS + Math.cos(ang) * mid)}%`;
    ringSel.style.top = `${pct(RADIUS + Math.sin(ang) * mid)}%`;
    const ringRgb = hsvToRgb(hue, 1, 1);
    ringSel.style.background = `rgb(${ringRgb.r},${ringRgb.g},${ringRgb.b})`;
    svSel.style.left = `${pct(SV_OFF + sat * SV)}%`;
    svSel.style.top = `${pct(SV_OFF + (1 - val) * SV)}%`;
    const rgb = hsvToRgb(hue, sat, val);
    svSel.style.background = `rgb(${rgb.r},${rgb.g},${rgb.b})`;
    preview.style.background = rgbwCss({ ...rgb, w: hasWhite ? w : 0 });
    hex.value = toHex(rgb);
    white.value = w;
    whiteVal.textContent = String(w);
  }

  function fire() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = null; if (onChange) onChange(color()); });
  }

  /* ----------------------------- ponteiro ---------------------------- */
  let dragMode = null;

  function localPoint(e) {
    const point = e.touches ? e.touches[0] : e;
    const rect = area.getBoundingClientRect();
    const scale = SIZE / rect.width;
    return { x: (point.clientX - rect.left) * scale, y: (point.clientY - rect.top) * scale };
  }

  function handle(e) {
    const p = localPoint(e);
    if (dragMode === 'ring') {
      const dx = p.x - RADIUS, dy = p.y - RADIUS;
      hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      syncUI(); fire();
    } else if (dragMode === 'sv') {
      const lx = Math.max(0, Math.min(SV, p.x - SV_OFF));
      const ly = Math.max(0, Math.min(SV, p.y - SV_OFF));
      sat = lx / SV; val = 1 - ly / SV;
      syncUI(); fire();
    }
  }

  function down(e) {
    const p = localPoint(e);
    const dx = p.x - RADIUS, dy = p.y - RADIUS;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const inRing = dist >= (RADIUS - THICKNESS) && dist <= RADIUS;
    const inSv = p.x >= SV_OFF && p.x <= SV_OFF + SV && p.y >= SV_OFF && p.y <= SV_OFF + SV;
    if (inRing) dragMode = 'ring';
    else if (inSv) dragMode = 'sv';
    else return;
    e.preventDefault();
    handle(e);
  }
  const move = (e) => { if (dragMode) { e.preventDefault(); handle(e); } };
  const up = () => { dragMode = null; };

  area.addEventListener('mousedown', down);
  area.addEventListener('touchstart', down, { passive: false });
  window.addEventListener('mousemove', move);
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', up);
  window.addEventListener('touchend', up);

  white.addEventListener('input', () => { w = Number(white.value); whiteVal.textContent = white.value; fire(); });
  hex.addEventListener('change', () => {
    const rgb = hexToRgb(hex.value);
    if (!rgb) { syncUI(); return; }
    const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
    hue = hsv.h; sat = hsv.s; val = hsv.v;
    syncUI(); fire();
  });

  drawRing();
  syncUI();

  return {
    element: container,
    getColor: color,
    setColor(c, { silent = true } = {}) {
      if (c) {
        const hsv = rgbToHsv(c.r || 0, c.g || 0, c.b || 0);
        hue = hsv.h; sat = hsv.s; val = hsv.v;
        if (hasWhite && typeof c.w === 'number') w = c.w;
      }
      syncUI();
      if (!silent && onChange) onChange(color());
    },
    // Alterna a dimensão de branco de verdade, não só a visibilidade do slider:
    // é `hasWhite` que decide se `w` entra no objeto devolvido por getColor().
    setWhiteEnabled(enabled) {
      hasWhite = !!enabled;
      whiteWrap.classList.toggle('hidden', !hasWhite);
      syncUI();
    },
    destroy() {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchend', up);
    }
  };
}
