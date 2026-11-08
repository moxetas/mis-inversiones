'use strict';

// Guía de primeros pasos (#/guia, sale sola la primera vez) y «Desde foto o captura»:
// la app copia unas instrucciones, la persona adjunta la captura o el PDF en su propia app de IA
// (ChatGPT, Claude, Gemini…) y pega aquí la respuesta. Lo leído pasa por la misma pantalla de
// revisión que los extractos del bróker. La app no envía nada a ningún sitio.

const GUIA_VISTA = 'inv.guiaVista';

const PROMPT_IA = `Lee el documento adjunto (captura de la app del bróker, extracto, confirmación de compra, aviso de dividendo…) y devuélveme SOLO un bloque de código JSON, sin explicaciones, con esta forma:

{"movimientos":[{"fecha":"2026-03-14","tipo":"compra","nombre":"Iberdrola","isin":"ES0144580Y14","ticker":"IBE","cantidad":20,"precio":15.42,"importe":308.40,"comision":1.00,"moneda":"EUR"}]}

Reglas:
- Un elemento por cada compra, venta o dividendo.
- "tipo": compra, venta o dividendo.
- "fecha": AAAA-MM-DD.
- Números con punto decimal y sin símbolo de moneda.
- "importe": lo pagado o cobrado SIN la comisión. En los dividendos, el importe bruto y en "comision" la retención.
- Si no aparece el ISIN o el ticker, déjalo vacío (""). Si no hay comisión, 0.
- Ignora ingresos y retiradas de dinero, traspasos y cambios de divisa.
- No incluyas datos personales (nombre del titular, números de cuenta, DNI…).`;

function guiaVista() { try { return !!localStorage.getItem(GUIA_VISTA); } catch (e) { return true; } }
function marcarGuiaVista() { try { localStorage.setItem(GUIA_VISTA, '1'); } catch (e) { /* da igual */ } }

// La primera vez (sin inversiones y sin haber visto la guía) se abre la guía
function guiaPrimeraVez() {
  const h = location.hash.replace(/^#\/?/, '');
  if (!guiaVista() && !state.investments.length && (h === '' || h === '/')) go('#/guia');
}

function renderGuide() {
  marcarGuiaVista();
  setChrome({ title: 'Cómo funciona', tab: 'settings', back: state.investments.length ? '#/ajustes' : '#/' });
  const pasos = [
    ['🔒 Tus datos, solo en tu móvil', 'Sin registro ni cuentas. Tus inversiones se guardan en este teléfono y no se suben a ningún sitio.'],
    ['➕ Apunta tus inversiones', 'Acciones, ETF, fondos, cripto, depósitos… Pon el nombre, el ISIN o el ticker y la app busca sola su precio y su logo.'],
    ['🧾 Sus compras, ventas y dividendos', 'Con eso calcula tu precio medio, cuánto ganas o pierdes y lo que has cobrado en dividendos.'],
    ['📷 Desde captura o PDF', 'En Movimientos: sube el extracto de tu bróker, o pásale una captura a tu app de IA y pega aquí lo que te diga.'],
    ['📈 Resumen y noticias', 'El valor total, la evolución, el reparto por tipo y por bróker, y noticias de lo que tienes.'],
    ['🏆 Grupo (opcional)', 'Ranking y chat con amigos con un código. Solo se comparte tu apodo y tu rentabilidad en %, nunca tus inversiones.'],
    ['💾 Haz copia de vez en cuando', 'En Ajustes → Guardar copia de seguridad, por si cambias de móvil o borras el navegador.'],
  ];
  view.innerHTML = `
    <ol class="guia-pasos card">${pasos.map(([t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join('')}</ol>
    <section class="card form">
      ${state.investments.length ? '' : '<button class="btn" type="button" id="g-demo">Probar con datos de ejemplo</button><a class="btn secondary" href="#/inv/nueva">Añadir mi primera inversión</a>'}
      <a class="btn secondary" href="#/importar">📷 Importar desde captura, PDF o CSV</a>
      <a class="btn secondary" href="guia.pdf" download="Guia-Moxetas-Invest.pdf">📄 Descargar esta guía en PDF</a>
      <a class="btn secondary" href="${state.investments.length ? '#/ajustes' : '#/'}">Entendido</a>
    </section>`;
  $('#g-demo')?.addEventListener('click', () => { loadDemo(); go('#/'); });
}

// ---------- Leer la respuesta de la IA ----------

function aiNum(v) {
  if (typeof v === 'number') return v;
  const s = String(v == null ? '' : v).trim();
  if (!s) return NaN;
  return parseAmount(s, /,\d{1,8}$/.test(s) && !/\.\d{1,8}$/.test(s) ? ',' : '.');
}

function aiKind(t) {
  const x = normTxt(t);
  if (/divid|cupon|coupon/.test(x)) return 'income';
  if (/vent|sell|sold|reembolso/.test(x)) return 'sell';
  if (/compr|buy|bought|suscrip|aportac/.test(x)) return 'buy';
  return null;
}

// Devuelve { moves, skipped } como los extractos, o null si no hay nada que leer
function parseAiText(text) {
  let json = null;
  const block = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  for (const c of [block && block[1], text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]) {
    if (!c) continue;
    try { json = JSON.parse(c); break; } catch (e) { /* siguiente */ }
  }
  const list = json && (Array.isArray(json) ? json : json.movimientos || json.moves || json.operaciones);
  if (Array.isArray(list)) {
    const moves = [], skipped = [];
    for (const r of list) {
      if (!r || typeof r !== 'object') continue;
      const date = parseDateCell(String(r.fecha || r.date || ''));
      const kind = aiKind(r.tipo || r.type || '');
      const isin = (String(r.isin || '').toUpperCase().match(ISIN_RE) || [])[1] || '';
      const ticker = String(r.ticker || '').trim().toUpperCase().slice(0, 20);
      const name = String(r.nombre || r.name || r.activo || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const label = [r.fecha, r.tipo, name || isin || ticker].filter(Boolean).join(' · ');
      if (!date || !kind || (!isin && !ticker && !name)) { skipped.push({ date: date ? date.key : String(r.fecha || ''), why: 'falta la fecha, el tipo o el activo', text: label }); continue; }
      const qty = Math.abs(aiNum(r.cantidad ?? r.unidades ?? r.units));
      const price = Math.abs(aiNum(r.precio ?? r.price));
      let amount = Math.abs(aiNum(r.importe ?? r.amount ?? r.total));
      const fee = Math.abs(aiNum(r.comision ?? r.fee ?? r.retencion)) || 0;
      const cur = cellCurrency(String(r.moneda || r.currency || '')) || null;
      if (kind === 'income') {
        if (!(amount > 0) && qty > 0 && price > 0) amount = qty * price;
        if (!(amount > 0)) { skipped.push({ date: date.key, why: 'dividendo sin importe', text: label }); continue; }
        moves.push({ date: date.key, t: date.t, kind, isin, ticker, name, units: null, price: null, amount, fee, currency: cur });
        continue;
      }
      if (!(amount > 0) && qty > 0 && price > 0) amount = qty * price;
      if (!(qty > 0) || !(amount > 0)) { skipped.push({ date: date.key, why: 'falta la cantidad o el importe', text: label }); continue; }
      moves.push({ date: date.key, t: date.t, kind, isin, ticker, name, units: qty, price: amount / qty, amount, fee, currency: cur });
    }
    if (moves.length || skipped.length) return { moves, skipped };
  }
  // Texto suelto (por ejemplo un CSV o una tabla copiada): se lee como un extracto
  const rows = csvRows(text);
  const r = rowsToMoves(rows, rows.map((x) => x.map((c) => c.s).join(' | ')).join('\n'), true);
  return r.moves.length ? r : null;
}

// Tarjeta de la pantalla Importar
function aiImportCard() {
  return `
    <h2 class="section-title">📷 Desde una captura o foto, con tu IA</h2>
    <section class="card form">
      <ol class="guia-pasos">
        <li><b>Copia las instrucciones</b><button class="btn secondary" type="button" id="ai-copy">Copiar instrucciones</button></li>
        <li><b>Abre tu app de IA</b><span>ChatGPT, Claude, Gemini… (la versión gratis vale). Adjunta la captura de tu bróker, la foto o el PDF y pega las instrucciones.</span></li>
        <li><b>Pega aquí su respuesta</b><span>Te enseñaremos lo encontrado para que lo revises antes de apuntar nada.</span></li>
      </ol>
      <textarea id="ai-text" rows="6" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="Pega aquí la respuesta…"></textarea>
      <button class="btn" type="button" id="ai-read">Leer</button>
      <p class="note" style="margin:0">La app no envía nada: la captura solo la ve la IA que tú elijas, con tu cuenta.</p>
    </section>`;
}

function bindAiImport() {
  $('#ai-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(PROMPT_IA); toast('Instrucciones copiadas'); }
    catch (e) { $('#ai-text').value = PROMPT_IA; $('#ai-text').select(); toast('Cópialas del cuadro'); }
  });
  $('#ai-read').addEventListener('click', () => {
    const text = $('#ai-text').value.trim();
    if (!text || text === PROMPT_IA) { toast('Primero pega la respuesta de tu IA'); $('#ai-text').focus(); return; }
    const r = parseAiText(text);
    if (!r || !r.moves.length) { toast('No he encontrado compras, ventas ni dividendos. ¿Has pegado la respuesta entera?'); return; }
    importDraft = buildDraft(r.moves, r.skipped, '', 'Respuesta de tu IA');
    renderImport();
  });
}
