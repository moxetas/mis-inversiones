"""Descarga noticias gratuitas en español sobre unos 90 activos habituales y la bolsa, para la pestaña Noticias.

Fuente: Google Noticias en español (una búsqueda por activo). Se quitan las webs de pago y los titulares
que no están en español o no nombran al activo. La app reconoce sola qué activos tienes (por ISIN, ticker
o nombre, con la lista «catalog» que se publica junto a las noticias), así que si compras uno de esta
lista sus noticias aparecen sin hacer nada. Una tarea de GitHub Actions ejecuta este script cada hora.
Uso: python3 scripts/noticias.py salida.json
"""
import email.utils, hashlib, html, json, re, sys, time, urllib.parse, urllib.request
import xml.etree.ElementTree as ET

GOOGLE = 'https://news.google.com/rss/search'
MERCADO = '(acciones OR bolsa OR beneficio OR resultados OR dividendo OR cotización OR analistas)'

def empresa(key, nombre, isin=(), tickers=(), alias=(), must=None, q=None):
    """Una empresa: busca «nombre + palabras de mercado» y exige el nombre (o un alias) en el titular."""
    terms = [nombre.lower()] + [a.lower() for a in alias]
    return {'key': key, 'label': nombre, 'q': q or f'"{nombre}" {MERCADO} when:7d', 'must': must or terms,
            'match': {'isin': list(isin), 'tickers': list(tickers), 'names': terms}}

def tema(key, label, q, must=(), names=(), tickers=(), isin=()):
    return {'key': key, 'label': label, 'q': q, 'must': list(must),
            'match': {'isin': list(isin), 'tickers': list(tickers), 'names': list(names)}}

CATALOG = [
    # Secciones generales
    tema('bolsa', 'Bolsa', 'Ibex 35 OR "Wall Street" OR "bolsa española" OR "bolsas europeas" when:2d'),
    tema('cripto', 'Cripto', 'bitcoin OR criptomonedas OR ethereum when:2d'),
    # Índices, fondos y materias primas
    tema('MSCI', 'Bolsa mundial', '"MSCI World" OR "MSCI ACWI" OR "bolsa mundial" OR "renta variable global" OR "fondos indexados" when:7d',
         names=['msci', 'acwi', 'all country', 'all-world', 'ftse all-world'], isin=['IE00B6R52259', 'IE00BK5BQT80', 'IE00B4L5Y983', 'IE00BFY0GT14']),
    tema('SP500', 'S&P 500', '"S&P 500" when:3d', must=['s&p'], names=['s&p 500', 'sp500', 'core s&p'], isin=['IE00B5BMR087', 'IE00BFMXXD54']),
    tema('NASDAQ100', 'Nasdaq', '"Nasdaq" when:3d', must=['nasdaq'], names=['nasdaq 100', 'nasdaq-100'], isin=['IE00B53SZB19']),
    tema('ORO', 'Oro', '"precio del oro" OR "el oro" OR "oro sube" OR "oro cae" OR "onza de oro" when:7d', must=['oro'],
         names=['gold', 'oro'], tickers=['4GLD', 'GLD', 'SGLD', 'IGLN'], isin=['DE000A0S9GB0', 'IE00B579F325', 'IE00B4ND3602']),
    tema('PLATA', 'Plata', '"precio de la plata" OR "la plata" metales -"Onza Libertad" when:7d', must=['plata'],
         names=['silver', 'plata'], tickers=['8PSB', 'SLV', 'PHAG'], isin=['IE00B43VDT70', 'IE00B4NCWG09']),
    tema('PETROLEO', 'Petróleo', '"precio del petróleo" OR Brent when:3d', must=['petróleo', 'brent', 'crudo'], names=['oil', 'petróleo', 'brent', 'crude']),
    # Criptomonedas
    tema('BTC', 'Bitcoin', 'bitcoin precio when:3d', must=['bitcoin', 'btc'], names=['bitcoin'], tickers=['BTC']),
    tema('ETH', 'Ethereum', 'ethereum precio when:3d', must=['ethereum', 'ether'], names=['ethereum', 'ether'], tickers=['ETH']),
    tema('SOL', 'Solana', 'solana cripto when:7d', must=['solana'], names=['solana'], tickers=['SOL']),
    tema('XRP', 'XRP', 'XRP Ripple when:7d', must=['xrp', 'ripple'], names=['xrp', 'ripple'], tickers=['XRP']),
    # Ibex 35
    empresa('IBE', 'Iberdrola', isin=['ES0144580Y14'], tickers=['IBE']),
    empresa('CABK', 'CaixaBank', isin=['ES0140609019'], tickers=['CABK']),
    empresa('SAN', 'Santander', isin=['ES0113900J37'], tickers=['SAN'], q=f'"Banco Santander" {MERCADO} when:7d'),
    empresa('BBVA', 'BBVA', isin=['ES0113211835'], tickers=['BBVA']),
    empresa('ITX', 'Inditex', isin=['ES0148396007'], tickers=['ITX']),
    empresa('REP', 'Repsol', isin=['ES0173516115'], tickers=['REP']),
    empresa('TEF', 'Telefónica', isin=['ES0178430E18'], tickers=['TEF'], alias=['telefonica']),
    empresa('SAB', 'Sabadell', isin=['ES0113860A34'], tickers=['SAB'], q=f'"Banco Sabadell" {MERCADO} when:7d'),
    empresa('BKT', 'Bankinter', isin=['ES0113679I37'], tickers=['BKT']),
    empresa('UNI', 'Unicaja', isin=['ES0180907000'], tickers=['UNI']),
    empresa('MAP', 'Mapfre', isin=['ES0124244E34'], tickers=['MAP']),
    empresa('FER', 'Ferrovial', isin=['NL0015001FS8'], tickers=['FER']),
    empresa('ACS', 'ACS', isin=['ES0167050915'], tickers=['ACS'], q=f'"ACS" Florentino OR constructora {MERCADO} when:7d'),
    empresa('ANA', 'Acciona', isin=['ES0125220311'], tickers=['ANA']),
    empresa('ELE', 'Endesa', isin=['ES0130670112'], tickers=['ELE']),
    empresa('NTGY', 'Naturgy', isin=['ES0116870314'], tickers=['NTGY']),
    empresa('ENG', 'Enagás', isin=['ES0130960018'], tickers=['ENG'], alias=['enagas']),
    empresa('RED', 'Redeia', isin=['ES0173093024'], tickers=['RED'], alias=['red eléctrica']),
    empresa('AENA', 'Aena', isin=['ES0105046009'], tickers=['AENA']),
    empresa('IAG', 'IAG', isin=['ES0177542018'], tickers=['IAG'], alias=['iberia', 'british airways']),
    empresa('AMS', 'Amadeus', isin=['ES0109067019'], tickers=['AMS']),
    empresa('CLNX', 'Cellnex', isin=['ES0105066007'], tickers=['CLNX']),
    empresa('GRF', 'Grifols', isin=['ES0171996087'], tickers=['GRF']),
    empresa('IDR', 'Indra', isin=['ES0118594417'], tickers=['IDR']),
    empresa('MRL', 'Merlin Properties', isin=['ES0105025003'], tickers=['MRL'], alias=['merlin']),
    empresa('COL', 'Colonial', isin=['ES0139140174'], tickers=['COL']),
    empresa('FDR', 'Fluidra', isin=['ES0137650018'], tickers=['FDR']),
    empresa('LOG', 'Logista', isin=['ES0105027009'], tickers=['LOG']),
    empresa('ROVI', 'Rovi', isin=['ES0157261019'], tickers=['ROVI']),
    empresa('SCYR', 'Sacyr', isin=['ES0182870214'], tickers=['SCYR']),
    empresa('SLR', 'Solaria', isin=['ES0165386014'], tickers=['SLR']),
    empresa('PUIG', 'Puig', isin=['ES0105777017'], tickers=['PUIG']),
    empresa('MTS', 'ArcelorMittal', isin=['LU1598757687'], tickers=['MTS']),
    empresa('ACX', 'Acerinox', isin=['ES0132105018'], tickers=['ACX']),
    # EE. UU.
    empresa('AAPL', 'Apple', isin=['US0378331005'], tickers=['AAPL', 'APC']),
    empresa('MSFT', 'Microsoft', isin=['US5949181045'], tickers=['MSFT', 'MSF']),
    empresa('NVDA', 'Nvidia', isin=['US67066G1040'], tickers=['NVDA', 'NVD']),
    empresa('AMZN', 'Amazon', isin=['US0231351067'], tickers=['AMZN', 'AMZ']),
    empresa('GOOGL', 'Alphabet', isin=['US02079K3059', 'US02079K1079'], tickers=['GOOGL', 'GOOG', 'ABEA'], alias=['google']),
    empresa('META', 'Meta Platforms', isin=['US30303M1027'], tickers=['META', 'FB2A'], alias=['meta'], q=f'"Meta Platforms" OR (Meta Zuckerberg) {MERCADO} when:7d'),
    empresa('TSLA', 'Tesla', isin=['US88160R1014'], tickers=['TSLA', 'TL0']),
    empresa('AMD', 'AMD', isin=['US0079031078'], tickers=['AMD'], alias=['advanced micro devices']),
    empresa('INTC', 'Intel', isin=['US4581401001'], tickers=['INTC', 'INL']),
    empresa('AVGO', 'Broadcom', isin=['US11135F1012'], tickers=['AVGO', '1YD']),
    empresa('NFLX', 'Netflix', isin=['US64110L1061'], tickers=['NFLX', 'NFC']),
    empresa('PLTR', 'Palantir', isin=['US69608A1088'], tickers=['PLTR', 'PTX']),
    empresa('ORCL', 'Oracle', isin=['US68389X1054'], tickers=['ORCL', 'ORC']),
    empresa('CRM', 'Salesforce', isin=['US79466L3024'], tickers=['CRM', 'FOO']),
    empresa('KO', 'Coca-Cola', isin=['US1912161007'], tickers=['KO', 'CCC3'], alias=['coca cola']),
    empresa('NKE', 'Nike', isin=['US6541061031'], tickers=['NKE']),
    empresa('DIS', 'Disney', isin=['US2546871060'], tickers=['DIS', 'WDP']),
    empresa('V', 'Visa', isin=['US92826C8394'], tickers=['V', '3V64'], q=f'"Visa" pagos {MERCADO} when:7d'),
    empresa('MA', 'Mastercard', isin=['US57636Q1040'], tickers=['MA', 'M4I']),
    empresa('JPM', 'JPMorgan', isin=['US46625H1005'], tickers=['JPM', 'CMC'], alias=['jp morgan']),
    empresa('BRK', 'Berkshire Hathaway', isin=['US0846707026'], tickers=['BRK.B', 'BRYN'], alias=['berkshire', 'buffett']),
    empresa('LLY', 'Eli Lilly', isin=['US5324571083'], tickers=['LLY', 'LLY']),
    empresa('PFE', 'Pfizer', isin=['US7170811035'], tickers=['PFE']),
    empresa('UBER', 'Uber', isin=['US90353T1007'], tickers=['UBER', 'UT8']),
    empresa('PYPL', 'PayPal', isin=['US70450Y1038'], tickers=['PYPL', '2PP']),
    empresa('BA', 'Boeing', isin=['US0970231058'], tickers=['BA', 'BCO']),
    empresa('MCD', "McDonald's", isin=['US5801351017'], tickers=['MCD', 'MDO'], alias=['mcdonalds']),
    empresa('XOM', 'ExxonMobil', isin=['US30231G1022'], tickers=['XOM', 'XONA'], alias=['exxon']),
    empresa('ASTS', 'AST SpaceMobile', isin=['US00217D1000'], tickers=['ASTS', 'M6Q'], alias=['ast spacemobile']),
    empresa('RGTI', 'Rigetti', isin=['US76655K1034'], tickers=['RGTI', 'RGT']),
    empresa('SPCX', 'SpaceX', isin=['US84615Q1031'], tickers=['SPCX', 'SPX'], alias=['space exploration']),
    # Europa
    empresa('ASML', 'ASML', isin=['NL0010273215'], tickers=['ASML', 'ASME']),
    empresa('SAP', 'SAP', isin=['DE0007164600'], tickers=['SAP'], q=f'"SAP" software {MERCADO} when:7d'),
    empresa('VOW', 'Volkswagen', isin=['DE0007664005', 'DE0007664039'], tickers=['VOW', 'VOW3']),
    empresa('MC', 'LVMH', isin=['FR0000121014'], tickers=['MC', 'MOH']),
    empresa('SIE', 'Siemens', isin=['DE0007236101'], tickers=['SIE']),
    empresa('AIR', 'Airbus', isin=['NL0000235190'], tickers=['AIR']),
    empresa('NOVO', 'Novo Nordisk', isin=['DK0062498333'], tickers=['NOVO-B', 'NOVC'], alias=['novo']),
    empresa('NESN', 'Nestlé', isin=['CH0038863350'], tickers=['NESN', 'NESR'], alias=['nestle']),
    empresa('RACE', 'Ferrari', isin=['NL0011585146'], tickers=['RACE', '2FE']),
    empresa('ALV', 'Allianz', isin=['DE0008404005'], tickers=['ALV']),
    empresa('BMW', 'BMW', isin=['DE0005190003'], tickers=['BMW']),
    empresa('MBG', 'Mercedes-Benz', isin=['DE0007100000'], tickers=['MBG'], alias=['mercedes']),
    empresa('SHEL', 'Shell', isin=['GB00BP6MXD84'], tickers=['SHEL', 'R6C0']),
    empresa('TTE', 'TotalEnergies', isin=['FR0000120271'], tickers=['TTE', 'TOTB']),
    empresa('ADS', 'Adidas', isin=['DE000A1EWWW0'], tickers=['ADS']),
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
         'mercado mercados nuevo nueva gana pierde beneficio resultados analistas cotización máximos mínimos'.split())
EN = set('the and of to in for on with as after its is are stock stocks shares price rises falls soars new from by at '
         'why what how will earnings jumps slides surges beats misses'.split())
OTRO_ALFABETO = re.compile('[؀-ۿЀ-ӿ฀-๿぀-ヿ一-鿿가-힯'
                           'ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]', re.I)
PER_FEED = 20
MAX_DAYS = 10

def en_espanol(t):
    if OTRO_ALFABETO.search(t): return False
    w = re.findall(r'[a-záéíóúñü]+', t.lower())
    es, en = sum(x in ES for x in w), sum(x in EN for x in w)
    return es >= 1 and es >= en

def fetch(q):
    url = GOOGLE + '?' + urllib.parse.urlencode({'q': q, 'hl': 'es', 'gl': 'ES', 'ceid': 'ES:es'})
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (moxetas-invest noticias)'})
    for intento in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return ET.fromstring(r.read())
        except Exception:
            if intento == 2: raise
            time.sleep(5 * (intento + 1))

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
        low = title.lower()
        if not title or key in seen or source.lower() in DE_PAGO or source.lower() in OTRAS:
            continue
        if not en_espanol(title) or OTRO_ALFABETO.search(source) or (must and not any(m in low for m in must)):
            continue
        if time.time() - published > MAX_DAYS * 86400:
            continue
        seen.add(key)
        link = it.findtext('link') or ''
        out.append({'id': hashlib.md5(link.encode()).hexdigest()[:12], 'title': html.unescape(title), 'source': source,
                    'published': published, 'url': link})
    return sorted(out, key=lambda x: -x['published'])[:PER_FEED]

def main(out):
    feeds, errors = {}, []
    for c in CATALOG:
        try:
            feeds[c['key']] = items(fetch(c['q']), c['must'])
            first = feeds[c['key']][0]['title'][:80] if feeds[c['key']] else '—'
            print(f"{c['key']:10} {len(feeds[c['key']]):3} | {first}")
        except Exception as e:                 # una búsqueda caída no impide publicar las demás
            errors.append(f"{c['key']}: {e}")
            print(f"{c['key']:10} ERROR {e}")
        time.sleep(1.2)
    if not any(feeds.values()):
        sys.exit('No se ha podido descargar ninguna noticia: ' + '; '.join(errors))
    catalog = [{'key': c['key'], 'label': c['label'], 'match': c['match']} for c in CATALOG]
    data = {'updated': int(time.time()), 'source': 'Google Noticias', 'catalog': catalog, 'feeds': feeds, 'errors': errors}
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    print(f'Total: {sum(len(v) for v in feeds.values())} noticias en {len(feeds)} secciones; errores: {len(errors)}')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'noticias.json')
