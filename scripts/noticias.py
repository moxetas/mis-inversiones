"""Descarga noticias gratuitas en español sobre tus activos y la bolsa, para la pestaña Noticias de la app.

Fuente: Google Noticias en español (búsquedas por activo), que reúne noticias de webs de economía.
Se quitan las webs de pago, para que todas se puedan leer enteras. La app no puede descargarlas
directamente desde el iPhone, así que una tarea de GitHub Actions ejecuta este script cada media hora.
Uso: python3 scripts/noticias.py salida.json
"""
import email.utils, html, json, re, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

GOOGLE = 'https://news.google.com/rss/search'
# (clave que usa la app, búsqueda en Google Noticias, palabras que deben salir en el titular).
# when:Nd = solo de los últimos N días.
MERCADO = '(acciones OR bolsa OR beneficio OR resultados OR dividendo OR cotización OR analistas)'
FEEDS = [
    ('bolsa', 'Ibex 35 OR "Wall Street" OR "bolsa española" OR "bolsas europeas" when:2d', []),
    ('cripto', 'bitcoin OR criptomonedas OR ethereum when:2d', []),
    ('NASDAQ:AMD', f'AMD {MERCADO} when:7d', ['amd']),
    ('NASDAQ:TSLA', f'Tesla {MERCADO} when:7d', ['tesla']),
    ('NASDAQ:AAPL', f'Apple {MERCADO} when:7d', ['apple']),
    ('BME:IBE', f'Iberdrola {MERCADO} when:7d', ['iberdrola']),
    ('BME:CABK', f'CaixaBank {MERCADO} when:7d', ['caixabank']),
    ('MSCI', '"MSCI World" OR "MSCI ACWI" OR "bolsa mundial" OR "renta variable global" OR "fondos indexados" when:7d', []),
    ('TVC:SILVER', '"precio de la plata" OR "la plata" metales -"Onza Libertad" when:7d', ['plata']),
    ('TVC:GOLD', '"precio del oro" OR "el oro" onza when:7d', ['oro']),
    ('BITSTAMP:BTCUSD', 'bitcoin precio when:3d', ['bitcoin', 'btc']),
]
# Webs con muro de pago (no se podrían leer enteras sin suscripción)
DE_PAGO = {'expansión', 'expansion', 'cinco días', 'cincodías', 'cincodias', 'el país', 'el pais', 'el mundo', 'abc',
           'la vanguardia', 'the wall street journal', 'wall street journal', 'financial times', 'bloomberg',
           'el correo', 'diario vasco', 'la voz de galicia', 'el diario montañés', 'heraldo de aragón',
           'marketscreener españa', 'marketscreener', 'reforma', 'larepublica.co', 'la república', 'el tiempo'}
# Webs que no son de economía en español o que salen en otros idiomas
OTRAS = {'vietnam.vn', 'www.tmgm.com', 'idnfinancials', 'quartz', 'yahoo', 'msn'}
# Palabras para comprobar que el titular está en español y no en inglés
ES = set('de la el los las en y que del por con para se su sus al un una tras sube suben cae caen bolsa acciones precio '
         'millones récord qué cómo más hoy frente entre sobre ante desde hasta es ya no lo como pero dólares euros año '
         'mercado mercados nuevo nueva gana pierde beneficio resultados analistas cotización hasta máximos mínimos'.split())
EN = set('the and of to in for on with as after its is are stock stocks shares price rises falls soars new from by at '
         'why what how will earnings jumps slides surges beats misses'.split())
OTRO_ALFABETO = re.compile('[\u0600-\u06FF\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF'
                           'ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]', re.I)

def en_espanol(t):
    if OTRO_ALFABETO.search(t): return False
    w = re.findall(r'[a-záéíóúñü]+', t.lower())
    es, en = sum(x in ES for x in w), sum(x in EN for x in w)
    return es >= 1 and es >= en
PER_FEED = 30
MAX_DAYS = 10

def fetch(q):
    url = GOOGLE + '?' + urllib.parse.urlencode({'q': q, 'hl': 'es', 'gl': 'ES', 'ceid': 'ES:es'})
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (moxetas-invest noticias)'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return ET.fromstring(r.read())

def items(root, must):
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
        if not title or key in seen or source.lower() in DE_PAGO or source.lower() in OTRAS:
            continue
        if not en_espanol(title) or (must and not any(m in title.lower() for m in must)):
            continue
        if time.time() - published > MAX_DAYS * 86400:
            continue
        seen.add(key)
        out.append({'id': it.findtext('guid') or it.findtext('link'), 'title': html.unescape(title), 'source': source,
                    'published': published, 'url': it.findtext('link')})
    return sorted(out, key=lambda x: -x['published'])[:PER_FEED]

def main(out):
    feeds, errors = {}, []
    for key, q, must in FEEDS:
        try:
            feeds[key] = items(fetch(q), must)
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
