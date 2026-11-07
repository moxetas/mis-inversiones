'use strict';

// Retos dentro del grupo: cada uno elige sus activos antes de empezar y gana quien más sube entre la fecha de inicio
// y la de final (media de sus activos, cada uno cuenta igual). Los precios de inicio y final los guarda el servidor
// (supabase/retos.sql). Usa funciones de app.js y grupo.js.

let gameTimer = null, gameDraft = null, gameSearchT = null;

const DURATIONS = [['1d', '1 día'], ['1w', '1 semana'], ['2w', '2 semanas'], ['1m', '1 mes'], ['3m', '3 meses'], ['6m', '6 meses'], ['1y', '1 año']];
function addDuration(d, k) {
  const x = new Date(d), n = parseInt(k, 10), u = k.slice(-1);
  if (u === 'd') x.setDate(x.getDate() + n); else if (u === 'w') x.setDate(x.getDate() + 7 * n);
  else if (u === 'm') x.setMonth(x.getMonth() + n); else x.setFullYear(x.getFullYear() + n);
  return x;
}
const whenFmt = (iso) => new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayFmt = (iso) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' });
function untilText(ms) {
  if (ms <= 0) return 'ya';
  const m = Math.round(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d >= 2) return d + ' días';
  if (h >= 1) return h + ' h' + (m % 60 ? ' ' + (m % 60) + ' min' : '');
  return Math.max(1, m) + ' min';
}
function gameStatus(g) {
  const now = Date.now(), s = new Date(g.start_at).getTime(), e = new Date(g.end_at).getTime();
  if (now < s) return { k: 'next', label: 'Empieza en ' + untilText(s - now) };
  if (now < e) return { k: 'live', label: 'En juego · quedan ' + untilText(e - now) };
  return { k: 'done', label: 'Terminado' };
}
function assetLogo(a, size) { return logoHtml({ name: a.n || a.s, logo: a.l, ticker: a.t || '', type: a.k || 'accion' }, size); }

// ---------- Lista de retos (pestaña Retos del grupo) ----------

async function renderGames() {
  const b = $('#g-body'); if (!b) return;
  const g = state.group;
  const { data, error } = await sb.from('games').select('*').eq('group_id', g.id).order('start_at', { ascending: false });
  if (!$('#g-body') || groupTab !== 'retos') return;
  if (error) { b.innerHTML = `<div class="card empty"><p>${esc(groupErr(error))}</p></div>`; return; }
  const order = { live: 0, next: 1, done: 2 };
  const list = data.map((x) => ({ ...x, st: gameStatus(x) })).sort((a, c) => order[a.st.k] - order[c.st.k]);
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 0, 0, 0);
  const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  b.innerHTML = `
    ${list.length ? `<div class="list">${list.map((x) => `
      <a class="row" href="#/grupo/reto/${esc(x.id)}">
        <span class="game-ic ${x.st.k}" aria-hidden="true">${x.st.k === 'done' ? '🏁' : x.st.k === 'live' ? '🔥' : '⏳'}</span>
        <span class="main"><div class="t">${esc(x.name)}</div><div class="s">${esc(x.st.label)}</div><div class="s">${esc(dayFmt(x.start_at))} → ${esc(dayFmt(x.end_at))}</div></span>
        <span class="end chev" aria-hidden="true">›</span>
      </a>`).join('')}</div>` : `<div class="card empty"><p>Todavía no hay retos. Crea el primero: elegís fecha y duración, cada uno escoge sus activos y gana quien más suba.</p></div>`}
    <section class="card form">
      <h2>Nuevo reto</h2>
      <label class="field"><span>Nombre</span><input id="r-name" maxlength="40" placeholder="Ej.: Reto de noviembre"></label>
      <label class="field"><span>Empieza</span><input id="r-start" type="datetime-local" value="${local(tomorrow)}"></label>
      <label class="field"><span>Dura</span><select id="r-dur">${DURATIONS.map(([k, t]) => `<option value="${k}" ${k === '1m' ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <p class="note" id="r-end" style="margin:0"></p>
      <button class="btn" type="button" id="r-create">Crear reto</button>
    </section>
    <p class="note">Hasta que empiece, cada uno elige de 1 a 10 activos (y los puede cambiar). Nadie ve los de los demás hasta que empieza. Gana quien tenga la mayor subida media en %, cada activo en su moneda.</p>`;
  const endNote = () => { const s = $('#r-start').value; $('#r-end').textContent = s ? 'Termina el ' + whenFmt(addDuration(new Date(s), $('#r-dur').value)) : ''; };
  $('#r-start').addEventListener('input', endNote); $('#r-dur').addEventListener('change', endNote); endNote();
  $('#r-create').addEventListener('click', async (e) => {
    const name = $('#r-name').value.trim(), s = $('#r-start').value;
    if (!name) { toast('Ponle un nombre al reto'); return; }
    if (!s) { toast('Elige cuándo empieza'); return; }
    const start = new Date(s), end = addDuration(start, $('#r-dur').value);
    if (start.getTime() < Date.now() + 6 * 60000) { alert('El reto tiene que empezar dentro de un rato como mínimo, para que dé tiempo a elegir los activos.'); return; }
    e.target.disabled = true;
    const { data: game, error: err } = await sb.rpc('create_game', { p_group: g.id, p_name: name, p_start: start.toISOString(), p_end: end.toISOString() });
    e.target.disabled = false;
    if (err) { alert(groupErr(err)); return; }
    sb.from('messages').insert({ group_id: g.id, nickname: g.nickname, body: '🏁 Nuevo reto «' + name + '»: empieza el ' + whenFmt(start) + '. ¡Elegid vuestros activos en Grupo › Retos!' }).then(() => {});
    location.hash = '#/grupo/reto/' + game.id;
  });
}

// ---------- Un reto ----------

async function renderGame(id) {
  setChrome({ title: 'Reto', tab: 'group', back: '#/grupo' });
  groupTab = 'retos';
  if (gameTimer) { clearTimeout(gameTimer); gameTimer = null; }
  const g = state.group;
  if (!g) { location.hash = '#/grupo'; return; }
  view.innerHTML = '<div class="card empty"><p>Cargando…</p></div>';
  try { await loadSupabase(); } catch (e) { view.innerHTML = `<div class="card empty"><p>${esc(groupErr(e))}</p></div>`; return; }
  const { data: game, error } = await sb.from('games').select('*').eq('id', id).maybeSingle();
  if (!location.hash.includes(id)) return;
  if (error || !game) { view.innerHTML = `<div class="card empty"><p>${esc(error ? groupErr(error) : 'Este reto ya no existe.')}</p></div>`; return; }
  setChrome({ title: game.name, tab: 'group', back: '#/grupo' });
  if (Date.now() < new Date(game.start_at).getTime()) return renderGamePick(game);
  return renderGameBoard(game);
}

// Antes de empezar: elegir activos
async function renderGamePick(game) {
  const g = state.group;
  const [mine, players] = await Promise.all([
    sb.from('picks').select('assets').eq('game_id', game.id).eq('user_id', myId).maybeSingle(),
    sb.rpc('game_players', { p_game: game.id }),
  ]);
  if (!location.hash.includes(game.id)) return;
  const saved = (mine.data && mine.data.assets) || [];
  if (!gameDraft || gameDraft.id !== game.id) gameDraft = { id: game.id, assets: saved.slice() };
  const others = (players.data || []).filter((p) => p.user_id !== myId);
  const st = gameStatus(game);
  const dirty = JSON.stringify(gameDraft.assets.map((a) => a.s)) !== JSON.stringify(saved.map((a) => a.s));
  const own = state.investments.filter((i) => i.mode === 'units' && !calc(i).closed && i.priceSource && !gameDraft.assets.some((a) => a.s === i.priceSource));
  view.innerHTML = `
    <section class="card game-head">
      <div class="game-badge next">⏳ ${esc(st.label)}</div>
      <div class="s">Del ${esc(whenFmt(game.start_at))} al ${esc(whenFmt(game.end_at))}</div>
    </section>
    <h2 class="section-title">Tus activos (${gameDraft.assets.length}/10)</h2>
    ${gameDraft.assets.length ? `<div class="list">${gameDraft.assets.map((a, i) => `
      <div class="row">${assetLogo(a, 36)}<span class="main"><div class="t">${esc(a.n || a.s)}</div><div class="s">${esc(a.s)}${a.c ? ' · ' + esc(a.c) : ''}</div></span>
        <button class="icon-btn" type="button" data-del="${i}" aria-label="Quitar">✕</button></div>`).join('')}</div>`
      : '<div class="card empty"><p>Aún no has elegido. Busca abajo o toca uno de tu cartera.</p></div>'}
    ${dirty || !saved.length ? `<button class="btn" type="button" id="r-save" ${gameDraft.assets.length ? '' : 'disabled'}>${saved.length ? 'Guardar cambios' : 'Apuntarme con estos activos'}</button>` : '<p class="note">✅ Estás apuntado. Puedes cambiar tus activos hasta que empiece.</p>'}
    <section class="card form">
      <label class="field"><span>Añadir activo</span><input id="r-q" type="search" autocomplete="off" placeholder="Nombre, ticker o ISIN (Apple, NVDA, Bitcoin…)"></label>
      <div id="r-res"></div>
      ${own.length ? `<div class="s" style="margin-top:4px">De tu cartera</div><div class="chips wrap">${own.map((i) => `<button type="button" data-own="${esc(i.id)}">${esc(i.name)}</button>`).join('')}</div>` : ''}
    </section>
    <h2 class="section-title">Apuntados (${others.length + (saved.length ? 1 : 0)})</h2>
    <div class="card">${[...(saved.length ? [`<div class="pl"><b>${esc(g.nickname)}</b> (tú) · ${saved.length} activo${saved.length > 1 ? 's' : ''}</div>`] : []),
      ...others.map((p) => `<div class="pl"><b>${esc(p.nickname)}</b> · ${p.n} activo${p.n > 1 ? 's' : ''}</div>`)].join('') || '<p class="s" style="margin:0">Nadie todavía.</p>'}
      <p class="note" style="margin:8px 0 0">Lo que ha elegido cada uno se verá cuando empiece.</p></div>
    ${saved.length ? '<button class="btn secondary" type="button" id="r-out">Desapuntarme</button>' : ''}
    ${game.created_by === myId ? '<button class="btn danger" type="button" id="r-delgame" style="margin-top:10px">Borrar el reto</button>' : ''}`;

  const rerender = () => renderGamePick(game);
  const add = (a) => {
    if (gameDraft.assets.length >= 10) { toast('Máximo 10 activos'); return; }
    if (gameDraft.assets.some((x) => x.s === a.s)) { toast('Ya lo tienes'); return; }
    gameDraft.assets.push(a); rerender();
  };
  for (const btn of view.querySelectorAll('[data-del]')) btn.addEventListener('click', () => { gameDraft.assets.splice(+btn.dataset.del, 1); rerender(); });
  for (const btn of view.querySelectorAll('[data-own]')) btn.addEventListener('click', () => {
    const i = invById(btn.dataset.own);
    add({ s: i.priceSource, n: i.name, l: i.logo || null, t: i.ticker || '', k: i.type, c: invCur(i) });
  });
  const q = $('#r-q');
  q.addEventListener('input', () => {
    clearTimeout(gameSearchT);
    const v = q.value.trim();
    if (v.length < 2) { $('#r-res').innerHTML = ''; return; }
    gameSearchT = setTimeout(async () => {
      $('#r-res').innerHTML = '<p class="s">Buscando en TradingView…</p>';
      let res = [];
      try { res = await searchAssets(v); } catch (e) { /* sin conexión */ }
      if (q.value.trim() !== v) return;
      $('#r-res').innerHTML = res.length ? `<div class="list flat">${res.map((a, i) => `
        <button type="button" class="row" data-res="${i}">${assetLogo(a, 32)}<span class="main"><div class="t">${esc(a.n)}</div><div class="s">${esc(a.s)} · ${esc(a.c || '')}</div></span><span class="end num">${a.p ? esc(price(a.p, a.c)) : ''}</span></button>`).join('')}</div>`
        : '<p class="s">No encuentro nada. Prueba con el ticker (p. ej. AAPL) o el ISIN.</p>';
      for (const btn of $('#r-res').querySelectorAll('[data-res]')) btn.addEventListener('click', () => { const a = { ...res[+btn.dataset.res] }; delete a.p; add(a); });
    }, 350);
  });
  const save = $('#r-save');
  if (save) save.addEventListener('click', async () => {
    save.disabled = true;
    if (Date.now() >= new Date(game.start_at).getTime()) { alert('El reto ya ha empezado: ya no se pueden cambiar los activos.'); return renderGame(game.id); }
    const { error } = await sb.from('picks').upsert({ game_id: game.id, user_id: myId, nickname: g.nickname, assets: gameDraft.assets, updated_at: new Date().toISOString() });
    if (error) { save.disabled = false; alert(groupErr(error)); return; }
    toast(saved.length ? 'Cambios guardados' : '¡Apuntado al reto!'); gameDraft = null; rerender();
  });
  const out = $('#r-out');
  if (out) out.addEventListener('click', async () => {
    if (!confirm('¿Desapuntarte de este reto?')) return;
    const { error } = await sb.from('picks').delete().eq('game_id', game.id).eq('user_id', myId);
    if (error) { alert(groupErr(error)); return; }
    gameDraft = null; rerender();
  });
  const del = $('#r-delgame');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('¿Borrar el reto «' + game.name + '» para todos?')) return;
    const { error } = await sb.from('games').delete().eq('id', game.id);
    if (error) { alert(groupErr(error)); return; }
    groupTab = 'retos'; location.hash = '#/grupo';
  });
  // Cuando llegue la hora, pasa solo a la clasificación
  const left = new Date(game.start_at).getTime() - Date.now();
  if (left < 30 * 60000) gameTimer = setTimeout(() => { if (location.hash.includes(game.id)) renderGame(game.id); }, left + 1500);
}

// Buscar activos en TradingView (acciones y ETF por nombre, ticker o ISIN; criptomonedas)
async function tvSearch(market, filter, sort, n) {
  const body = JSON.stringify({ filter, columns: ['name', 'description', 'exchange', 'currency', 'logoid', 'base_currency_logoid', 'close', 'type'],
    range: [0, n || 6], sort, options: { lang: 'es' } });
  const res = await fetch('https://scanner.tradingview.com/' + market + '/scan', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body });
  if (!res.ok) return [];
  const json = await res.json();
  return (json.data || []).map((r) => {
    const [name, description, exchange, currency, logoid, baseLogo, close, type] = r.d;
    return { s: r.s, n: type === 'spot' ? (description || name).split(' / ')[0] : description || name, l: logoid || baseLogo || null, k: type === 'fund' ? 'fondo' : type === 'spot' ? 'cripto' : 'accion', c: (currency || '').toUpperCase(), p: close };
  });
}
async function searchAssets(q) {
  const STOCK = { left: 'type', operation: 'in_range', right: ['stock', 'fund', 'dr'] };
  const up = q.toUpperCase().replace(/\s+/g, '');
  if (ISIN_LIKE.test(up)) {
    const rows = await tvSearch('global', [{ left: 'isin', operation: 'equal', right: up }], { sortBy: 'volume', sortOrder: 'desc' }, 10);
    return rows.sort((a, b) => (b.c === 'EUR') - (a.c === 'EUR')).slice(0, 6).map((r) => ({ ...r, t: up }));
  }
  const cryptoF = [{ left: 'name,description', operation: 'match', right: q }, { left: 'exchange', operation: 'in_range', right: ['COINBASE', 'KRAKEN', 'BITSTAMP'] },
    { left: 'currency', operation: 'in_range', right: ['USD', 'EUR'] }];
  const [exact, stocks, crypto] = await Promise.all([
    /^[A-Z0-9.]{1,8}$/.test(up) ? tvSearch('global', [{ left: 'name', operation: 'equal', right: up }, STOCK, { left: 'is_primary', operation: 'equal', right: true }], { sortBy: 'market_cap_basic', sortOrder: 'desc' }, 3) : [],
    tvSearch('global', [{ left: 'name,description', operation: 'match', right: q }, STOCK, { left: 'is_primary', operation: 'equal', right: true }], { sortBy: 'market_cap_basic', sortOrder: 'desc' }, 6),
    tvSearch('crypto', cryptoF, { sortBy: 'market_cap_calc', sortOrder: 'desc' }, 12),
  ]);
  // De cada cripto, un solo mercado (el primero que salga)
  const seen = new Set(), cr = [];
  for (const c of crypto) { const base = c.s.split(':')[1].replace(/(USD|EUR)$/, ''); if (!seen.has(base)) { seen.add(base); cr.push(c); } }
  const out = [], have = new Set();
  for (const r of [...exact, ...cr.slice(0, 3), ...stocks]) if (!have.has(r.s)) { have.add(r.s); out.push(r); }
  return out.slice(0, 8);
}

// Desde que empieza: clasificación
async function renderGameBoard(game) {
  const st = gameStatus(game), done = st.k === 'done';
  const [pk, pr] = await Promise.all([
    sb.from('picks').select('user_id,nickname,assets').eq('game_id', game.id),
    sb.from('game_prices').select('symbol,start_price,end_price').eq('game_id', game.id),
  ]);
  if (!location.hash.includes(game.id)) return;
  if (pk.error) { view.innerHTML = `<div class="card empty"><p>${esc(groupErr(pk.error))}</p></div>`; return; }
  const prices = Object.fromEntries((pr.data || []).map((x) => [x.symbol, x]));
  const symbols = [...new Set(pk.data.flatMap((p) => p.assets.map((a) => a.s)))];
  let live = {};
  const needLive = symbols.filter((s) => !done || !prices[s] || prices[s].end_price == null || prices[s].start_price == null);
  if (needLive.length) { try { live = (await tvQuotes(needLive)).quotes; } catch (e) { live = {}; } }
  if (!location.hash.includes(game.id)) return;

  // Plan B: si 15 minutos después el servidor no ha guardado algún precio, lo manda la app
  const late = (iso) => Date.now() > new Date(iso).getTime() + 15 * 60000;
  const fill = (kind, iso) => {
    if (!late(iso)) return;
    const missing = Object.fromEntries(symbols.filter((s) => (!prices[s] || prices[s][kind + '_price'] == null) && live[s]).map((s) => [s, live[s].close]));
    if (Object.keys(missing).length) sb.rpc('fill_prices', { p_game: game.id, p_kind: kind, p_prices: missing }).then(() => {});
  };
  fill('start', game.start_at); if (done) fill('end', game.end_at);

  const rows = pk.data.map((p) => {
    const assets = p.assets.map((a) => {
      const x = prices[a.s] || {}, start = x.start_price != null ? +x.start_price : null;
      const now = done && x.end_price != null ? +x.end_price : live[a.s] ? live[a.s].close : null;
      return { ...a, start, now, pct: start && now ? (now / start - 1) * 100 : null };
    });
    const ok = assets.filter((a) => a.pct != null);
    return { ...p, assets, pct: ok.length ? ok.reduce((s, a) => s + a.pct, 0) / ok.length : null };
  }).sort((a, b) => (b.pct ?? -1e9) - (a.pct ?? -1e9));
  const waiting = symbols.some((s) => !prices[s] || prices[s].start_price == null);
  const medal = ['🥇', '🥈', '🥉'];
  const cl = (x) => (x > 0 ? 'good' : x < 0 ? 'bad' : '');
  const winner = done && rows.length && rows[0].pct != null ? rows[0] : null;
  view.innerHTML = `
    <section class="card game-head">
      <div class="game-badge ${st.k}">${done ? '🏁' : '🔥'} ${esc(st.label)}</div>
      <div class="s">Del ${esc(whenFmt(game.start_at))} al ${esc(whenFmt(game.end_at))}</div>
      ${winner ? `<div class="winner">🏆 Ha ganado <b>${esc(winner.nickname)}</b> con <span class="${cl(winner.pct)}">${pct2(winner.pct)}</span></div>` : ''}
    </section>
    ${waiting && !late(game.start_at) ? '<p class="note">Guardando los precios de inicio… en un par de minutos sale la clasificación.</p>' : ''}
    ${rows.length ? `<div class="list">${rows.map((p, i) => `
      <details class="row-d ${p.user_id === myId ? 'me' : ''}">
        <summary class="row rank-row ${p.user_id === myId ? 'me' : ''}">
          <span class="rank-pos">${p.pct == null ? '·' : medal[i] || i + 1}</span>
          <span class="main"><div class="t">${esc(p.nickname)}${p.user_id === myId ? ' <span class="tag">tú</span>' : ''}</div><div class="s">${p.assets.length} activo${p.assets.length > 1 ? 's' : ''} · toca para verlos</div></span>
          <span class="end"><div class="num rank-pct ${cl(p.pct)}">${p.pct == null ? '—' : pct2(p.pct)}</div></span>
        </summary>
        <div class="picks">${p.assets.map((a) => `
          <div class="pick">${assetLogo(a, 28)}<span class="main"><div class="t">${esc(a.n || a.s)}</div>
            <div class="s num">${a.start != null ? esc(price(a.start, a.c || undefined)) + ' → ' + (a.now != null ? esc(price(a.now, a.c || undefined)) : '…') : 'Esperando precio de inicio'}</div></span>
            <span class="num ${cl(a.pct)}">${a.pct == null ? '—' : pct2(a.pct)}</span></div>`).join('')}</div>
      </details>`).join('')}</div>` : '<div class="card empty"><p>Nadie se apuntó a este reto.</p></div>'}
    <p class="note">${done ? 'Resultado con los precios del final del reto.' : 'En directo con los precios de TradingView (se actualiza cada minuto).'} Cuenta la subida media en % de los activos de cada uno, cada activo en su moneda, desde el precio de inicio.</p>
    ${game.created_by === myId ? '<button class="btn danger" type="button" id="r-delgame">Borrar el reto</button>' : ''}`;
  const del = $('#r-delgame');
  if (del) del.addEventListener('click', async () => {
    if (!confirm('¿Borrar el reto «' + game.name + '» para todos?')) return;
    const { error } = await sb.from('games').delete().eq('id', game.id);
    if (error) { alert(groupErr(error)); return; }
    groupTab = 'retos'; location.hash = '#/grupo';
  });
  if (!done || waiting) {
    gameTimer = setTimeout(async () => {
      if (!location.hash.includes(game.id)) return;
      const y = window.scrollY;
      const keep = [...view.querySelectorAll('details')].map((d) => d.open);
      await renderGameBoard(game);
      [...view.querySelectorAll('details')].forEach((d, i) => { d.open = !!keep[i]; });
      window.scrollTo(0, y);
    }, gameStatus(game).k === 'live' && new Date(game.end_at).getTime() - Date.now() < 60000 ? new Date(game.end_at).getTime() - Date.now() + 2000 : 60000);
  }
}
