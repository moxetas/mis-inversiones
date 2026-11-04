"""Descarga noticias gratuitas en español sobre tus activos y la bolsa, para la pestaña Noticias de la app.

Fuente: Google Noticias en español (búsquedas por activo), que reúne noticias de webs de economía.
Se quitan las webs de pago, para que todas se puedan leer enteras. La app no puede descargarlas
directamente desde el iPhone, así que una tarea de GitHub Actions ejecuta este script cada media hora.
Uso: python3 scripts/noticias.py salida.json
"""
import email.utils, html, json, re, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

GOOGLE = 'https://news.google.com/rss/search'
# (clave que usa la app, búsqueda en Google Noticias). when:Nd = solo de los últimos N días.
FEEDS = [
    ('bolsa', 'Ibex 35 OR "Wall Street" OR "bolsa española" when:2d'),
    ('cripto', 'bitcoin OR criptomonedas OR ethereum when:2d'),
    ('NASDAQ:AMD', 'AMD acciones when:7d'),
    ('NASDAQ:TSLA', 'Tesla acciones when:7d'),
    ('NASDAQ:AAPL', 'Apple acciones when:7d'),
    ('BME:IBE', 'Iberdrola when:7d'),
    ('BME:CABK', 'CaixaBank when:7d'),
    ('MSCI', '"MSCI World" OR "MSCI ACWI" OR "bolsa mundial" OR "renta variable global" when:7d'),
    ('TVC:SILVER', '"precio de la plata" when:7d'),
    ('TVC:GOLD', '"precio del oro" when:7d'),
    ('BITSTAMP:BTCUSD', 'bitcoin precio when:3d'),
]
# Webs con muro de pago (no se podrían leer enteras sin suscripción)
DE_PAGO = {'expansión', 'expansion', 'cinco días', 'cincodías', 'cincodias', 'el país', 'el pais', 'el mundo', 'abc',
           'la vanguardia', 'the wall street journal', 'wall street journal', 'financial times', 'bloomberg',
           'el correo', 'diario vasco', 'la voz de galicia', 'el diario montañés', 'heraldo de aragón'}
PER_FEED = 30
MAX_DAYS = 10

def fetch(q):
    url = GOOGLE + '?' + urllib.parse.urlencode({'q': q, 'hl': 'es', 'gl': 'ES', 'ceid': 'ES:es'})
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (moxetas-invest noticias)'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return ET.fromstring(r.read())

def items(root):
    out, seen = [], set()
    for it in root.iter('item'):
        title = (it.findtext('title') or '').strip()
        src_el = it.find('source')
        source = (src_el.text or '').strip() if src_el is not None else ''
        if source and title.endswith(' - ' + source):
            title = title[: -len(' - ' + source)].strip()
        try:
            published = int(email.utils.parsedate_to_datetime(it.findtext('pubDate')).timestamp())
        except Exception:
            continue
        key = re.sub(r'\W+', ' ', title.lower()).strip()
        if not title or key in seen or source.lower() in DE_PAGO:
            continue
        if time.time() - published > MAX_DAYS * 86400:
            continue
        seen.add(key)
        out.append({'id': it.findtext('guid') or it.findtext('link'), 'title': html.unescape(title), 'source': source,
                    'published': published, 'url': it.findtext('link')})
    return sorted(out, key=lambda x: -x['published'])[:PER_FEED]

def main(out):
    feeds, errors = {}, []
    for key, q in FEEDS:
        try:
            feeds[key] = items(fetch(q))
            srcs = {}
            for x in feeds[key]: srcs[x['source']] = srcs.get(x['source'], 0) + 1
            top = ', '.join(f'{s} ({n})' for s, n in sorted(srcs.items(), key=lambda kv: -kv[1])[:5])
            print(f'{key:16} {len(feeds[key]):3} | {top}')
            if feeds[key]: print(f'{"":16}     ↳ {feeds[key][0]["title"][:90]}')
        except Exception as e:                 # una búsqueda caída no impide publicar las demás
            errors.append(f'{key}: {e}')
            print(f'{key:16} ERROR {e}')
        time.sleep(1)
    if not any(feeds.values()):
        sys.exit('No se ha podido descargar ninguna noticia: ' + '; '.join(errors))
    data = {'updated': int(time.time()), 'source': 'Google Noticias', 'feeds': feeds, 'errors': errors}
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f'Total: {sum(len(v) for v in feeds.values())} noticias en {len(feeds)} secciones')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'noticias.json')
