'use strict';

// Grupo: ranking y chat entre amigos (Supabase). Solo se comparte el apodo, la rentabilidad (y los euros si
// cada uno quiere) y los mensajes del chat. Las inversiones nunca salen del teléfono.
// Las reglas de quién puede leer y escribir qué están en la base de datos (supabase/esquema.sql).

const SB_URL = 'https://iestckrmlfycbewswazl.supabase.co';
const SB_KEY = 'sb_publishable_Ot0u7T0PjjCkeKXmMk4Y0Q_KN1j5bYA';   // clave pública: va en la app a propósito

let sb = null, sbLoading = null, groupTab = 'ranking', groupChannel = null, chatMsgs = [], groupMembers = [], myId = null;

function loadSupabase() {
  if (sb) return Promise.resolve(sb);
  if (sbLoading) return sbLoading;
  sbLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/supabase/supabase.js';
    s.onload = async () => {
      try {
        sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, storageKey: 'moxetas.sb' } });
        let { data: { session } } = await sb.auth.getSession();
        if (!session) { const r = await sb.auth.signInAnonymously(); if (r.error) throw r.error; session = r.data.session; }
        myId = session.user.id;
        resolve(sb);
      } catch (e) { sbLoading = null; reject(e); }
    };
    s.onerror = () => { sbLoading = null; reject(new Error('No se ha podido cargar')); };
    document.head.appendChild(s);
  });
  return sbLoading;
}

function groupErr(e) {
  const m = String((e && (e.message || e.error_description)) || e || '');
  if (/^Vuelve a unirte/.test(m)) return m;
  if (/código no válido/.test(m)) return 'Ese código no existe. Revisa que esté bien escrito.';
  if (/Failed to fetch|NetworkError|cargar/.test(m)) return 'No hay conexión con el servidor del grupo. Prueba otra vez en un rato.';
  return 'Algo ha fallado: ' + m;
}

// Mi rentabilidad para el ranking (en la moneda principal)
function myStats() {
  const { tot } = portfolio();
  return { pct: tot.contributed > 0 ? Math.round(tot.pct * 10000) / 100 : null, gain: Math.round(tot.gain * 100) / 100 };
}

// Manda mi rentabilidad al grupo (como mucho cada 10 minutos, salvo que se fuerce)
async function publishStats(force) {
  const g = state.group;
  if (!g || !navigator.onLine || !state.investments.length) return;
  if (!force && Date.now() - (g.sentAt || 0) < 10 * 60 * 1000) return;
  try {
    await loadSupabase();
    const s = myStats();
    const { error } = await sb.from('members').update({ pct: s.pct, gain: g.showGain ? s.gain : null, show_gain: !!g.showGain, updated_at: new Date().toISOString() })
      .eq('group_id', g.id).eq('user_id', myId);
    if (!error) { g.sentAt = Date.now(); saveState(); }
  } catch (e) { /* sin conexión: ya se mandará */ }
}

function renderGroup() {
  setChrome({ title: 'Grupo', tab: 'group' });
  const g = state.group;
  if (!g) {
    view.innerHTML = `
      <section class="card">
        <h2>Compite con tus amigos</h2>
        <p style="margin-top:0">Crea un grupo o únete al de un amigo para ver quién va ganando y hablar en el chat.</p>
        <p class="note" style="margin:0">Solo se comparte tu <b>apodo</b> y tu <b>rentabilidad en %</b> (y tus euros si tú quieres). Nadie ve tus inversiones.</p>
      </section>
      <section class="card form">
        <h2 style="margin:0">Unirme a un grupo</h2>
        <label class="field"><span>Código del grupo</span><input id="g-code" autocapitalize="characters" autocomplete="off" placeholder="MX-XXXXXX"></label>
        <label class="field"><span>Tu apodo</span><input id="g-nick1" maxlength="24" placeholder="Cómo te verán los demás"></label>
        <button class="btn" type="button" id="g-join">Unirme</button>
      </section>
      <section class="card form">
        <h2 style="margin:0">Crear un grupo nuevo</h2>
        <label class="field"><span>Nombre del grupo</span><input id="g-name" maxlength="40" placeholder="Ej.: Los inversores"></label>
        <label class="field"><span>Tu apodo</span><input id="g-nick2" maxlength="24" placeholder="Cómo te verán los demás"></label>
        <button class="btn secondary" type="button" id="g-create">Crear grupo</button>
      </section>`;
    const go2 = async (btn, fn) => {
      btn.disabled = true; const t = btn.textContent; btn.textContent = 'Un momento…';
      try { await loadSupabase(); await fn(); } catch (e) { alert(groupErr(e)); } finally { btn.disabled = false; btn.textContent = t; }
    };
    $('#g-join').addEventListener('click', (e) => go2(e.target, async () => {
      const code = $('#g-code').value.trim(), nick = $('#g-nick1').value.trim();
      if (!code || !nick) { toast('Pon el código y tu apodo'); return; }
      const { data, error } = await sb.rpc('join_group', { p_code: code, p_nickname: nick });
      if (error) throw error;
      state.group = { id: data.id, code: data.code, name: data.name, nickname: nick, showGain: false };
      saveState(); await publishStats(true); toast('Te has unido a «' + data.name + '»'); renderGroup();
    }));
    $('#g-create').addEventListener('click', (e) => go2(e.target, async () => {
      const name = $('#g-name').value.trim(), nick = $('#g-nick2').value.trim();
      if (!name || !nick) { toast('Pon el nombre del grupo y tu apodo'); return; }
      const { data, error } = await sb.rpc('create_group', { p_name: name, p_nickname: nick });
      if (error) throw error;
      state.group = { id: data.id, code: data.code, name: data.name, nickname: nick, showGain: false };
      saveState(); await publishStats(true); renderGroup();
    }));
    return;
  }
  view.innerHTML = `
    <section class="card group-head">
      <div><div class="t">${esc(g.name)}</div><div class="s">Código: <b class="num">${esc(g.code)}</b></div></div>
      <button class="btn small secondary" type="button" id="g-share">Invitar</button>
    </section>
    <div class="seg" style="margin-bottom:14px">
      <label><input type="radio" name="gt" value="ranking" ${groupTab === 'ranking' ? 'checked' : ''}><span>Ranking</span></label>
      <label><input type="radio" name="gt" value="chat" ${groupTab === 'chat' ? 'checked' : ''}><span>Chat</span></label>
      <label><input type="radio" name="gt" value="retos" ${groupTab === 'retos' ? 'checked' : ''}><span>Retos</span></label>
    </div>
    <div id="g-body"><div class="card empty"><p>Cargando…</p></div></div>`;
  for (const r of view.querySelectorAll('[name=gt]')) r.addEventListener('change', () => { groupTab = r.value; renderGroupBody(); });
  $('#g-share').addEventListener('click', async () => {
    const text = `Únete a mi grupo «${g.name}» en Moxetas Invest: abre https://moxetas.github.io/mis-inversiones/ → Grupo → Unirme, con el código ${g.code}`;
    try { if (navigator.share) { await navigator.share({ text }); return; } } catch (e) { if (e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); toast('Invitación copiada'); } catch (e) { alert(text); }
  });
  startGroupLive().then(renderGroupBody).catch((e) => { const b = $('#g-body'); if (!b) return toast(groupErr(e)); b.innerHTML = `<div class="card empty"><p>${esc(groupErr(e))}</p></div>`; });
}

// Carga ranking y chat, y se suscribe a los cambios en directo
async function startGroupLive() {
  const g = state.group;
  await loadSupabase();
  await publishStats(false);
  const [m, c] = await Promise.all([
    sb.from('members').select('user_id,nickname,pct,gain,show_gain,updated_at').eq('group_id', g.id),
    sb.from('messages').select('id,user_id,nickname,body,created_at').eq('group_id', g.id).order('created_at', { ascending: false }).limit(100),
  ]);
  if (m.error) throw m.error;
  if (!m.data.some((x) => x.user_id === myId)) {
    // Ya no soy miembro (por ejemplo, en un móvil nuevo): hay que volver a unirse con el código
    const code = g.code; state.group = null; saveState(); renderGroup();
    const inp = $('#g-code'); if (inp) inp.value = code;
    throw new Error('Vuelve a unirte al grupo con tu código (' + code + ').');
  }
  groupMembers = m.data; chatMsgs = (c.data || []).reverse();
  if (groupChannel) { sb.removeChannel(groupChannel); groupChannel = null; }
  groupChannel = sb.channel('grupo-' + g.id)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'group_id=eq.' + g.id }, (p) => {
      if (!chatMsgs.some((x) => x.id === p.new.id)) chatMsgs.push(p.new);
      if (location.hash.startsWith('#/grupo') && groupTab === 'chat') renderChat(true);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: 'group_id=eq.' + g.id }, (p) => {
      if (p.eventType === 'DELETE') { if (!p.old || p.old.group_id !== g.id) return; groupMembers = groupMembers.filter((x) => x.user_id !== p.old.user_id); }
      else { const i = groupMembers.findIndex((x) => x.user_id === p.new.user_id); if (i >= 0) groupMembers[i] = p.new; else groupMembers.push(p.new); }
      if (location.hash.startsWith('#/grupo') && groupTab === 'ranking') renderRanking();
    })
    .subscribe();
}

function renderGroupBody() { if (groupTab === 'chat') renderChat(); else if (groupTab === 'retos') renderGames(); else renderRanking(); }

function renderRanking() {
  const b = $('#g-body'); if (!b) return;
  const g = state.group;
  const list = groupMembers.slice().sort((a, x) => (x.pct == null ? -1e9 : x.pct) - (a.pct == null ? -1e9 : a.pct));
  const medal = ['🥇', '🥈', '🥉'];
  b.innerHTML = `
    <div class="list">${list.map((x, i) => `
      <div class="row rank-row ${x.user_id === myId ? 'me' : ''}">
        <span class="rank-pos">${x.pct == null ? '·' : medal[i] || i + 1}</span>
        <span class="main"><div class="t">${esc(x.nickname)}${x.user_id === myId ? ' <span class="tag">tú</span>' : ''}</div>
          <div class="s">${x.pct == null ? 'Sin datos todavía' : 'Actualizado ' + esc(timeAgo(new Date(x.updated_at).getTime() / 1000))}</div></span>
        <span class="end">
          <div class="num rank-pct ${x.pct > 0 ? 'good' : x.pct < 0 ? 'bad' : ''}">${x.pct == null ? '—' : pct2(x.pct)}</div>
          ${x.show_gain && x.gain != null ? `<div class="s num ${x.gain > 0 ? 'good' : x.gain < 0 ? 'bad' : ''}">${signed(x.gain)}</div>` : ''}
        </span>
      </div>`).join('')}
    </div>
    <p class="note">Rentabilidad total de cada uno: lo que gana o pierde sobre el dinero que ha puesto.</p>
    <section class="card form">
      <label class="check" style="margin:0"><input type="checkbox" id="g-showgain" ${g.showGain ? 'checked' : ''}> <span>Enseñar también mi ganancia en euros</span></label>
      <label class="field"><span>Mi apodo</span><input id="g-nick" maxlength="24" value="${esc(g.nickname)}"></label>
      <button class="btn danger" type="button" id="g-leave">Salir del grupo</button>
    </section>`;
  $('#g-showgain').addEventListener('change', (e) => { g.showGain = e.target.checked; saveState(); publishStats(true); });
  $('#g-nick').addEventListener('change', async (e) => {
    const nick = e.target.value.trim(); if (!nick) return;
    const { error } = await sb.from('members').update({ nickname: nick }).eq('group_id', g.id).eq('user_id', myId);
    if (error) { alert(groupErr(error)); return; }
    g.nickname = nick; saveState(); toast('Apodo cambiado');
  });
  $('#g-leave').addEventListener('click', async () => {
    if (!confirm('¿Salir de «' + g.name + '»? Se borra tu puesto en el ranking. Podrás volver con el código ' + g.code + '.')) return;
    const { error } = await sb.from('members').delete().eq('group_id', g.id).eq('user_id', myId);
    if (error) { alert(groupErr(error)); return; }
    if (groupChannel) { sb.removeChannel(groupChannel); groupChannel = null; }
    state.group = null; saveState(); toast('Has salido del grupo'); renderGroup();
  });
}

function renderChat(keepInput) {
  const b = $('#g-body'); if (!b) return;
  const draft = keepInput && $('#g-msg') ? $('#g-msg').value : '';
  const hm = (iso) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const day = (iso) => new Date(iso).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  let html = '', lastDay = '';
  for (const m of chatMsgs) {
    const d = day(m.created_at);
    if (d !== lastDay) { html += `<div class="chat-day">${esc(d)}</div>`; lastDay = d; }
    const mine = m.user_id === myId;
    html += `<div class="msg ${mine ? 'mine' : ''}">${mine ? '' : `<div class="who">${esc(m.nickname)}</div>`}<div class="txt">${esc(m.body)}</div><div class="time">${hm(m.created_at)}</div></div>`;
  }
  b.innerHTML = `
    <div class="chat" id="g-chat">${html || '<div class="empty"><p>Aún no hay mensajes. ¡Escribe el primero!</p></div>'}</div>
    <form class="chat-form" id="g-form"><input id="g-msg" maxlength="500" autocomplete="off" placeholder="Escribe un mensaje" value="${esc(draft)}"><button class="btn" type="submit">Enviar</button></form>`;
  const chat = $('#g-chat'); chat.scrollTop = chat.scrollHeight;
  $('#g-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const inp = $('#g-msg'), body = inp.value.trim();
    if (!body) return;
    inp.value = '';
    const { data, error } = await sb.from('messages').insert({ group_id: state.group.id, nickname: state.group.nickname, body }).select().single();
    if (error) { inp.value = body; alert(groupErr(error)); return; }
    if (!chatMsgs.some((x) => x.id === data.id)) chatMsgs.push(data);
    renderChat(); $('#g-msg').focus();
  });
}
