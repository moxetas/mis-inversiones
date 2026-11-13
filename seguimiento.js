'use strict';

// Seguimiento: activos que tienes en el punto de mira (sin haberlos comprado). Precio en directo de TradingView,
// su logo, cuánto han subido desde que los sigues y sus noticias en la pestaña Noticias.
// Usa funciones de app.js (state, tvQuotes, logoHtml…) y retos.js (searchAssets).

let watchTimer = null, watchSearchT = null;

function watchList() { return state.watch || (state.watch = []); }
// Para el logo, las noticias y el gráfico, cada activo seguido se trata como una inversión «de mentira»
function watchInv(w) { return { id: 'w-' + w.id, name: w.n, logo: w.l, ticker: w.t || '', type: w.k || 'accion', mode: 'units', priceSource: w.s, tv: w.s, currency: w.c }; }
const wpct = (a, b) => (a > 0 && b > 0 ? (b / a - 1) * 100 : null);

async function refreshWatch(rerender) {
  const list = watchList();
  if (!list.length || !navigator.onLine) return;
  let quotes = {};
  try { quotes = (await tvQuotes(list.map((w) => w.s))).quotes; } catch (e) { return; }
  let changed = false;
  for (const w of list) {
    const q = quotes[w.s];
    if (!q) continue;
    w.p = q.close; w.at = Date.now(); changed = true;
    if (typeof q.change === 'number') w.chg = q.change;
    if (q.logo && !w.l) w.l = q.logo;
    if (!(w.p0 > 0)) w.p0 = q.close;
  }
  if (changed) { saveState(); if (rerender) rerender(); }
}

function watchRow(w) {
  const since = wpct(w.p0, w.p), fresh = w.at && Date.now() - w.at < 36 * 3600e3;
  return `
    <a class="row" href="#/seg/${esc(w.id)}">
      ${logoHtml(watchInv(w), 40)}
      <span class="main"><div class="t">${esc(w.n)}</div><div class="s">${esc(w.s)}</div></span>
      <span class="end">
        <div class="num">${w.p ? esc(price(w.p, w.c || undefined)) : '—'}</div>
        ${metrics([
          fresh && typeof w.chg === 'number' ? ['24h', pct2(w.chg), dcls(w.chg)] : null,
          since != null ? ['Desde', pct2(since), dcls(since)] : null,
        ])}
      </span>
    </a>`;
}

function renderWatch() {
  setChrome({ title: 'Seguimiento', tab: 'watch' });
  const list = watchList().slice().sort((a, b) => (wpct(b.p0, b.p) ?? -1e9) - (wpct(a.p0, a.p) ?? -1e9));
  view.innerHTML = `
    <section class="card form">
      <label class="field"><span>Añadir un activo al seguimiento</span><input id="w-q" type="search" autocomplete="off" placeholder="Nombre, ticker o ISIN (Nvidia, PLTR, Solana…)"></label>
      <div id="w-res"></div>
    </section>
    ${list.length ? `<h2 class="section-title">En el punto de mira (${list.length})</h2><div class="list">${list.map(watchRow).join('')}</div>
      <p class="note">Precios de TradingView en directo. «Desde» es lo que ha subido o bajado desde el día que empezaste a seguirlo. Sus noticias salen en la pestaña Noticias.</p>`
      : `<div class="card empty"><p><b>Aún no sigues ningún activo.</b></p><p>Busca arriba las acciones, ETF o criptos que tengas en el punto de mira: verás su precio en directo, su gráfico y sus noticias, sin mezclarlos con tu cartera.</p></div>`}`;
  const q = $('#w-q');
  q.addEventListener('input', () => {
    clearTimeout(watchSearchT);
    const v = q.value.trim();
    if (v.length < 2) { $('#w-res').innerHTML = ''; return; }
    watchSearchT = setTimeout(async () => {
      $('#w-res').innerHTML = '<p class="s">Buscando en TradingView…</p>';
      let res = [];
      try { res = await searchAssets(v); } catch (e) { /* sin conexión */ }
      if (q.value.trim() !== v) return;
      $('#w-res').innerHTML = res.length ? `<div class="list flat">${res.map((a, i) => `
        <button type="button" class="row" data-res="${i}">${assetLogo(a, 32)}<span class="main"><div class="t">${esc(a.n)}</div><div class="s">${esc(a.s)} · ${esc(a.c || '')}</div></span>
          <span class="end">${watchList().some((w) => w.s === a.s) ? '✓' : '＋'}</span></button>`).join('')}</div>`
        : '<p class="s">No encuentro nada. Prueba con el ticker (p. ej. NVDA) o el ISIN.</p>';
      for (const b of $('#w-res').querySelectorAll('[data-res]')) b.addEventListener('click', () => {
        const a = res[+b.dataset.res];
        if (watchList().some((w) => w.s === a.s)) { toast('Ya lo sigues'); return; }
        watchList().push({ id: uid(), s: a.s, n: a.n, l: a.l || null, t: a.t || '', k: a.k, c: a.c, p0: a.p || null, p: a.p || null, added: Date.now(), at: a.p ? Date.now() : null });
        saveState(); toast('Siguiendo ' + a.n); renderWatch();
        refreshWatch(() => { if (location.hash === '#/seguimiento') renderWatch(); });
        requestNewsTopics();
      });
    }, 350);
  });
  clearInterval(watchTimer);
  watchTimer = setInterval(() => { if (location.hash !== '#/seguimiento') { clearInterval(watchTimer); return; } refreshWatch(() => { if (!q.value) renderWatch(); }); }, 60000);
  if (list.some((w) => !w.at || Date.now() - w.at > 60000)) refreshWatch(() => { if (location.hash === '#/seguimiento' && !$('#w-q').value) renderWatch(); });
}

function renderWatchDetail(id) {
  const w = watchList().find((x) => x.id === id);
  if (!w) return go('#/seguimiento');
  const inv = watchInv(w);
  setChrome({ title: w.n, tab: 'watch', back: '#/seguimiento' });
  const since = wpct(w.p0, w.p);
  view.innerHTML = `
    <section class="card hero">
      <div class="hero-head">${logoHtml(inv, 44)}<div class="label">${esc(w.s)}${w.c ? ' · ' + esc(w.c) : ''}</div></div>
      <div class="big num">${w.p ? esc(price(w.p, w.c || undefined)) : '—'}</div>
      ${typeof w.chg === 'number' ? `<div class="delta num ${dcls(w.chg)}">${pct2(w.chg)} hoy</div>` : ''}
      <div class="stats">
        <div class="stat"><div class="k">Lo sigues desde</div><div class="v">${new Date(w.added).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}</div></div>
        <div class="stat"><div class="k">Precio ese día</div><div class="v">${w.p0 ? esc(price(w.p0, w.c || undefined)) : '—'}</div></div>
        <div class="stat"><div class="k">Desde entonces</div><div class="v ${since != null ? dcls(since) : ''}">${since != null ? pct2(since) : '—'}</div></div>
      </div>
    </section>
    <div class="section-head"><h2 class="section-title">Gráfico</h2><button type="button" class="btn small secondary" id="chart-full">⛶ Pantalla completa</button></div>
    <div class="card tv-chart-card"><div class="tv-chart" id="tv-chart"></div></div>
    <section class="card form">
      <label class="field"><span>Notas (por qué lo sigues, a qué precio comprarías…)</span><textarea id="w-notes" maxlength="500" placeholder="Opcional">${esc(w.notes || '')}</textarea></label>
    </section>
    <a class="btn secondary" href="#/noticias">📰 Ver noticias</a>
    <p></p>
    <button class="btn danger" type="button" id="w-del">Dejar de seguir</button>`;
  drawTvChart(inv);
  $('#w-notes').addEventListener('change', (e) => { w.notes = e.target.value.trim(); saveState(); toast('Notas guardadas'); });
  $('#w-del').addEventListener('click', () => {
    if (!confirm('¿Dejar de seguir ' + w.n + '?')) return;
    state.watch = watchList().filter((x) => x.id !== id); saveState(); toast('Ya no lo sigues'); go('#/seguimiento');
  });
}

// Noticias de activos que no están en la lista fija: se le pide al servidor de noticias que los busque también.
// Solo se manda el nombre y el símbolo del activo (nada de cantidades ni quién lo pide).
async function requestNewsTopics() {
  if (!navigator.onLine || typeof loadSupabase !== 'function') return;
  if (!newsData) { try { newsData = JSON.parse(localStorage.getItem('inv.newsCache')); } catch (e) { newsData = null; } }
  if (!newsData || !newsData.catalog) return;
  const items = [];
  const add = (inv) => {
    const sym = (inv.priceSource || inv.tvAuto || (inv.tv && inv.tv.includes(':') ? inv.tv : '') || '').toUpperCase();
    if (!sym || newsEntry(inv)) return;
    if (!items.some((x) => x.key === sym)) items.push({ key: sym, name: inv.name.replace(/\s*\(.*\)$/, '').slice(0, 60), isin: ISIN_LIKE.test((inv.ticker || '').toUpperCase()) ? inv.ticker.toUpperCase() : '', ticker: sym.split(':').pop() });
  };
  for (const w of watchList()) add(watchInv(w));
  for (const inv of state.investments) if (inv.mode === 'units' && !calc(inv).closed) add(inv);
  if (!items.length) return;
  const sig = items.map((x) => x.key).sort().join(',');
  let last = {};
  try { last = JSON.parse(localStorage.getItem('inv.newsReq')) || {}; } catch (e) { last = {}; }
  if (last.sig === sig && Date.now() - last.at < 3 * 86400e3) return;
  try {
    await loadSupabase();
    const { error } = await sb.rpc('request_news', { p_items: items.slice(0, 40) });
    if (!error) localStorage.setItem('inv.newsReq', JSON.stringify({ sig, at: Date.now() }));
  } catch (e) { /* ya se pedirá */ }
}
