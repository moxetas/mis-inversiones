'use strict';

// Importar movimientos desde el extracto de un bróker (PDF o CSV), todo dentro del teléfono.
// 1) Se sacan las filas del archivo: CSV directamente; PDF con pdf.js (vendor/pdfjs).
// 2) Cada fila se convierte en un movimiento: por las columnas (si hay cabecera reconocible) o, si no,
//    buscando en la fila fecha + compra/venta + ISIN + cantidad × precio = importe.
// 3) Se agrupan por activo, se juntan las ventas con su recompra inmediata, se quitan los repetidos
//    y se enseña un resumen para confirmar antes de apuntar nada.

let importDraft = null;   // lo leído del último archivo, hasta que se confirma

// ---------- Utilidades ----------

function normTxt(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
}
const ISIN_RE = /\b([A-Z]{2}[A-Z0-9]{9}\d)\b/;
const MONTHS = { ene: 1, jan: 1, feb: 2, mar: 3, abr: 4, apr: 4, may: 5, jun: 6, jul: 7, ago: 8, aug: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, dec: 12 };

// Fecha (y hora si la hay) → { key: 'AAAA-MM-DD', t: milisegundos }
function parseDateCell(s) {
  const x = String(s || '').trim();
  let m = x.match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  let y, mo, d, hh = 12, mi = 0, ss = 0;
  if (m) { [y, mo, d] = [+m[1], +m[2], +m[3]]; if (m[4]) [hh, mi, ss] = [+m[4], +m[5], +(m[6] || 0)]; }
  else if ((m = x.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/))) {
    [d, mo, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += 2000;
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];          // formato mes/día
    if (m[4]) [hh, mi, ss] = [+m[4], +m[5], +(m[6] || 0)];
  } else if ((m = normTxt(x).match(/(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})/)) && MONTHS[m[2]]) {
    [d, mo, y] = [+m[1], MONTHS[m[2]], +m[3]];
  } else return null;
  if (!(y > 1990 && y < 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  return { key: y + '-' + pad(mo) + '-' + pad(d), t: new Date(y, mo - 1, d, hh, mi, ss).getTime() };
}

// Número con el separador decimal del documento («,» en los extractos españoles, «.» en los CSV en inglés)
function parseAmount(s, dec) {
  let x = String(s == null ? '' : s).replace(/[\s €$£]|EUR|USD|GBP|CHF/gi, '');
  const neg = /^\(.*\)$/.test(x) || /^[-−–]/.test(x);
  x = x.replace(/[()−–+-]/g, '');
  if (!/^\d[\d.,]*$/.test(x)) return NaN;
  if (dec === ',') x = x.replace(/\./g, '').replace(',', '.');
  else x = x.replace(/,/g, '');
  const n = Number(x);
  return neg ? -n : n;
}
function cellCurrency(s) {
  const x = String(s || '');
  if (/€|EUR/i.test(x)) return 'EUR';
  if (/\$|USD/i.test(x)) return 'USD';
  if (/£|GBP/i.test(x)) return 'GBP';
  if (/CHF/i.test(x)) return 'CHF';
  return null;
}
// Decide si el documento usa coma o punto decimal mirando sus números
function guessDecimal(text) {
  const comma = (text.match(/\d,\d{1,2}(?!\d)|\d,\d{4,}/g) || []).length;
  const dot = (text.match(/\d\.\d{1,2}(?!\d)|\d\.\d{4,}/g) || []).length;
  return comma >= dot ? ',' : '.';
}

function classifyAction(s) {
  const x = normTxt(s);
  if (/transfer|traspaso|deposit|ingreso|retirada|withdraw|interes(es)? de efectivo|interest on cash|tarifa|fee$|comision de|cambio de divisa|currency conversion/.test(x) && !/dividend/.test(x)) return 'skip';
  if (/dividend|cupon|coupon|reparto/.test(x)) return 'income';
  if (/\b(buy|compra|comprar|kauf|achat|suscripcion|aportacion|purchase|bought)\b|market buy|limit buy/.test(x)) return 'buy';
  if (/\b(sell|venta|vender|verkauf|vente|reembolso|sold)\b|market sell|limit sell/.test(x)) return 'sell';
  return null;
}

function detectBroker(text) {
  const t = normTxt(text.slice(0, 20000));
  // Algunos CSV no dicen el nombre del bróker: se reconoce por sus columnas
  if (t.includes('no. of shares') && t.includes('price / share')) return 'Trading 212';
  if (t.includes('valor local') && t.includes('costes de transaccion')) return 'DEGIRO';
  if (t.includes('comm/fee') && t.includes('proceeds')) return 'Interactive Brokers';
  const known = [['trading 212', 'Trading 212'], ['interactive brokers', 'Interactive Brokers'], ['degiro', 'DEGIRO'], ['myinvestor', 'MyInvestor'],
    ['caixabank', 'CaixaBank'], ['etoro', 'eToro'], ['xtb', 'XTB'], ['revolut', 'Revolut'], ['scalable', 'Scalable Capital'], ['trade republic', 'Trade Republic'],
    ['bit2me', 'Bit2Me'], ['binance', 'Binance'], ['coinbase', 'Coinbase'], ['openbank', 'Openbank'], ['bankinter', 'Bankinter'], ['ing ', 'ING'],
    ['renta 4', 'Renta 4'], ['selfbank', 'Self Bank'], ['self bank', 'Self Bank'], ['indexa', 'Indexa Capital'], ['finizens', 'Finizens'], ['santander', 'Santander'], ['bbva', 'BBVA']];
  const hit = known.find(([k]) => new RegExp('\\b' + k.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(t));
  return hit ? hit[1] : '';
}

// ---------- Lectura de archivos ----------

function csvRows(text) {
  const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
  const delim = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim())).map((r) => r.map((c, i) => ({ s: c.trim(), x0: i, x1: i + 1 })));
}

async function pdfRows(buf) {
  const pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: buf, cMapUrl: './vendor/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: './vendor/pdfjs/standard_fonts/' }).promise;
  const rows = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const tc = await (await doc.getPage(n)).getTextContent();
    const items = tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({ s: i.str, x0: i.transform[4], x1: i.transform[4] + i.width, y: i.transform[5], h: Math.abs(i.transform[3]) || 8 }));
    items.sort((a, b) => b.y - a.y || a.x0 - b.x0);
    const lines = [];
    for (const it of items) {
      const line = lines.find((l) => Math.abs(l.y - it.y) <= Math.max(2, it.h * 0.35));
      if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    lines.sort((a, b) => b.y - a.y);
    for (const l of lines) {
      l.items.sort((a, b) => a.x0 - b.x0);
      const cells = [];
      for (const it of l.items) {
        const last = cells[cells.length - 1];
        if (last && it.x0 - last.x1 < Math.max(3, it.h * 0.45)) { last.s += (it.x0 - last.x1 > 1 ? ' ' : '') + it.s; last.x1 = it.x1; }
        else cells.push({ s: it.s, x0: it.x0, x1: it.x1 });
      }
      rows.push(cells.map((c) => ({ s: c.s.trim(), x0: c.x0, x1: c.x1 })));
    }
  }
  return rows;
}

// ---------- De filas a movimientos ----------

// Papel de cada columna según su título (en español, inglés o alemán)
const COLS = [
  ['date', /^(fecha|date|time|hora|tiempo de ejecucion|datum|trade date|fecha de (la )?operacion|fecha de pago|fecha valor|fecha ejecucion|fecha y hora)/],
  ['isin', /^isin/],
  ['wht', /withholding|retencion|^wht$/],
  ['fee', /comision|commission|^fee|fees|costes? de transaccion|gastos|conversion fee|tarifas?$/],
  ['qty', /no\.? of shares|^shares|cantidad|quantity|^numero|titulos|participaciones|^qty|anzahl|unidades|participaciones elegibles/],
  ['price', /price|precio|cotizacion|kurs|importe por accion/],
  ['action', /^action|^accion|^tipo$|^tipo de operacion|direccion|^operacion|^type|^side|sentido|compra\/venta|movimiento|descripcion/],
  ['ticker', /^ticker|simbolo|symbol|instrumento|^codigo/],
  ['name', /^name|^nombre|^producto|^product|^valor$|^activo|^empresa/],
  ['total', /^total|importe|^amount|^neto|^value|^valor/],
  ['currency', /^currency|divisa|moneda/],
];
function headerMap(row) {
  const map = {};
  for (let i = 0; i < row.length; i++) {
    const h = normTxt(row[i].s);
    if (!h || h.length > 40) continue;
    for (const [role, re] of COLS) {
      if (!re.test(h)) continue;
      if (role === 'name' && /^valor$/.test(h) && map.name) { map.total = i; break; }
      if (role === 'total' || role === 'currency') { map[role] = i; break; }   // si hay varias, vale la última (moneda de la cuenta)
      if (map[role] == null) map[role] = i;
      break;
    }
  }
  const n = Object.keys(map).length;
  return n >= 3 && map.date != null && (map.qty != null || map.total != null) ? map : null;
}

// Para PDF: cada celda de datos va a la columna de cabecera más cercana
function alignToHeader(row, header) {
  const cols = header.cells.map((c) => (c.x0 + c.x1) / 2);
  const out = new Array(cols.length).fill('');
  for (const c of row) {
    const mid = (c.x0 + c.x1) / 2;
    let best = 0;
    for (let i = 1; i < cols.length; i++) if (Math.abs(cols[i] - mid) < Math.abs(cols[best] - mid)) best = i;
    out[best] = out[best] ? out[best] + ' ' + c.s : c.s;
  }
  return out;
}

function rowsToMoves(rows, text, isCsv) {
  const dec = guessDecimal(text);
  const moves = [], skipped = [];
  let header = null, section = null;
  for (const row of rows) {
    const joined = row.map((c) => c.s).join(' | ');
    const low = normTxt(joined);
    if (row.length <= 2 && /^dividendos?$|^dividends?$/.test(low)) { section = 'income'; continue; }
    if (row.length <= 2 && /transacciones|trades|operaciones|transactions/.test(low)) section = null;
    const hm = headerMap(row);
    // Tabla de dividendos: lo dice su título o, si no tiene columna de tipo de operación, sus columnas
    if (hm) { header = { map: hm, cells: row, income: section === 'income' || (hm.action == null && /fecha de pago|dividend|importe por accion|participaciones elegibles/.test(low)) }; continue; }
    const date = parseDateCell(joined);
    if (!date) continue;
    const mv = (header && parseWithHeader(row, header, dec, isCsv, date)) || parseHeuristic(row, dec, date);
    if (!mv) continue;
    if (mv.kind === 'skip') { skipped.push(mv); continue; }
    moves.push(mv);
  }
  return { moves, skipped };
}

function parseWithHeader(row, header, dec, isCsv, date) {
  const cells = isCsv ? row.map((c) => c.s) : alignToHeader(row, header);
  const get = (k) => (header.map[k] != null ? cells[header.map[k]] || '' : '');
  const isin = (get('isin').match(ISIN_RE) || cells.join(' ').match(ISIN_RE) || [])[1] || '';
  const ticker = get('ticker').trim();
  const name = get('name').trim();
  if (!isin && !ticker && !name) return null;
  let kind = header.income ? 'income' : classifyAction(get('action') || cells.join(' '));
  let qty = Math.abs(parseAmount(get('qty'), dec));
  const rawQty = parseAmount(get('qty'), dec);
  let total = parseAmount(get('total'), dec);
  const price = Math.abs(parseAmount(get('price'), dec));
  if (!kind && header.map.action == null && rawQty) kind = rawQty < 0 ? 'sell' : 'buy';     // sin columna de tipo: el signo manda
  if (!kind) return { kind: 'skip', why: 'tipo de movimiento desconocido', text: cells.join(' · '), date: date.key };
  if (kind === 'skip') return { kind: 'skip', why: 'no es una compra, venta ni dividendo', text: cells.join(' · '), date: date.key };
  const cur = cellCurrency(get('currency')) || cellCurrency(get('total')) || cellCurrency(get('price')) || null;
  const fee = Math.abs(parseAmount(get('fee'), dec)) || 0;
  const wht = Math.abs(parseAmount(get('wht'), dec)) || 0;
  if (kind === 'income') {
    const amount = Math.abs(total) || (qty && price ? qty * price : NaN);
    if (!(amount > 0)) return null;
    // En los dividendos, el importe que se apunta es el bruto y la retención va aparte
    const gross = wht && header.map.wht != null && header.map.total != null && Math.abs(total) < amount + wht ? Math.abs(total) + wht : amount;
    return { date: date.key, t: date.t, kind, isin, ticker, name, units: null, price: null, amount: gross, fee: wht, currency: cur };
  }
  if (!(qty > 0)) return null;
  let amount = Math.abs(total);
  if (isNaN(amount)) amount = price * qty;
  else if (fee && price) {
    // Unos brókeres dan el importe sin la comisión y otros con ella: se comprueba con cantidad × precio
    const gross = qty * price, withFee = kind === 'buy' ? gross + fee : gross - fee;
    if (Math.abs(amount - withFee) < Math.abs(amount - gross)) amount = gross;
  }
  if (!(amount >= 0)) return null;
  return { date: date.key, t: date.t, kind, isin, ticker, name, units: qty, price: qty ? amount / qty : price, amount, fee, currency: cur };
}

// Sin cabecera: la fila tiene que traer fecha, compra/venta, ISIN y tres números que cuadren (cantidad × precio ≈ importe)
function parseHeuristic(row, dec, date) {
  const joined = row.map((c) => c.s).join(' ');
  const isin = (joined.match(ISIN_RE) || [])[1];
  if (!isin) return null;
  const kind = classifyAction(joined);
  if (!kind) return null;
  if (kind === 'skip') return { kind: 'skip', why: 'no es una compra, venta ni dividendo', text: joined, date: date.key };
  const nums = [];
  for (const c of row) {
    if (ISIN_RE.test(c.s) || parseDateCell(c.s)) continue;
    for (const tok of c.s.split(/\s+/)) {
      const v = parseAmount(tok, dec);
      if (!isNaN(v) && v !== 0 && !/^\d{7,}$/.test(tok)) nums.push({ v: Math.abs(v), cur: cellCurrency(c.s) });
    }
  }
  if (kind === 'income') {
    const last = nums[nums.length - 1];
    return last ? { date: date.key, t: date.t, kind, isin, ticker: '', name: '', units: null, price: null, amount: last.v, fee: 0, currency: last.cur } : null;
  }
  for (let i = 0; i < nums.length; i++) for (let j = 0; j < nums.length; j++) {
    if (i === j) continue;
    const q = nums[i].v, p = nums[j].v;
    for (let k = nums.length - 1; k >= 0; k--) {
      if (k === i || k === j) continue;
      const t = nums[k].v;
      if (t > 0 && Math.abs(q * p - t) / t < 0.015) {
        return { date: date.key, t: date.t, kind, isin, ticker: '', name: '', units: q, price: t / q, amount: t, fee: 0, currency: nums[k].cur || nums[j].cur };
      }
    }
  }
  return null;
}

// ---------- Agrupar, juntar recompras y comparar con lo que ya hay ----------

function assetKey(m) { return m.isin || ('T:' + (m.ticker || m.name).toUpperCase()); }
function moveFingerprint(key, m) {
  return [key, m.date, m.kind, (m.units || 0).toFixed(6), (m.amount || 0).toFixed(2), ((m.unitsOut || 0)).toFixed(6)].join('|');
}
function findInvestment(a) {
  const isin = a.isin, tk = (a.ticker || '').toUpperCase(), nm = normTxt(a.name);
  return state.investments.find((i) => isin && (i.ticker || '').toUpperCase() === isin)
    || state.investments.find((i) => tk && ((i.ticker || '').toUpperCase() === tk || (i.priceSource || '').toUpperCase().endsWith(':' + tk)))
    || state.investments.find((i) => nm && nm.length > 3 && normTxt(i.name) === nm);
}
// «BANCO SANTANDER» → «Banco Santander» (los nombres que vienen todo en mayúsculas)
function prettyName(n) {
  n = String(n || '').trim();
  if (!n || n !== n.toUpperCase() || n.length <= 4) return n;
  return n.toLowerCase().replace(/(^|[\s\-/(])([a-záéíóúñü])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Sa|Se|Ag|Nv|Plc|Etf|Etc|Ucits)\b/g, (x) => x.toUpperCase());
}

// Nombre de un activo por su ISIN, con la lista que trae la pestaña Noticias (si ya se ha descargado)
function nameFromCatalog(isin) {
  if (!isin) return '';
  let cat = newsData && newsData.catalog;
  if (!cat) { try { cat = (JSON.parse(localStorage.getItem('inv.newsCache')) || {}).catalog; } catch (e) { cat = null; } }
  const hit = (cat || []).find((c) => c.match.isin.includes(isin));
  return hit ? hit.label : '';
}

function guessType(a) {
  const n = normTxt(a.name + ' ' + a.ticker);
  if (/\b(btc|eth|sol|xrp|bitcoin|ethereum|cripto|crypto)\b/.test(n)) return 'cripto';
  if (/etf|etc|ucits|ishares|vanguard|xtrackers|amundi|invesco|spdr|physical|gold|silver/.test(n)) return 'etf';
  if (/fondo|fund|fi\b|sicav/.test(n)) return 'fondos';
  if (a.isin && /^(IE|LU)/.test(a.isin)) return 'etf';
  return 'acciones';
}

function buildDraft(moves, skipped, broker, fileName) {
  const groups = new Map();
  for (const m of moves) {
    const k = assetKey(m);
    if (!groups.has(k)) groups.set(k, { key: k, isin: m.isin, ticker: m.ticker, name: m.name, currency: m.currency, moves: [] });
    const g = groups.get(k);
    g.name = g.name || m.name; g.ticker = g.ticker || m.ticker; g.currency = g.currency || m.currency;
    g.moves.push(m);
  }
  for (const g of groups.values()) {
    g.moves.sort((a, b) => a.t - b.t);
    g.inv = findInvestment(g);
    g.name = nameFromCatalog(g.isin) || prettyName(g.name);
    g.label = (g.inv && g.inv.name) || g.name || g.ticker || g.isin;
    const prev = new Set(state.moves.filter((x) => g.inv && x.invId === g.inv.id && x.fp).map((x) => x.fp));
    g.hasImported = prev.size > 0;
    g.prev = prev;
    // Por defecto: lo nuevo, sí; lo que ya tienes apuntado a mano, no (para no contarlo dos veces)
    g.selected = !g.inv || g.hasImported;
  }
  return { broker, fileName, groups: [...groups.values()].sort((a, b) => a.label.localeCompare(b.label, 'es')), skipped, rebuys: true };
}

// Una venta seguida (en menos de una hora, o el mismo día si no hay hora) de compras del mismo activo es una recompra
function withRebuys(list) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const s = list[i];
    if (s.kind !== 'sell') { out.push(s); continue; }
    const buys = [];
    let j = i + 1;
    while (j < list.length && list[j].kind === 'buy' && (list[j].t - s.t) <= 3600 * 1000 && list[j].date === s.date) { buys.push(list[j]); j++; }
    if (!buys.length) { out.push(s); continue; }
    const units = buys.reduce((a, b) => a + b.units, 0), amount = buys.reduce((a, b) => a + b.amount, 0), fee = buys.reduce((a, b) => a + (b.fee || 0), 0) + (s.fee || 0);
    out.push({ date: s.date, t: s.t, kind: 'rebuy', unitsOut: s.units, priceOut: s.price, amountOut: s.amount, units, price: amount / units, amount, fee });
    i = j - 1;
  }
  return out;
}

function groupPlan(g) {
  const list = importDraft.rebuys ? withRebuys(g.moves) : g.moves.slice();
  for (const m of list) m.fp = moveFingerprint(g.isin || g.key, m);
  const fresh = list.filter((m) => !g.prev.has(m.fp));
  let held = g.inv ? calc(g.inv).held : 0, short = false;
  for (const m of fresh) {
    if (m.kind === 'buy') held += m.units;
    else if (m.kind === 'sell') { if (held - m.units < -1e-6) short = true; held = Math.max(0, held - m.units); }
    else if (m.kind === 'rebuy') { if (held - m.unitsOut < -1e-6) short = true; held = Math.max(0, held + m.units - m.unitsOut); }
  }
  const count = (k) => fresh.filter((m) => m.kind === k).length;
  return { list, fresh, dup: list.length - fresh.length, held: Math.max(0, held), short, n: { buy: count('buy'), sell: count('sell'), income: count('income'), rebuy: count('rebuy') } };
}

// ---------- Pantalla ----------

function renderImport() {
  setChrome({ title: 'Importar movimientos', tab: 'moves', back: '#/movimientos' });
  if (!importDraft) {
    view.innerHTML = `
      <section class="card">
        <p style="margin-top:0">Sube el extracto de movimientos de tu bróker y la app apuntará sola las compras, las ventas y los dividendos. Antes de apuntar nada te enseña lo que ha encontrado para que lo revises.</p>
        <button class="btn" type="button" id="imp-pick">Elegir archivo (PDF o CSV)</button>
        <input type="file" id="imp-file" accept=".pdf,.csv,.txt,application/pdf,text/csv" hidden>
        <p class="note" style="margin:12px 0 0">El archivo se lee en tu teléfono y no se envía a ningún sitio.</p>
      </section>
      <h2 class="section-title">Consejos</h2>
      <div class="card note-card">
        <p><b>Trading 212:</b> su PDF no deja leer los números. Descarga el CSV: en la app de Trading 212, <i>Historial → icono de descarga → Exportar historial</i>, elige las fechas y guárdalo en Archivos.</p>
        <p><b>Otros brókeres</b> (Interactive Brokers, DEGIRO, MyInvestor, bancos…): sirve el extracto de operaciones en PDF o, mejor aún, en CSV.</p>
        <p style="margin-bottom:0">Si un archivo no se lee bien, pásaselo a Claude para que la app aprenda ese formato.</p>
      </div>`;
    $('#imp-pick').addEventListener('click', () => $('#imp-file').click());
    $('#imp-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) readStatement(f); });
    return;
  }
  const d = importDraft;
  const plans = d.groups.map((g) => ({ g, p: groupPlan(g) }));
  const total = plans.filter((x) => x.g.selected).reduce((s, x) => s + x.p.fresh.length, 0);
  view.innerHTML = `
    <section class="card">
      <h2 style="margin-bottom:6px">${esc(d.fileName)}</h2>
      <p style="margin:0">${d.broker ? 'Bróker: <b>' + esc(d.broker) + '</b> · ' : ''}${d.groups.reduce((s, g) => s + g.moves.length, 0)} movimientos de ${d.groups.length} activos.</p>
      <label class="check"><input type="checkbox" id="imp-rebuy" ${d.rebuys ? 'checked' : ''}> <span>Juntar cada venta con su recompra inmediata (así no cambia tu precio real de compra)</span></label>
    </section>
    <div class="list">${plans.map(({ g, p }, i) => `
      <label class="row imp-row">
        <input type="checkbox" class="imp-g" data-i="${i}" ${g.selected ? 'checked' : ''}>
        <span class="main">
          <div class="t">${esc(g.label)}${g.inv ? '' : ' <span class="tag">nueva</span>'}</div>
          <div class="s">${esc([g.isin, g.ticker].filter(Boolean).join(' · '))}</div>
          <div class="s">${[p.n.buy && p.n.buy + ' compras', p.n.sell && p.n.sell + ' ventas', p.n.rebuy && p.n.rebuy + ' recompras', p.n.income && p.n.income + ' dividendos'].filter(Boolean).join(', ') || 'nada nuevo'}${p.dup ? ' · ' + p.dup + ' ya estaban' : ''}</div>
          ${g.inv && !g.hasImported ? '<div class="s warn">Ya la tienes apuntada: márcala solo si estos movimientos no están ya en la app.</div>' : ''}
          ${p.short ? '<div class="s warn">Vende más de lo que había: faltan compras anteriores a las fechas del extracto. Si tienes el extracto de antes, impórtalo también.</div>' : ''}
        </span>
        <span class="end num"><div>${units(p.held)}</div><div class="s">quedarían</div></span>
      </label>`).join('')}
    </div>
    ${d.skipped.length ? `<details class="card"><summary>${d.skipped.length} filas que no se apuntan (traspasos, ingresos de dinero…)</summary><ul class="skip-list">${d.skipped.slice(0, 60).map((s) => `<li>${esc(s.date)} · ${esc(s.text.slice(0, 90))}</li>`).join('')}</ul></details>` : ''}
    <button class="btn" type="button" id="imp-apply" ${total ? '' : 'disabled'}>Apuntar ${total} movimientos</button>
    <p></p>
    <button class="btn secondary" type="button" id="imp-other">Elegir otro archivo</button>`;
  $('#imp-rebuy').addEventListener('change', (e) => { d.rebuys = e.target.checked; renderImport(); });
  for (const c of view.querySelectorAll('.imp-g')) c.addEventListener('change', () => { d.groups[+c.dataset.i].selected = c.checked; renderImport(); });
  $('#imp-other').addEventListener('click', () => { importDraft = null; renderImport(); });
  $('#imp-apply').addEventListener('click', applyImport);
}

async function readStatement(file) {
  view.innerHTML = '<div class="card empty"><p>Leyendo el archivo…</p></div>';
  try {
    const isPdf = /\.pdf$/i.test(file.name) || file.type === 'application/pdf';
    let rows, text;
    if (isPdf) {
      rows = await pdfRows(new Uint8Array(await file.arrayBuffer()));
      text = rows.map((r) => r.map((c) => c.s).join(' ')).join('\n');
      const digits = (text.match(/\d/g) || []).length;
      if (text.includes('\u0000') || (text.length > 500 && digits < text.length * 0.02)) {
        throw new Error('Este PDF no deja leer los números (le pasa, por ejemplo, a los de Trading 212). Descarga el extracto en CSV y súbelo.');
      }
    } else {
      rows = csvRows(await file.text());
      text = rows.map((r) => r.map((c) => c.s).join(' | ')).join('\n');
    }
    const { moves, skipped } = rowsToMoves(rows, text, !isPdf);
    if (!moves.length) throw new Error('No he encontrado compras, ventas ni dividendos en este archivo. Si es un extracto de operaciones, pásaselo a Claude para que la app aprenda a leer ese formato.');
    importDraft = buildDraft(moves, skipped, detectBroker(text + ' ' + file.name), file.name);
    renderImport();
  } catch (err) {
    console.error(err);
    importDraft = null;
    renderImport();
    alert(err && err.message && !/^[A-Z][a-z]+Error/.test(err.name || '') ? err.message : 'No se ha podido leer el archivo: ' + (err && err.message));
  }
}

function applyImport() {
  const d = importDraft;
  let added = 0, created = 0;
  for (const g of d.groups) {
    if (!g.selected) continue;
    const p = groupPlan(g);
    if (!p.fresh.length) continue;
    let inv = g.inv;
    if (!inv) {
      inv = { id: uid(), name: g.name || g.ticker || g.isin, type: guessType(g), mode: 'units', platform: d.broker, ticker: g.isin || g.ticker,
        notes: 'Importada de ' + d.fileName, price: null, priceDate: null, value: null, valueDate: null, created: Date.now() };
      if (g.currency && g.currency !== state.currency) inv.currency = g.currency;
      state.investments.push(inv); created++;
    }
    for (const m of p.fresh) {
      const mv = { id: uid(), created: Date.now(), invId: inv.id, kind: m.kind, date: m.date, units: m.units, price: m.price, amount: m.amount, fee: m.fee || 0, note: 'Importado de ' + (d.broker || d.fileName), fp: m.fp };
      if (m.kind === 'rebuy') Object.assign(mv, { unitsOut: m.unitsOut, priceOut: m.priceOut, amountOut: m.amountOut });
      state.moves.push(mv); added++;
      // El último precio de compra o venta sirve de precio actual hasta que se actualice
      if (m.price != null && (!inv.priceDate || m.date >= inv.priceDate)) { inv.price = m.price; inv.priceDate = m.date; inv.priceSource = null; }
    }
  }
  saveState();
  importDraft = null;
  toast(added + ' movimientos apuntados' + (created ? ' · ' + created + ' inversiones nuevas' : ''));
  go('#/movimientos');
}
