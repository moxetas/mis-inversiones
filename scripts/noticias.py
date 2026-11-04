"""Descarga noticias en español de TradingView y las guarda en un JSON para la pestaña Noticias de la app.

La app no puede pedirlas directamente desde el iPhone (TradingView no lo permite desde otras webs),
así que una tarea de GitHub Actions ejecuta este script cada media hora y publica el resultado.
Uso: python3 scripts/noticias.py salida.json
"""
import json, sys, time, urllib.parse, urllib.request

API = 'https://news-headlines.tradingview.com/v2/headlines'
# (clave, parámetros). Las claves de símbolo son las que usa la app (NEWS_BY_ISIN en app.js).
FEEDS = [
    ('bolsa', {'category': 'stock'}),
    ('cripto', {'category': 'crypto'}),
    ('NASDAQ:AMD', {'symbol': 'NASDAQ:AMD'}),
    ('NASDAQ:TSLA', {'symbol': 'NASDAQ:TSLA'}),
    ('NASDAQ:AAPL', {'symbol': 'NASDAQ:AAPL'}),
    ('BME:IBE', {'symbol': 'BME:IBE'}),
    ('BME:CABK', {'symbol': 'BME:CABK'}),
    ('SP:SPX', {'symbol': 'SP:SPX'}),          # para el ETF MSCI ACWI (no hay noticias propias en español)
    ('TVC:SILVER', {'symbol': 'TVC:SILVER'}),
    ('TVC:GOLD', {'symbol': 'TVC:GOLD'}),
    ('BITSTAMP:BTCUSD', {'symbol': 'BITSTAMP:BTCUSD'}),
]
PER_FEED = 30

def fetch(params):
    q = urllib.parse.urlencode({'client': 'web', 'lang': 'es', **params})
    req = urllib.request.Request(f'{API}?{q}', headers={'User-Agent': 'moxetas-invest-noticias/1.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r).get('items', [])

def clean(it):
    return {
        'id': it.get('id'),
        'title': (it.get('title') or '').strip(),
        'source': it.get('source') or it.get('provider') or '',
        'published': it.get('published'),
        'url': 'https://es.tradingview.com' + it['storyPath'] if it.get('storyPath') else None,
        'symbols': [s.get('symbol') for s in (it.get('relatedSymbols') or [])][:6],
    }

def main(out):
    feeds, errors = {}, []
    for key, params in FEEDS:
        try:
            items = [clean(i) for i in fetch(params) if i.get('title') and i.get('published')]
            feeds[key] = sorted(items, key=lambda x: -x['published'])[:PER_FEED]
        except Exception as e:                 # una fuente caída no impide publicar las demás
            errors.append(f'{key}: {e}')
        time.sleep(0.5)
    if not feeds:
        sys.exit('No se ha podido descargar ninguna noticia: ' + '; '.join(errors))
    data = {'updated': int(time.time()), 'feeds': feeds, 'errors': errors}
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f'{sum(len(v) for v in feeds.values())} noticias en {len(feeds)} secciones' + (f'; errores: {errors}' if errors else ''))

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'noticias.json')
