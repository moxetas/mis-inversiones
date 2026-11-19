'use strict';

// Copia en la nube: tu cuenta (usuario + contraseña) y una copia automática de TODOS tus datos (inversiones,
// movimientos, hijos, seguimiento, historial, grupo y aspecto). Se cifra en el móvil con tu contraseña antes de
// subirla: en el servidor solo hay texto ilegible. Tu cuenta es la misma identidad del grupo, así que tu puesto
// y tus retos te siguen a cualquier móvil.

const CLOUD_DOMAIN = '@usuarios.moxetas-invest.app';   // las cuentas no usan email de verdad: nunca se envía nada
const CK_KEY = 'moxetas.ck';                          // clave de cifrado de este móvil (sale de tu contraseña)
const USER_RE = /^[a-z0-9._-]{3,24}$/;
let cloudT = null, cloudBusy = false;

const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function cloudEmail(user) { return user + CLOUD_DOMAIN; }
function cleanUser(u) { return String(u || '').trim().toLowerCase(); }

async function deriveKey(user, pass) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 310000, salt: new TextEncoder().encode('moxetas-invest:' + user) },
    base, { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}
async function storeKey(key) { localStorage.setItem(CK_KEY, JSON.stringify(await crypto.subtle.exportKey('jwk', key))); }
async function storedKey() {
  try { const j = JSON.parse(localStorage.getItem(CK_KEY)); return j ? await crypto.subtle.importKey('jwk', j, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']) : null; }
  catch (e) { return null; }
}

function cloudPayload() {
  let lk = null;
  try { lk = JSON.parse(localStorage.getItem('inversiones.look')); } catch (e) { lk = null; }
  const s = Object.assign({}, state); delete s.cloud;
  return JSON.stringify({ v: 1, at: Date.now(), state: s, look: lk });
}

// Sube la copia (cifrada). Silenciosa: si no hay conexión, se intenta en el siguiente cambio.
async function cloudPush(force) {
  if (!state.cloud || cloudBusy || !navigator.onLine) return false;
  const key = await storedKey();
  if (!key) return false;
  cloudBusy = true;
  try {
    await loadSupabase();
    const { data: { session } } = await sb.auth.getSession();
    if (!session || session.user.is_anonymous) return false;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(cloudPayload()));
    const { error } = await sb.from('backups').upsert({ user_id: session.user.id, data: b64(enc), iv: b64(iv), updated_at: new Date().toISOString() });
    if (error) throw error;
    state.cloud.at = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));   // sin volver a programar otra copia
    return true;
  } catch (e) {
    if (force) alert('No se ha podido guardar la copia en la nube: ' + (e.message || e));
    return false;
  } finally { cloudBusy = false; }
}
// Cada vez que cambian tus datos, se sube la copia unos segundos después
function cloudSchedule() {
  if (!state.cloud) return;
  clearTimeout(cloudT);
  cloudT = setTimeout(() => cloudPush(false), 8000);
}
document.addEventListener('visibilitychange', () => { if (document.hidden && cloudT) { clearTimeout(cloudT); cloudT = null; cloudPush(false); } });

function cloudErr(e) {
  const m = String((e && (e.message || e.error_description)) || e || '');
  if (/already (been )?registered|already exists|email_exists/i.test(m)) return 'Ese usuario ya existe. Elige otro o, si es tuyo, entra con «Ya tengo cuenta».';
  if (/invalid login|invalid credentials/i.test(m)) return 'Usuario o contraseña incorrectos.';
  if (/confirm/i.test(m)) return 'Falta un ajuste en el servidor (desactivar «Confirm email» en Supabase).';
  if (/Failed to fetch|NetworkError|cargar/i.test(m)) return 'Sin conexión con el servidor. Prueba otra vez en un rato.';
  return 'Algo ha fallado: ' + m;
}

// Crear la cuenta: tu identidad anónima del grupo pasa a tener usuario y contraseña (sigue siendo la misma)
async function cloudCreate(user, pass) {
  await loadSupabase();
  let { data: { session } } = await sb.auth.getSession();
  if (!session) { const r = await sb.auth.signInAnonymously(); if (r.error) throw r.error; session = r.data.session; }
  if (!session.user.is_anonymous) throw new Error('Este móvil ya tiene una cuenta abierta.');
  const { error } = await sb.auth.updateUser({ email: cloudEmail(user), password: pass });
  if (error) throw error;
  const { data: { user: u } } = await sb.auth.getUser();
  if (!u || u.is_anonymous || (u.email || '') !== cloudEmail(user)) throw new Error('confirm email');
  await storeKey(await deriveKey(user, pass));
  state.cloud = { user, at: null };
  saveState();
  return cloudPush(true);
}

// Entrar en un móvil nuevo (o después de que se borre la app): trae y descifra tu copia
async function cloudLogin(user, pass) {
  await loadSupabase();
  const r = await sb.auth.signInWithPassword({ email: cloudEmail(user), password: pass });
  if (r.error) throw r.error;
  myId = r.data.user.id;
  const key = await deriveKey(user, pass);
  const { data, error } = await sb.from('backups').select('data,iv,updated_at').eq('user_id', myId).maybeSingle();
  if (error) throw error;
  await storeKey(key);
  if (!data) { state.cloud = { user, at: null }; saveState(); return { empty: true }; }
  let payload;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(data.iv) }, key, unb64(data.data));
    payload = JSON.parse(new TextDecoder().decode(plain));
  } catch (e) { throw new Error('No se ha podido abrir la copia con esa contraseña.'); }
  return { payload, updated: data.updated_at };
}
function cloudApply(user, payload) {
  state = Object.assign(freshState(), payload.state, { cloud: { user, at: Date.now() } });
  saveState();
  if (payload.look) { try { localStorage.setItem('inversiones.look', JSON.stringify(payload.look)); look = loadLook(); applyLook(); } catch (e) { /* nada */ } }
}

// ---------- Pantalla: Ajustes › Copia en la nube ----------

function renderCloud() {
  setChrome({ title: 'Copia en la nube', tab: 'settings', back: '#/ajustes' });
  const c = state.cloud;
  if (c) {
    view.innerHTML = `
      <section class="card cloud-ok">
        <div class="cloud-ic" aria-hidden="true">☁️</div>
        <div><b>Copia automática activada</b><div class="s">Cuenta: <b>${esc(c.user)}</b></div>
        <div class="s">${c.at ? 'Última copia: ' + esc(timeAgo(c.at / 1000)) : 'Aún sin copia'}</div></div>
      </section>
      <p class="note">Cada vez que cambias algo, la app guarda en la nube todos tus datos cifrados con tu contraseña: inversiones, movimientos, las carteras de tus hijos, el seguimiento, el historial, tu grupo y tus retos (tu puesto va con tu cuenta) y el aspecto.</p>
      <p class="note"><b>En un móvil nuevo</b> (o si se borra la app): ábrela, toca «Recuperar mis datos de la nube» y entra con tu usuario y contraseña.</p>
      <section class="card form">
        <button class="btn" type="button" id="cl-now">Guardar copia ahora</button>
      </section>`;
    $('#cl-now').addEventListener('click', async (e) => {
      e.target.disabled = true; e.target.textContent = 'Guardando…';
      const ok = await cloudPush(true);
      if (ok) toast('Copia guardada en la nube');
      renderCloud();
    });
    return;
  }
  view.innerHTML = `
    <section class="card">
      <h2>☁️ Que no se pierda nada nunca</h2>
      <p style="margin:0">Crea tu cuenta y la app guardará sola una copia de <b>todos</b> tus datos cada vez que cambies algo: inversiones, movimientos, hijos, seguimiento, historial, grupo y retos. Si cambias de móvil o el iPhone borra la app, entras con tu usuario y contraseña y vuelve todo.</p>
      <p class="note" style="margin:10px 0 0">🔒 Se cifra en tu móvil con tu contraseña: en el servidor nadie puede leerla, ni siquiera quien lo administra. Por eso, <b>si olvidas la contraseña no se puede recuperar la copia</b>: apúntala en un sitio seguro.</p>
    </section>
    <form class="card form" id="cl-new" novalidate>
      <h2>Crear mi cuenta</h2>
      <label class="field"><span>Usuario</span><input name="user" autocapitalize="none" autocomplete="username" autocorrect="off" spellcheck="false" maxlength="24" placeholder="Ej.: alberto84">
        <small>De 3 a 24 letras, números, punto, guion o guion bajo. Sin espacios.</small></label>
      <label class="field"><span>Contraseña</span><input name="pass" type="password" autocomplete="new-password" minlength="8" placeholder="Mínimo 8 caracteres"></label>
      <label class="field"><span>Repite la contraseña</span><input name="pass2" type="password" autocomplete="new-password"></label>
      <button class="btn" type="submit">Crear cuenta y guardar copia</button>
    </form>
    <form class="card form" id="cl-in" novalidate>
      <h2>Ya tengo cuenta</h2>
      <label class="field"><span>Usuario</span><input name="user" autocapitalize="none" autocomplete="username" autocorrect="off" spellcheck="false" maxlength="24"></label>
      <label class="field"><span>Contraseña</span><input name="pass" type="password" autocomplete="current-password"></label>
      <button class="btn secondary" type="submit">Entrar y recuperar mis datos</button>
    </form>`;
  const busy = (f, on, txt) => { const b = f.querySelector('button'); b.disabled = on; if (txt) b.textContent = txt; };
  $('#cl-new').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, user = cleanUser(f.elements.user.value), pass = f.elements.pass.value;
    if (!USER_RE.test(user)) { toast('Usuario no válido'); f.elements.user.focus(); return; }
    if (pass.length < 8) { toast('La contraseña necesita 8 caracteres como mínimo'); f.elements.pass.focus(); return; }
    if (pass !== f.elements.pass2.value) { toast('Las contraseñas no coinciden'); f.elements.pass2.focus(); return; }
    const t = f.querySelector('button').textContent;
    busy(f, true, 'Creando cuenta…');
    try { await cloudCreate(user, pass); toast('Cuenta creada y copia guardada'); renderCloud(); }
    catch (err) { state.cloud = null; saveState(); alert(cloudErr(err)); busy(f, false, t); }
  });
  $('#cl-in').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, user = cleanUser(f.elements.user.value), pass = f.elements.pass.value;
    if (!user || !pass) { toast('Pon tu usuario y tu contraseña'); return; }
    const t = f.querySelector('button').textContent;
    busy(f, true, 'Entrando…');
    try {
      const r = await cloudLogin(user, pass);
      if (r.empty) { toast('Cuenta abierta. Aún no tenía copia: se guardará ahora.'); await cloudPush(true); renderCloud(); return; }
      const n = (r.payload.state.investments || []).length, w = (r.payload.state.watch || []).length;
      const when = new Date(r.updated).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const here = state.investments.length;
      if (here && !confirm(`Tu copia del ${when} tiene ${n} inversiones y ${w} en seguimiento. Se cambiarán los datos de este móvil (${here} inversiones) por los de la copia. ¿Seguir?`)) {
        state.cloud = { user, at: null }; saveState(); renderCloud(); return;
      }
      cloudApply(user, r.payload);
      toast('¡Datos recuperados!');
      go('#/');
    } catch (err) { alert(cloudErr(err)); busy(f, false, t); }
  });
}
