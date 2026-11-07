'use strict';

// Personalizar el aspecto: tema claro/oscuro, color principal y fondo de pantalla (degradados o tu propia foto).
// Se guarda solo en este teléfono, aparte de los datos (la foto no entra en la copia de seguridad).

const LOOK_KEY = 'inversiones.look';
const WALL_KEY = 'inversiones.wall';

const ACCENTS = [
  ['#1f5fbf', 'Azul'], ['#16a34a', 'Verde'], ['#7c3aed', 'Morado'], ['#db2777', 'Rosa'], ['#ea580c', 'Naranja'],
  ['#dc2626', 'Rojo'], ['#d4a72c', 'Oro'], ['#0d9488', 'Turquesa'], ['#0ea5e9', 'Cielo'], ['#475569', 'Grafito'],
];

// Velas japonesas en mosaico para el fondo «Velas»
const CANDLES_SVG = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
<rect width="240" height="240" fill="#070b12"/>
<g stroke-width="3" stroke-linecap="round" opacity=".55">
<line x1="20" y1="120" x2="20" y2="190" stroke="#ef4444"/><rect x="12" y="135" width="16" height="40" rx="3" fill="#ef4444"/>
<line x1="50" y1="140" x2="50" y2="215" stroke="#ef4444"/><rect x="42" y="155" width="16" height="42" rx="3" fill="#ef4444"/>
<line x1="80" y1="110" x2="80" y2="205" stroke="#22c55e"/><rect x="72" y="125" width="16" height="62" rx="3" fill="#22c55e"/>
<line x1="110" y1="80" x2="110" y2="150" stroke="#22c55e"/><rect x="102" y="92" width="16" height="40" rx="3" fill="#22c55e"/>
<line x1="140" y1="90" x2="140" y2="140" stroke="#ef4444"/><rect x="132" y="98" width="16" height="26" rx="3" fill="#ef4444"/>
<line x1="170" y1="40" x2="170" y2="130" stroke="#22c55e"/><rect x="162" y="55" width="16" height="58" rx="3" fill="#22c55e"/>
<line x1="200" y1="20" x2="200" y2="80" stroke="#22c55e"/><rect x="192" y="30" width="16" height="36" rx="3" fill="#22c55e"/>
<line x1="230" y1="25" x2="230" y2="95" stroke="#ef4444"/><rect x="222" y="35" width="16" height="40" rx="3" fill="#ef4444"/>
</g></svg>`);

const WALLS = {
  none: { name: 'Ninguno', css: '' },
  moxetas: { name: 'Moxetas', css: 'url(icons/wall-moxetas.png) center 40% / min(78vw, 460px) no-repeat, radial-gradient(circle at 50% 40%, #1d2a44, #05070d 70%)', dark: true },
  velas: { name: 'Velas', css: `url("${CANDLES_SVG}") 0 0 / 240px 240px repeat`, dark: true },
  aurora: { name: 'Aurora', css: 'radial-gradient(at 15% 10%, #00d4a6 0, transparent 45%), radial-gradient(at 85% 30%, #7c3aed 0, transparent 50%), radial-gradient(at 50% 95%, #0ea5e9 0, transparent 55%), #0b1020', dark: true },
  galaxia: { name: 'Galaxia', css: 'radial-gradient(1px 1px at 20% 30%, #fff, transparent), radial-gradient(1px 1px at 70% 20%, #fff, transparent), radial-gradient(1.5px 1.5px at 40% 70%, #fff, transparent), radial-gradient(1px 1px at 85% 80%, #fff, transparent), radial-gradient(1px 1px at 10% 85%, #fff, transparent), radial-gradient(ellipse at top, #4c1d95, transparent 60%), radial-gradient(ellipse at bottom, #0b3d91, transparent 60%), #05060f', dark: true },
  oceano: { name: 'Océano', css: 'linear-gradient(180deg, #0f2027, #203a43 50%, #2c5364)', dark: true },
  matrix: { name: 'Matrix', css: 'repeating-linear-gradient(0deg, rgba(34,197,94,.10) 0 1px, transparent 1px 28px), repeating-linear-gradient(90deg, rgba(34,197,94,.10) 0 1px, transparent 1px 28px), radial-gradient(circle at 50% 30%, #0b2a17, #020604 75%)', dark: true },
  atardecer: { name: 'Atardecer', css: 'linear-gradient(165deg, #ff7e5f, #feb47b 45%, #6a3093)' },
  rosa: { name: 'Algodón', css: 'linear-gradient(160deg, #ffd1dc, #fbc2eb 50%, #a6c1ee)' },
  menta: { name: 'Menta', css: 'linear-gradient(160deg, #d4fc79, #96e6a1 55%, #84fab0)' },
  foto: { name: 'Tu foto', css: '' },
};

const PRESETS = [
  { name: 'Clásico', mode: 'auto', accent: '#1f5fbf', wall: 'none', dim: 0 },
  { name: 'Wall Street', mode: 'dark', accent: '#d4a72c', wall: 'velas', dim: 35 },
  { name: 'Moxetas', mode: 'dark', accent: '#d4a72c', wall: 'moxetas', dim: 20 },
  { name: 'Noche', mode: 'dark', accent: '#0ea5e9', wall: 'none', dim: 0, oled: true },
  { name: 'Matrix', mode: 'dark', accent: '#16a34a', wall: 'matrix', dim: 10 },
  { name: 'Aurora', mode: 'dark', accent: '#0d9488', wall: 'aurora', dim: 30 },
  { name: 'Galaxia', mode: 'dark', accent: '#7c3aed', wall: 'galaxia', dim: 15 },
  { name: 'Atardecer', mode: 'light', accent: '#ea580c', wall: 'atardecer', dim: 25 },
  { name: 'Algodón', mode: 'light', accent: '#db2777', wall: 'rosa', dim: 20 },
];

function defaultLook() { return { mode: 'auto', accent: '#1f5fbf', wall: 'none', dim: 30, oled: false, glass: true }; }
function loadLook() {
  try { return Object.assign(defaultLook(), JSON.parse(localStorage.getItem(LOOK_KEY)) || {}); } catch (e) { return defaultLook(); }
}
function saveLook(l) { try { localStorage.setItem(LOOK_KEY, JSON.stringify(l)); } catch (e) { /* sin espacio */ } }
function wallPhoto() { try { return localStorage.getItem(WALL_KEY); } catch (e) { return null; } }

let look = loadLook();

function isDark() {
  return look.mode === 'dark' || (look.mode === 'auto' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
}

function hexRgb(h) { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function lum(h) { const c = hexRgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
// En modo oscuro un color muy apagado se aclara un poco para que se lea
function mix(h, w, t) { const a = hexRgb(h), b = hexRgb(w); return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join(''); }

function applyLook() {
  const root = document.documentElement;
  if (look.mode === 'auto') delete root.dataset.theme; else root.dataset.theme = look.mode;
  const dark = isDark();
  let acc = look.accent || '#1f5fbf';
  if (dark && lum(acc) < 0.12) acc = mix(acc, '#ffffff', 0.35);
  if (!dark && lum(acc) > 0.45) acc = mix(acc, '#000000', 0.25);
  root.style.setProperty('--accent', acc);
  root.style.setProperty('--accent-fg', lum(acc) > 0.4 ? '#111111' : '#ffffff');
  root.style.setProperty('--accent-soft', `color-mix(in srgb, ${acc} ${dark ? 22 : 16}%, var(--surface))`);
  root.classList.toggle('oled', !!look.oled && dark);

  let wall = document.getElementById('wall');
  const w = WALLS[look.wall] || WALLS.none;
  const css = look.wall === 'foto' ? (wallPhoto() ? `url("${wallPhoto()}") center / cover no-repeat` : '') : w.css;
  if (css) {
    if (!wall) { wall = document.createElement('div'); wall.id = 'wall'; wall.setAttribute('aria-hidden', 'true'); document.body.prepend(wall); }
    wall.style.background = css;
    root.style.setProperty('--wall-dim', String((look.dim || 0) / 100));
    root.classList.add('has-wall');
    root.classList.toggle('glass', look.glass !== false);
  } else {
    if (wall) wall.remove();
    root.classList.remove('has-wall', 'glass');
  }
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim() || (dark ? '#111317' : '#f4f5f7');
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.setAttribute('content', bg);
}

if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (look.mode === 'auto') applyLook(); });
applyLook();

// Reduce la foto para que quepa en el teléfono (máx. 1400 px, JPEG)
function shrinkPhoto(file) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1400 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se ha podido abrir la imagen')); };
    img.src = url;
  });
}

function presetBg(p) {
  const w = WALLS[p.wall];
  if (w && w.css) return w.css;
  return p.oled ? '#000' : p.mode === 'dark' ? '#111317' : 'linear-gradient(#f4f5f7, #e6e9ef)';
}

function renderLook() {
  setChrome({ title: 'Personalizar', tab: 'settings', back: '#/ajustes' });
  const sel = (p) => p.mode === look.mode && p.accent === look.accent && p.wall === look.wall && !!p.oled === !!look.oled;
  const photo = wallPhoto();
  view.innerHTML = `
    <h2 class="section-title">Temas</h2>
    <div class="themes">${PRESETS.map((p, i) => `
      <button type="button" class="theme ${sel(p) ? 'on' : ''}" data-preset="${i}">
        <span class="theme-bg" style="background:${esc(presetBg(p))}"><span class="theme-card ${p.mode === 'light' || (p.mode === 'auto' && !isDark()) ? 'l' : 'd'}"><i style="background:${p.accent}"></i><i></i></span></span>
        <span class="theme-name">${esc(p.name)}</span>
      </button>`).join('')}</div>

    <h2 class="section-title">Modo</h2>
    <div class="seg" style="margin-bottom:8px">
      ${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([v, t]) => `<label><input type="radio" name="lk-mode" value="${v}" ${look.mode === v ? 'checked' : ''}><span>${t}</span></label>`).join('')}
    </div>
    <section class="card form">
      <label class="check" style="margin:0"><input type="checkbox" id="lk-oled" ${look.oled ? 'checked' : ''}> <span>Negro puro en modo oscuro (ahorra batería en pantallas OLED)</span></label>
    </section>

    <h2 class="section-title">Color principal</h2>
    <section class="card">
      <div class="swatches">${ACCENTS.map(([c, n]) => `<button type="button" class="sw ${look.accent === c ? 'on' : ''}" data-acc="${c}" style="background:${c}" aria-label="${n}"></button>`).join('')}
        <label class="sw sw-own ${ACCENTS.some(([c]) => c === look.accent) ? '' : 'on'}" aria-label="Otro color" style="background:${ACCENTS.some(([c]) => c === look.accent) ? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' : esc(look.accent)}"><input type="color" id="lk-own" value="${esc(look.accent)}"></label>
      </div>
      <p class="note" style="margin:10px 0 0">Botones, pestaña activa y detalles de la app.</p>
    </section>

    <h2 class="section-title">Fondo de pantalla</h2>
    <div class="walls">${Object.entries(WALLS).map(([k, w]) => `
      <button type="button" class="wall-opt ${look.wall === k ? 'on' : ''}" data-wall="${k}">
        <span class="wall-bg" style="background:${k === 'foto' ? (photo ? `url('${photo}') center / cover` : 'var(--surface-2)') : k === 'none' ? 'var(--bg)' : esc(w.css)}">${k === 'foto' && !photo ? '📷' : k === 'none' ? '∅' : ''}</span>
        <span class="theme-name">${esc(w.name)}</span>
      </button>`).join('')}</div>
    <input type="file" id="lk-photo" accept="image/*" hidden>
    ${look.wall !== 'none' ? `
    <section class="card form">
      <label class="field"><span>Oscurecer el fondo: <b id="lk-dimv">${look.dim}%</b></span><input type="range" id="lk-dim" min="0" max="85" step="5" value="${look.dim}"></label>
      <label class="check" style="margin:0"><input type="checkbox" id="lk-glass" ${look.glass !== false ? 'checked' : ''}> <span>Tarjetas de cristal (se transparenta el fondo)</span></label>
      ${look.wall === 'foto' ? '<button class="btn secondary" type="button" id="lk-change">Cambiar foto</button>' : ''}
    </section>` : ''}

    <section class="card form">
      <button class="btn secondary" type="button" id="lk-reset">Volver al aspecto original</button>
    </section>
    <p class="note">El aspecto se guarda solo en este teléfono. Cada uno puede tener el suyo.</p>`;

  const set = (patch, rerender) => { Object.assign(look, patch); saveLook(look); applyLook(); if (rerender !== false) { const y = window.scrollY; renderLook(); window.scrollTo(0, y); } };
  for (const b of view.querySelectorAll('[data-preset]')) b.addEventListener('click', () => {
    const p = PRESETS[+b.dataset.preset];
    set({ mode: p.mode, accent: p.accent, wall: p.wall, dim: p.dim, oled: !!p.oled, glass: true });
  });
  for (const r of view.querySelectorAll('[name=lk-mode]')) r.addEventListener('change', () => set({ mode: r.value }));
  $('#lk-oled').addEventListener('change', (e) => set({ oled: e.target.checked }));
  for (const b of view.querySelectorAll('[data-acc]')) b.addEventListener('click', () => set({ accent: b.dataset.acc }));
  $('#lk-own').addEventListener('input', (e) => set({ accent: e.target.value }, false));
  $('#lk-own').addEventListener('change', (e) => set({ accent: e.target.value }));
  const pick = () => $('#lk-photo').click();
  for (const b of view.querySelectorAll('[data-wall]')) b.addEventListener('click', () => {
    const k = b.dataset.wall;
    if (k === 'foto' && !wallPhoto()) { pick(); return; }
    set({ wall: k, dim: k === 'none' ? look.dim : (k === look.wall ? look.dim : (WALLS[k].dark ? 25 : 20)) });
  });
  $('#lk-photo').addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const data = await shrinkPhoto(f);
      try { localStorage.setItem(WALL_KEY, data); } catch (err) { alert('La foto es demasiado grande para guardarla en el teléfono. Prueba con otra.'); return; }
      set({ wall: 'foto', dim: 30 });
      toast('Fondo cambiado');
    } catch (err) { alert(err.message); }
  });
  const ch = $('#lk-change'); if (ch) ch.addEventListener('click', pick);
  const dim = $('#lk-dim');
  if (dim) {
    dim.addEventListener('input', () => { $('#lk-dimv').textContent = dim.value + '%'; set({ dim: +dim.value }, false); });
    $('#lk-glass').addEventListener('change', (e) => set({ glass: e.target.checked }));
  }
  $('#lk-reset').addEventListener('click', () => {
    look = defaultLook(); saveLook(look);
    try { localStorage.removeItem(WALL_KEY); } catch (e) { /* nada */ }
    applyLook(); renderLook(); toast('Aspecto original');
  });
}
