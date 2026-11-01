'use strict';

// Mis inversiones: todo se guarda en el teléfono (localStorage). Sin servidor ni librerías.

const STORAGE_KEY = 'inversiones.v1';

// Tipos de inversión, siempre en este orden: cada uno tiene su color fijo (--t1 … --t8)
const TYPES = [
  { id: 'acciones', name: 'Acciones', mode: 'units' },
  { id: 'etf', name: 'ETF', mode: 'units' },
  { id: 'fondos', name: 'Fondos de inversión', mode: 'units' },
  { id: 'cripto', name: 'Criptomonedas', mode: 'units' },
  { id: 'pensiones', name: 'Planes de pensiones', mode: 'units' },
  { id: 'rentafija', name: 'Renta fija (bonos, letras)', mode: 'amount' },
  { id: 'depositos', name: 'Depósitos y cuentas', mode: 'amount' },
  { id: 'otros', name: 'Otros (oro, inmuebles…)', mode: 'amount' },
];
const CURRENCIES = ['EUR', 'USD', 'CHF', 'GBP'];
const STALE_DAYS = 30;

// ---------- Estado guardado en el teléfono ----------

function freshState() {
  return { currency: 'EUR', investments: [], moves: [] };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? Object.assign(freshState(), JSON.parse(raw)) : freshState();
  } catch (e) {
    return freshState();
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('No se ha podido guardar en este teléfono');
  }
}

let state = loadState();

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------- Números y fechas ----------

function nf(opts) {
  try { return new Intl.NumberFormat('es-ES', Object.assign({ useGrouping: 'always' }, opts)); }
  catch (e) { return new Intl.NumberFormat('es-ES', opts); }
}
function money(n) { return nf({ style: 'currency', currency: state.currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n || 0); }
function price(n) { return nf({ style: 'currency', currency: state.currency, minimumFractionDigits: 2, maximumFractionDigits: Math.abs(n || 0) < 1 ? 6 : 4 }).format(n || 0); }
function units(n) { return nf({ maximumFractionDigits: 6 }).format(n || 0); }
function pct(n) { return nf({ style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n || 0); }
function signed(n, fmt) {
  const f = fmt || money;
  if (Math.abs(n) < 0.005) return f(0);
  return (n > 0 ? '+' : '−') + f(Math.abs(n));
}
function cls(n) { return n > 0.005 ? 'good' : n < -0.005 ? 'bad' : ''; }
function arrow(n) { return n > 0.005 ? '▲ ' : n < -0.005 ? '▼ ' : ''; }

// Acepta "1.234,56", "1234,56" o "1234.56"
function parseNum(s) {
  let x = String(s == null ? '' : s).trim().replace(/[\s€$£]/g, '');
  if (!x) return NaN;
  if (x.includes(',')) x = x.replace(/\./g, '').replace(',', '.');
  return Number(x);
}
function numIn(n) { return n == null || isNaN(n) ? '' : String(+n.toFixed(8)).replace('.', ','); }

function pad(n) { return String(n).padStart(2, '0'); }
function todayKey() { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function fromKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12); }
function fmtDate(k) { return k ? fromKey(k).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }
function fmtMonth(k) { const s = fromKey(k).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); }
function daysSince(k) { return Math.floor((fromKey(todayKey()) - fromKey(k)) / 86400000); }

// ---------- Cálculos ----------

function typeOf(id) { return TYPES.find((t) => t.id === id) || TYPES[TYPES.length - 1]; }
function typeColor(id) { return 'var(--t' + (TYPES.indexOf(typeOf(id)) + 1) + ')'; }
function invById(id) { return state.investments.find((i) => i.id === id); }

function kindName(kind, inv) {
  const unitsMode = inv && inv.mode === 'units';
  if (kind === 'buy') return unitsMode ? 'Compra' : 'Aportación';
  if (kind === 'sell') return unitsMode ? 'Venta' : 'Retirada';
  return inv && ['depositos', 'rentafija'].includes(inv.type) ? 'Intereses' : 'Dividendo / interés';
}

function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.created || 0) - (b.created || 0); }
function movesOf(invId) { return state.moves.filter((m) => m.invId === invId).sort(byDate); }

// Coste medio: al vender, sale la parte proporcional del coste de lo que tenías
function calc(inv) {
  let held = 0, cost = 0, contributed = 0, withdrawn = 0, income = 0, realized = 0, lastPrice = null;
  let flowsAfterValue = 0;
  for (const m of movesOf(inv.id)) {
    const fee = m.fee || 0;
    if (m.kind === 'buy') {
      contributed += m.amount + fee;
      cost += m.amount + fee;
      if (inv.mode === 'units') { held += m.units || 0; lastPrice = m.price; }
      if (inv.valueDate && m.date > inv.valueDate) flowsAfterValue += m.amount;
    } else if (m.kind === 'sell') {
      withdrawn += m.amount - fee;
      if (inv.mode === 'units') {
        const out = held > 0 ? cost * Math.min(1, (m.units || 0) / held) : 0;
        realized += m.amount - fee - out;
        cost -= out;
        held = Math.max(0, held - (m.units || 0));
        lastPrice = m.price;
      } else {
        cost = Math.max(0, cost - m.amount);
      }
      if (inv.valueDate && m.date > inv.valueDate) flowsAfterValue -= m.amount;
    } else {
      income += m.amount - fee;
    }
  }
  if (held < 1e-9) held = 0;
  let value;
  if (inv.mode === 'units') {
    const p = inv.price != null ? inv.price : lastPrice;
    value = p != null ? held * p : cost;
  } else {
    value = inv.value != null ? Math.max(0, inv.value + flowsAfterValue) : Math.max(0, contributed - withdrawn);
  }
  if (inv.mode === 'units' && held === 0) value = 0;
  const gain = value + withdrawn + income - contributed;
  const closed = inv.mode === 'units' ? held === 0 && contributed > 0 : value < 0.005 && contributed > 0;
  return {
    held, cost, contributed, withdrawn, income, realized, value, gain, closed,
    pct: contributed > 0 ? gain / contributed : 0,
    avg: held > 0 ? cost / held : null,
    unrealized: value - cost,
  };
}

function portfolio() {
  const rows = state.investments.map((inv) => ({ inv, c: calc(inv) }));
  const tot = { value: 0, contributed: 0, withdrawn: 0, income: 0, gain: 0 };
  for (const r of rows) for (const k in tot) tot[k] += r.c[k];
  tot.pct = tot.contributed > 0 ? tot.gain / tot.contributed : 0;
  return { rows, tot };
}

function lastUpdate(inv) { return inv.mode === 'units' ? inv.priceDate : inv.valueDate; }

// ---------- Interfaz común ----------

const $ = (sel, root) => (root || document).querySelector(sel);
const view = $('#view');

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

const ICON_PLUS = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>';
const ICON_EDIT = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17.2V20h2.8l8.3-8.3-2.8-2.8L4 17.2zm13.7-7.5a1 1 0 0 0 0-1.4l-2-2a1 1 0 0 0-1.4 0l-1.6 1.6 2.8 2.8 1.6-1.6z"/></svg>';

function setChrome({ title, tab, back, action }) {
  $('#title').textContent = title;
  document.title = title === 'Mis inversiones' ? title : title + ' · Mis inversiones';
  $('#back-btn').hidden = !back;
  $('#back-btn').dataset.to = back || '';
  $('#actions').innerHTML = action
    ? '<a class="icon-btn" href="' + action.href + '" aria-label="' + esc(action.label) + '">' + action.icon + '</a>'
    : '';
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

$('#back-btn').addEventListener('click', () => {
  location.hash = $('#back-btn').dataset.to;
});

function go(hash) { location.hash = hash; }

// ---------- Pantalla: Resumen ----------

function renderHome() {
  setChrome({ title: 'Mis inversiones', tab: 'home', action: { href: '#/inv/nueva', label: 'Añadir inversión', icon: ICON_PLUS } });
  if (!state.investments.length) {
    view.innerHTML = `
      <div class="card empty">
        <p><strong>Aún no has apuntado ninguna inversión.</strong></p>
        <p>Apunta cada inversión (acciones, fondos, depósitos…) y sus compras, ventas y dividendos. La app calcula cuánto vale tu cartera y cuánto ganas o pierdes.</p>
        <a class="btn" href="#/inv/nueva">Añadir mi primera inversión</a>
        <p></p>
        <button class="btn secondary" type="button" id="demo">Probar con datos de ejemplo</button>
      </div>`;
    $('#demo').addEventListener('click', loadDemo);
    return;
  }
  const { rows, tot } = portfolio();

  // Reparto por tipo, en el orden fijo de TYPES para que cada tipo conserve su color
  const byType = TYPES.map((t) => ({ t, v: rows.filter((r) => r.inv.type === t.id).reduce((s, r) => s + r.c.value, 0) }))
    .filter((x) => x.v > 0.005);
  const byPlat = {};
  for (const r of rows) {
    if (r.c.value <= 0.005) continue;
    const k = r.inv.platform || 'Sin plataforma';
    byPlat[k] = (byPlat[k] || 0) + r.c.value;
  }
  const plats = Object.entries(byPlat).sort((a, b) => b[1] - a[1]);
  const share = (v) => (tot.value > 0 ? v / tot.value : 0);

  const stale = rows.filter((r) => !r.c.closed && (!lastUpdate(r.inv) || daysSince(lastUpdate(r.inv)) > STALE_DAYS));
  const top = rows.filter((r) => !r.c.closed).sort((a, b) => b.c.value - a.c.value).slice(0, 5);

  view.innerHTML = `
    <section class="card hero">
      <div class="label">Valor de tu cartera</div>
      <div class="big num">${money(tot.value)}</div>
      <div class="delta num ${cls(tot.gain)}">${arrow(tot.gain)}${signed(tot.gain)} (${signed(tot.pct, pct)}) en total</div>
      <div class="stats">
        <div class="stat"><div class="k">Dinero aportado</div><div class="v">${money(tot.contributed)}</div></div>
        <div class="stat"><div class="k">Dinero retirado</div><div class="v">${money(tot.withdrawn)}</div></div>
        <div class="stat"><div class="k">Dividendos e intereses</div><div class="v">${money(tot.income)}</div></div>
        <div class="stat"><div class="k">Inversiones abiertas</div><div class="v">${rows.filter((r) => !r.c.closed).length}</div></div>
      </div>
    </section>

    ${stale.length ? `<p class="note">⚠︎ ${stale.length === 1 ? 'Hay 1 inversión' : 'Hay ' + stale.length + ' inversiones'} sin actualizar el precio desde hace más de ${STALE_DAYS} días: el valor puede no ser el real.</p>` : ''}

    ${byType.length ? `
    <section class="card">
      <h2>Reparto por tipo</h2>
      <div class="stack" role="img" aria-label="Reparto del valor por tipo de inversión">
        ${byType.map((x) => `<span style="flex:${x.v};background:${typeColor(x.t.id)}" title="${esc(x.t.name)}: ${money(x.v)} (${pct(share(x.v))})"></span>`).join('')}
      </div>
      <ul class="legend">
        ${byType.map((x) => `<li><span class="sw" style="background:${typeColor(x.t.id)}"></span><span>${esc(x.t.name)}</span><span class="amt">${money(x.v)}</span><span class="pct">${pct(share(x.v))}</span></li>`).join('')}
      </ul>
    </section>` : ''}

    ${plats.length > 1 ? `
    <section class="card">
      <h2>Por plataforma o banco</h2>
      <ul class="legend">
        ${plats.map(([k, v]) => `<li><span></span><span>${esc(k)}</span><span class="amt">${money(v)}</span><span class="pct">${pct(share(v))}</span></li>`).join('')}
      </ul>
    </section>` : ''}

    <h2 class="section-title">Tus inversiones más grandes</h2>
    <div class="list">${top.map(invRow).join('')}</div>
    <a class="btn secondary" href="#/inversiones">Ver todas</a>`;
}

function invRow({ inv, c }) {
  const sub = [typeOf(inv.type).name, inv.platform].filter(Boolean).join(' · ');
  return `
    <a class="row" href="#/inv/${inv.id}">
      <span class="dot" style="background:${typeColor(inv.type)}"></span>
      <span class="main"><div class="t">${esc(inv.name)}</div><div class="s">${esc(sub)}</div></span>
      <span class="end">
        <div class="num">${money(c.value)}</div>
        <div class="s num ${cls(c.gain)}">${c.contributed > 0 ? signed(c.gain) + ' · ' + signed(c.pct, pct) : ''}</div>
      </span>
    </a>`;
}

// ---------- Pantalla: Inversiones ----------

function renderList() {
  setChrome({ title: 'Inversiones', tab: 'invs', action: { href: '#/inv/nueva', label: 'Añadir inversión', icon: ICON_PLUS } });
  const { rows } = portfolio();
  if (!rows.length) {
    view.innerHTML = `<div class="card empty"><p>Aún no hay inversiones.</p><a class="btn" href="#/inv/nueva">Añadir inversión</a></div>`;
    return;
  }
  const open = rows.filter((r) => !r.c.closed).sort((a, b) => b.c.value - a.c.value);
  const closed = rows.filter((r) => r.c.closed).sort((a, b) => a.inv.name.localeCompare(b.inv.name, 'es'));
  view.innerHTML = `
    ${open.length ? `<div class="list">${open.map(invRow).join('')}</div>` : ''}
    ${closed.length ? `<h2 class="section-title">Cerradas (ya vendidas o retiradas)</h2><div class="list">${closed.map(invRow).join('')}</div>` : ''}
    <a class="btn" href="#/inv/nueva">${ICON_PLUS} Añadir inversión</a>`;
}

// ---------- Pantalla: detalle de una inversión ----------

function renderDetail(id) {
  const inv = invById(id);
  if (!inv) return go('#/inversiones');
  setChrome({ title: inv.name, tab: 'invs', back: '#/inversiones', action: { href: '#/inv/' + id + '/editar', label: 'Editar inversión', icon: ICON_EDIT } });
  const c = calc(inv);
  const ms = movesOf(id).reverse();
  const u = lastUpdate(inv);
  const unitsMode = inv.mode === 'units';
  const sub = [typeOf(inv.type).name, inv.ticker, inv.platform].filter(Boolean).join(' · ');

  view.innerHTML = `
    <section class="card hero">
      <div class="label">${esc(sub)}</div>
      <div class="big num">${money(c.value)}</div>
      <div class="delta num ${cls(c.gain)}">${arrow(c.gain)}${signed(c.gain)} (${signed(c.pct, pct)}) en total</div>
      <div class="stats">
        ${unitsMode ? `
          <div class="stat"><div class="k">Participaciones</div><div class="v">${units(c.held)}</div></div>
          <div class="stat"><div class="k">Precio actual</div><div class="v">${inv.price != null ? price(inv.price) : '—'}</div></div>
          <div class="stat"><div class="k">Precio medio de compra</div><div class="v">${c.avg != null ? price(c.avg) : '—'}</div></div>
          <div class="stat"><div class="k">Ganancia sin vender</div><div class="v ${cls(c.unrealized)}">${c.held > 0 ? signed(c.unrealized) : '—'}</div></div>
          <div class="stat"><div class="k">Ganancia ya vendida</div><div class="v ${cls(c.realized)}">${signed(c.realized)}</div></div>` : ''}
        <div class="stat"><div class="k">Dinero aportado</div><div class="v">${money(c.contributed)}</div></div>
        <div class="stat"><div class="k">Dinero retirado</div><div class="v">${money(c.withdrawn)}</div></div>
        <div class="stat"><div class="k">${inv.type === 'depositos' || inv.type === 'rentafija' ? 'Intereses' : 'Dividendos e intereses'}</div><div class="v">${money(c.income)}</div></div>
        <div class="stat"><div class="k">${unitsMode ? 'Precio actualizado' : 'Valor actualizado'}</div><div class="v">${u ? fmtDate(u) : 'Nunca'}</div></div>
      </div>
    </section>

    <div class="btn-row">
      <a class="btn" href="#/mov/nuevo?inv=${id}">${ICON_PLUS} Movimiento</a>
      <a class="btn secondary" href="#/inv/${id}/valor">${unitsMode ? 'Actualizar precio' : 'Actualizar valor'}</a>
    </div>

    ${inv.notes ? `<p class="note">${esc(inv.notes)}</p>` : ''}

    <h2 class="section-title">Movimientos</h2>
    ${ms.length ? `<div class="list">${ms.map((m) => moveRow(m, false)).join('')}</div>`
      : `<div class="card empty"><p>Todavía no hay movimientos. Apunta la primera ${unitsMode ? 'compra' : 'aportación'}.</p></div>`}`;
}

function moveRow(m, showInv) {
  const inv = invById(m.invId);
  const name = kindName(m.kind, inv);
  const sign = m.kind === 'buy' ? '−' : '+';
  const net = m.kind === 'buy' ? m.amount + (m.fee || 0) : m.amount - (m.fee || 0);
  let detail = fmtDate(m.date);
  if (inv && inv.mode === 'units' && m.kind !== 'income' && m.units) detail += ' · ' + units(m.units) + ' × ' + price(m.price);
  const letter = { buy: m.kind === 'buy' && inv && inv.mode === 'units' ? 'C' : 'A', sell: inv && inv.mode === 'units' ? 'V' : 'R', income: '+' }[m.kind];
  return `
    <a class="row" href="#/mov/${m.id}">
      <span class="badge ${m.kind}" aria-hidden="true">${letter}</span>
      <span class="main"><div class="t">${showInv && inv ? esc(inv.name) : esc(name)}</div><div class="s">${showInv ? esc(name) + ' · ' : ''}${esc(detail)}</div></span>
      <span class="end"><div class="num ${m.kind === 'income' ? 'good' : ''}">${sign}${money(net)}</div>${m.note ? `<div class="s">${esc(m.note)}</div>` : ''}</span>
    </a>`;
}

// ---------- Formulario: inversión ----------

function renderInvForm(id) {
  const inv = id ? invById(id) : null;
  if (id && !inv) return go('#/inversiones');
  const hasMoves = inv && state.moves.some((m) => m.invId === id);
  setChrome({ title: inv ? 'Editar inversión' : 'Nueva inversión', tab: 'invs', back: inv ? '#/inv/' + id : '#/inversiones' });
  const t = inv ? inv.type : 'acciones';
  const mode = inv ? inv.mode : typeOf(t).mode;
  const plats = [...new Set(state.investments.map((i) => i.platform).filter(Boolean))];

  view.innerHTML = `
    <form class="form card" id="f" novalidate>
      <label class="field"><span>Nombre</span>
        <input name="name" required maxlength="80" placeholder="Ej.: Apple, Fondo indexado MSCI World…" value="${esc(inv ? inv.name : '')}"></label>
      <label class="field"><span>Tipo</span>
        <select name="type">${TYPES.map((x) => `<option value="${x.id}" ${x.id === t ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <div class="field"><span>¿Cómo la apuntas?</span>
        <div class="seg">
          <label><input type="radio" name="mode" value="units" ${mode === 'units' ? 'checked' : ''} ${hasMoves ? 'disabled' : ''}><span>Participaciones</span></label>
          <label><input type="radio" name="mode" value="amount" ${mode === 'amount' ? 'checked' : ''} ${hasMoves ? 'disabled' : ''}><span>Solo importe</span></label>
        </div>
        <small>${hasMoves ? 'No se puede cambiar porque ya tiene movimientos.' : '<b>Participaciones</b>: acciones, fondos, cripto… (cantidad × precio). <b>Solo importe</b>: depósitos, cuentas, inmuebles… (apuntas euros y el valor actual).'}</small>
      </div>
      <div class="two">
        <label class="field"><span>Plataforma o banco</span>
          <input name="platform" maxlength="40" list="plats" placeholder="Opcional" value="${esc(inv ? inv.platform : '')}"></label>
        <label class="field"><span>Ticker o ISIN</span>
          <input name="ticker" maxlength="20" autocapitalize="characters" placeholder="Opcional" value="${esc(inv ? inv.ticker : '')}"></label>
      </div>
      <datalist id="plats">${plats.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
      <label class="field"><span>Notas</span>
        <textarea name="notes" maxlength="500" placeholder="Opcional">${esc(inv ? inv.notes : '')}</textarea></label>
      <button class="btn" type="submit">${inv ? 'Guardar cambios' : 'Crear y apuntar la primera compra'}</button>
      ${inv ? '<button class="btn danger" type="button" id="del">Borrar inversión</button>' : ''}
    </form>`;

  const f = $('#f');
  // Al cambiar el tipo, propone la forma de apuntarla
  f.elements.type.addEventListener('change', () => {
    if (hasMoves) return;
    const m = typeOf(f.elements.type.value).mode;
    for (const r of f.querySelectorAll('[name=mode]')) r.checked = r.value === m;
  });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = f.elements.name.value.trim();
    if (!name) { toast('Ponle un nombre'); f.elements.name.focus(); return; }
    const data = {
      name,
      type: f.elements.type.value,
      platform: f.elements.platform.value.trim(),
      ticker: f.elements.ticker.value.trim().toUpperCase(),
      notes: f.elements.notes.value.trim(),
    };
    if (!hasMoves) data.mode = f.querySelector('[name=mode]:checked').value;
    if (inv) {
      Object.assign(inv, data);
      saveState();
      toast('Guardado');
      location.replace('#/inv/' + inv.id);
    } else {
      const n = Object.assign({ id: uid(), price: null, priceDate: null, value: null, valueDate: null, created: Date.now() }, data);
      state.investments.push(n);
      saveState();
      location.replace('#/mov/nuevo?inv=' + n.id + '&primera=1');
    }
  });
  if (inv) {
    $('#del').addEventListener('click', () => {
      const n = state.moves.filter((m) => m.invId === id).length;
      if (!confirm('¿Borrar «' + inv.name + '»' + (n ? ' y sus ' + n + ' movimientos' : '') + '? No se puede deshacer.')) return;
      state.investments = state.investments.filter((i) => i.id !== id);
      state.moves = state.moves.filter((m) => m.invId !== id);
      saveState();
      toast('Inversión borrada');
      location.replace('#/inversiones');
    });
  }
}

// ---------- Formulario: actualizar precio o valor ----------

function renderValueForm(id) {
  const inv = invById(id);
  if (!inv) return go('#/inversiones');
  const unitsMode = inv.mode === 'units';
  setChrome({ title: unitsMode ? 'Actualizar precio' : 'Actualizar valor', tab: 'invs', back: '#/inv/' + id });
  const c = calc(inv);
  const cur = unitsMode ? inv.price : (inv.value != null ? c.value : null);
  view.innerHTML = `
    <form class="form card" id="f" novalidate>
      <p class="note" style="margin:0"><strong>${esc(inv.name)}</strong>${unitsMode ? ` · tienes ${units(c.held)} participaciones` : ''}</p>
      <label class="field"><span>${unitsMode ? 'Precio actual de cada participación' : 'Cuánto vale hoy en total'}</span>
        <input name="v" inputmode="decimal" autocomplete="off" required value="${numIn(cur)}" placeholder="0,00"></label>
      <div class="calc" id="calc"></div>
      <label class="field"><span>Fecha</span><input type="date" name="date" value="${todayKey()}" max="${todayKey()}"></label>
      <small class="note" style="margin:0">${unitsMode ? 'Lo encuentras en la app de tu bróker o buscando el ticker o ISIN.' : 'Mira el saldo o la valoración en tu banco o plataforma.'}</small>
      <button class="btn" type="submit">Guardar</button>
    </form>`;
  const f = $('#f');
  const upd = () => {
    const v = parseNum(f.elements.v.value);
    $('#calc').textContent = unitsMode && v >= 0 ? 'Valor de lo que tienes: ' + money(v * c.held) : '';
  };
  f.elements.v.addEventListener('input', upd);
  upd();
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = parseNum(f.elements.v.value);
    if (!(v >= 0)) { toast('Escribe un número válido'); f.elements.v.focus(); return; }
    const d = f.elements.date.value || todayKey();
    if (unitsMode) { inv.price = v; inv.priceDate = d; }
    else { inv.value = v; inv.valueDate = d; }
    saveState();
    toast('Actualizado');
    location.replace('#/inv/' + id);
  });
}

// ---------- Formulario: movimiento ----------

function renderMoveForm(id, params) {
  const m = id ? state.moves.find((x) => x.id === id) : null;
  if (id && !m) return go('#/movimientos');
  if (!state.investments.length) return go('#/inv/nueva');
  const presetInv = m ? m.invId : params.get('inv');
  const first = params.get('primera') === '1';
  const back = presetInv ? '#/inv/' + presetInv : '#/movimientos';
  setChrome({ title: m ? 'Editar movimiento' : first ? 'Primera compra' : 'Nuevo movimiento', tab: presetInv ? 'invs' : 'moves', back });

  const sorted = state.investments.slice().sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const invId = presetInv || sorted[0].id;
  const kind = m ? m.kind : params.get('kind') || 'buy';

  view.innerHTML = `
    ${first ? '<p class="note">Inversión creada. Ahora apunta la primera compra o aportación (o vuelve atrás y hazlo luego).</p>' : ''}
    <form class="form card" id="f" novalidate>
      <label class="field" ${presetInv ? 'hidden' : ''}><span>Inversión</span>
        <select name="inv">${sorted.map((i) => `<option value="${i.id}" ${i.id === invId ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select></label>
      <div class="field"><span>Qué ha pasado</span>
        <div class="seg" id="kinds"></div></div>
      <label class="field"><span>Fecha</span><input type="date" name="date" required value="${m ? m.date : todayKey()}"></label>
      <div class="two" id="unitsBox">
        <label class="field"><span>Participaciones</span><input name="units" inputmode="decimal" autocomplete="off" placeholder="0" value="${m ? numIn(m.units) : ''}"></label>
        <label class="field"><span>Precio de cada una</span><input name="price" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${m ? numIn(m.price) : ''}"></label>
      </div>
      <label class="field" id="amountBox"><span id="amountLabel">Importe</span><input name="amount" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${m ? numIn(m.amount) : ''}"></label>
      <label class="field"><span id="feeLabel">Comisiones y gastos</span><input name="fee" inputmode="decimal" autocomplete="off" placeholder="0,00" value="${m && m.fee ? numIn(m.fee) : ''}"></label>
      <div class="calc" id="calc"></div>
      <label class="field"><span>Nota</span><input name="note" maxlength="80" placeholder="Opcional" value="${esc(m ? m.note : '')}"></label>
      <button class="btn" type="submit">${m ? 'Guardar cambios' : 'Guardar movimiento'}</button>
      ${m ? '<button class="btn danger" type="button" id="del">Borrar movimiento</button>' : ''}
    </form>`;

  const f = $('#f');
  let curKind = kind;
  const curInv = () => invById(f.elements.inv.value);
  const usesUnits = () => curInv().mode === 'units' && curKind !== 'income';

  function drawKinds() {
    const inv = curInv();
    $('#kinds').innerHTML = ['buy', 'sell', 'income'].map((k) =>
      `<label><input type="radio" name="kind" value="${k}" ${k === curKind ? 'checked' : ''}><span>${esc(kindName(k, inv).replace(' / interés', ''))}</span></label>`).join('');
  }
  function layout() {
    const u = usesUnits();
    $('#unitsBox').hidden = !u;
    $('#amountBox').hidden = u;
    $('#amountLabel').textContent = curKind === 'income' ? 'Importe cobrado (bruto)' : curKind === 'buy' ? 'Importe aportado' : 'Importe retirado';
    $('#feeLabel').textContent = curKind === 'income' ? 'Retención de impuestos' : 'Comisiones y gastos';
    recalc();
  }
  function recalc() {
    const fee = parseNum(f.elements.fee.value) || 0;
    let amount;
    if (usesUnits()) {
      const q = parseNum(f.elements.units.value), p = parseNum(f.elements.price.value);
      amount = q > 0 && p >= 0 ? q * p : NaN;
    } else amount = parseNum(f.elements.amount.value);
    if (!(amount >= 0)) { $('#calc').textContent = ''; return; }
    const txt = curKind === 'buy' ? 'Te cuesta en total: ' + money(amount + fee)
      : curKind === 'sell' ? 'Recibes en total: ' + money(amount - fee)
      : 'Cobras en limpio: ' + money(amount - fee);
    $('#calc').textContent = txt;
  }
  drawKinds();
  layout();
  f.elements.inv.addEventListener('change', () => { drawKinds(); layout(); });
  $('#kinds').addEventListener('change', (e) => { curKind = e.target.value; layout(); });
  for (const n of ['units', 'price', 'amount', 'fee']) f.elements[n].addEventListener('input', recalc);

  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const inv = curInv();
    const date = f.elements.date.value;
    if (!date) { toast('Pon la fecha'); return; }
    const fee = f.elements.fee.value.trim() ? parseNum(f.elements.fee.value) : 0;
    if (!(fee >= 0)) { toast('Las comisiones no son un número válido'); f.elements.fee.focus(); return; }
    const data = { invId: inv.id, kind: curKind, date, fee, note: f.elements.note.value.trim(), units: null, price: null };
    if (usesUnits()) {
      const q = parseNum(f.elements.units.value), p = parseNum(f.elements.price.value);
      if (!(q > 0)) { toast('Escribe cuántas participaciones'); f.elements.units.focus(); return; }
      if (!(p >= 0)) { toast('Escribe el precio de cada una'); f.elements.price.focus(); return; }
      if (curKind === 'sell') {
        // No se puede vender más de lo que se tenía en esa fecha
        const others = state.moves.filter((x) => x.invId === inv.id && (!m || x.id !== m.id) && x.date <= date && x.kind !== 'income');
        const had = others.reduce((s, x) => s + (x.kind === 'buy' ? x.units || 0 : -(x.units || 0)), 0);
        if (q > had + 1e-9) { toast('En esa fecha solo tenías ' + units(Math.max(0, had)) + ' participaciones'); f.elements.units.focus(); return; }
      }
      Object.assign(data, { units: q, price: p, amount: q * p });
    } else {
      const a = parseNum(f.elements.amount.value);
      if (!(a > 0)) { toast('Escribe el importe'); f.elements.amount.focus(); return; }
      data.amount = a;
    }
    if (m) Object.assign(m, data);
    else state.moves.push(Object.assign({ id: uid(), created: Date.now() }, data));
    // Si no hay un precio más reciente, el precio de esta operación pasa a ser el precio actual
    if (data.price != null && (!inv.priceDate || date >= inv.priceDate)) { inv.price = data.price; inv.priceDate = date; }
    saveState();
    toast(m ? 'Guardado' : 'Movimiento apuntado');
    if (presetInv) location.replace('#/inv/' + inv.id);
    else location.replace('#/movimientos');
  });

  if (m) {
    $('#del').addEventListener('click', () => {
      if (!confirm('¿Borrar este movimiento? No se puede deshacer.')) return;
      state.moves = state.moves.filter((x) => x.id !== m.id);
      saveState();
      toast('Movimiento borrado');
      location.replace(back);
    });
  }
}

// ---------- Pantalla: Movimientos ----------

let moveYear = 'all';

function renderMoves() {
  setChrome({ title: 'Movimientos', tab: 'moves', action: state.investments.length ? { href: '#/mov/nuevo', label: 'Añadir movimiento', icon: ICON_PLUS } : null });
  if (!state.moves.length) {
    view.innerHTML = `<div class="card empty"><p>Aún no hay movimientos.</p>${state.investments.length
      ? '<a class="btn" href="#/mov/nuevo">Apuntar un movimiento</a>' : '<a class="btn" href="#/inv/nueva">Añadir una inversión</a>'}</div>`;
    return;
  }
  const years = [...new Set(state.moves.map((m) => m.date.slice(0, 4)))].sort().reverse();
  if (moveYear !== 'all' && !years.includes(moveYear)) moveYear = 'all';
  const list = state.moves.filter((m) => moveYear === 'all' || m.date.startsWith(moveYear)).sort(byDate).reverse();
  const sum = { buy: 0, sell: 0, income: 0 };
  for (const m of list) sum[m.kind] += m.kind === 'buy' ? m.amount + (m.fee || 0) : m.amount - (m.fee || 0);

  let html = '', month = '', open = false;
  for (const m of list) {
    const k = m.date.slice(0, 7);
    if (k !== month) {
      if (open) html += '</div>';
      html += `<div class="month">${esc(fmtMonth(k + '-01'))}</div><div class="list">`;
      month = k; open = true;
    }
    html += moveRow(m, true);
  }
  if (open) html += '</div>';

  view.innerHTML = `
    <div class="chips" role="group" aria-label="Año">
      <button type="button" data-y="all" aria-pressed="${moveYear === 'all'}">Todos</button>
      ${years.map((y) => `<button type="button" data-y="${y}" aria-pressed="${moveYear === y}">${y}</button>`).join('')}
    </div>
    <section class="card">
      <h2>${moveYear === 'all' ? 'Desde el principio' : 'En ' + moveYear}</h2>
      <div class="stats" style="margin:0;padding:0;border:0;grid-template-columns:repeat(3,minmax(0,1fr))">
        <div class="stat"><div class="k">Comprado</div><div class="v">${money(sum.buy)}</div></div>
        <div class="stat"><div class="k">Vendido</div><div class="v">${money(sum.sell)}</div></div>
        <div class="stat"><div class="k">Cobrado</div><div class="v">${money(sum.income)}</div></div>
      </div>
    </section>
    ${html}`;
  for (const b of view.querySelectorAll('.chips button')) {
    b.addEventListener('click', () => { moveYear = b.dataset.y; renderMoves(); });
  }
}

// ---------- Pantalla: Ajustes ----------

function renderSettings() {
  setChrome({ title: 'Ajustes', tab: 'settings' });
  view.innerHTML = `
    <section class="card form">
      <label class="field"><span>Moneda</span>
        <select id="cur">${CURRENCIES.map((c) => `<option ${c === state.currency ? 'selected' : ''}>${c}</option>`).join('')}</select>
        <small>Solo cambia cómo se muestran los importes; no convierte nada.</small></label>
    </section>

    <h2 class="section-title">Copia de seguridad</h2>
    <p class="note">Tus datos se guardan solo en este teléfono. Haz una copia de vez en cuando (por ejemplo, guárdala en Archivos o en iCloud) por si cambias de móvil o borras Safari.</p>
    <section class="card form">
      <button class="btn" type="button" id="exp">Guardar copia de seguridad</button>
      <button class="btn secondary" type="button" id="imp-btn">Recuperar desde una copia</button>
      <input type="file" id="imp" accept="application/json,.json" hidden>
      <button class="btn secondary" type="button" id="csv">Exportar movimientos a Excel (CSV)</button>
    </section>

    <section class="card form">
      <button class="btn danger" type="button" id="wipe">Borrar todos los datos</button>
    </section>
    <p class="note">${state.investments.length} inversiones · ${state.moves.length} movimientos</p>`;

  $('#cur').addEventListener('change', (e) => { state.currency = e.target.value; saveState(); toast('Moneda cambiada'); });
  $('#exp').addEventListener('click', () => {
    shareFile('inversiones-' + todayKey() + '.json', JSON.stringify(Object.assign({ app: 'mis-inversiones', exported: new Date().toISOString() }, state), null, 2), 'application/json');
  });
  $('#imp-btn').addEventListener('click', () => $('#imp').click());
  $('#imp').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.investments) || !Array.isArray(data.moves)) throw new Error('formato');
      if (!confirm('Se cambiarán los datos actuales por los de la copia (' + data.investments.length + ' inversiones, ' + data.moves.length + ' movimientos). ¿Seguir?')) return;
      state = Object.assign(freshState(), { currency: data.currency || 'EUR', investments: data.investments, moves: data.moves });
      saveState();
      toast('Copia recuperada');
      renderSettings();
    } catch (err) {
      toast('Ese archivo no es una copia válida');
    }
  });
  $('#csv').addEventListener('click', () => {
    const q = (s) => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
    const n = (x) => (x == null ? '' : String(x).replace('.', ','));
    const lines = [['Fecha', 'Inversión', 'Tipo', 'Plataforma', 'Movimiento', 'Participaciones', 'Precio', 'Importe', 'Comisión o retención', 'Nota'].map(q).join(';')];
    for (const m of state.moves.slice().sort(byDate)) {
      const inv = invById(m.invId) || {};
      lines.push([q(m.date), q(inv.name), q(typeOf(inv.type).name), q(inv.platform), q(kindName(m.kind, inv)), n(m.units), n(m.price), n(m.amount), n(m.fee || 0), q(m.note)].join(';'));
    }
    shareFile('movimientos-' + todayKey() + '.csv', '﻿' + lines.join('\r\n'), 'text/csv');
  });
  $('#wipe').addEventListener('click', () => {
    if (!confirm('¿Borrar todas las inversiones y movimientos de este teléfono? No se puede deshacer.')) return;
    state = freshState();
    saveState();
    toast('Datos borrados');
    go('#/');
  });
}

// En el iPhone abre el menú de compartir (Guardar en Archivos, AirDrop…); si no, descarga el archivo
async function shareFile(name, text, type) {
  const file = new File([text], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ---------- Datos de ejemplo ----------

function loadDemo() {
  const y = new Date().getFullYear();
  const d = (yy, mm, dd) => yy + '-' + pad(mm) + '-' + pad(dd);
  const inv = (name, type, mode, platform, ticker, extra) =>
    Object.assign({ id: uid(), name, type, mode, platform, ticker, notes: '', price: null, priceDate: null, value: null, valueDate: null, created: Date.now() }, extra);
  const a = inv('Fondo indexado MSCI World', 'fondos', 'units', 'MyInvestor', 'IE00B03HCZ61', { price: 41.85, priceDate: todayKey() });
  const b = inv('Iberdrola', 'acciones', 'units', 'Interactive Brokers', 'IBE', { price: 16.2, priceDate: todayKey() });
  const c = inv('ETF S&P 500', 'etf', 'units', 'Interactive Brokers', 'CSPX', { price: 612.4, priceDate: todayKey() });
  const e = inv('Depósito a 12 meses', 'depositos', 'amount', 'Banco', '', { value: 5120, valueDate: todayKey() });
  const f = inv('Bitcoin', 'cripto', 'units', 'Exchange', 'BTC', { price: 88000, priceDate: todayKey() });
  state.investments.push(a, b, c, e, f);
  const mv = (i, kind, date, q, p, amount, fee, note) =>
    state.moves.push({ id: uid(), created: Date.now(), invId: i.id, kind, date, units: q, price: p, amount: amount != null ? amount : q * p, fee: fee || 0, note: note || '' });
  mv(a, 'buy', d(y - 1, 1, 10), 60, 33.1, null);
  mv(a, 'buy', d(y - 1, 7, 10), 55, 35.4, null);
  mv(a, 'buy', d(y, 1, 10), 50, 38.9, null);
  mv(b, 'buy', d(y - 1, 3, 4), 200, 12.4, null, 4);
  mv(b, 'income', d(y - 1, 7, 30), null, null, 46, 8.74, 'Dividendo');
  mv(b, 'income', d(y, 1, 31), null, null, 46, 8.74, 'Dividendo');
  mv(b, 'sell', d(y, 4, 15), 50, 15.1, null, 4);
  mv(c, 'buy', d(y - 1, 5, 2), 6, 520, null, 2);
  mv(c, 'buy', d(y, 2, 3), 4, 575, null, 2);
  mv(e, 'buy', d(y, 1, 15), null, null, 5000);
  mv(f, 'buy', d(y - 1, 11, 20), 0.02, 78000, null, 3);
  saveState();
  toast('Datos de ejemplo cargados. Bórralos en Ajustes cuando quieras.');
  render();
}

// ---------- Navegación ----------

function render() {
  const [path, query] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(query || '');
  const p = path.split('/').filter(Boolean);
  if (!p.length) renderHome();
  else if (p[0] === 'inversiones') renderList();
  else if (p[0] === 'movimientos') renderMoves();
  else if (p[0] === 'ajustes') renderSettings();
  else if (p[0] === 'inv' && p[1] === 'nueva') renderInvForm(null);
  else if (p[0] === 'inv' && p[2] === 'editar') renderInvForm(p[1]);
  else if (p[0] === 'inv' && p[2] === 'valor') renderValueForm(p[1]);
  else if (p[0] === 'inv' && p[1]) renderDetail(p[1]);
  else if (p[0] === 'mov' && p[1] === 'nuevo') renderMoveForm(null, params);
  else if (p[0] === 'mov' && p[1]) renderMoveForm(p[1], params);
  else renderHome();
  window.scrollTo(0, 0);
  view.focus({ preventScroll: true });
}

window.addEventListener('hashchange', render);
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
