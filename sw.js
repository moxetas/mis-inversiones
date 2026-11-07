// Guarda la app en el teléfono para que abra aunque no haya cobertura.
// Cambia el número de CACHE cada vez que se publique una versión nueva.
const CACHE = 'inversiones-v24';
const LOGOS = 'logos-v1';
const FILES = [
  './',
  'index.html',
  'styles.css',
  'importar.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'icons/logos/amd.png',
  'icons/logos/apple.png',
  'icons/logos/caixabank.png',
  'icons/logos/iberdrola.png',
  'icons/logos/tesla.png',
  'icons/logos/bitcoin.png',
  'icons/logos/ishares.png',
  'icons/logos/xetra-gold.png',
  'icons/logos/invesco.png',
  'icons/logos/plat-interactive-brokers.svg',
  'icons/logos/plat-kraken.svg',
  'icons/logos/plat-bingx.svg',
  'icons/logos/plat-trezor.svg',
  'icons/logos/plat-ledger.png',
  'icons/logos/plat-trading-212.png',
  'icons/logos/plat-trade-republic.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== LOGOS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Primero la red, para que los cambios lleguen en cuanto haya conexión; sin conexión, la copia guardada
self.addEventListener('fetch', (event) => {
  const req = event.request;
  // Logos de TradingView: se guardan la primera vez y luego se usan aunque no haya conexión
  if (req.method === 'GET' && new URL(req.url).hostname === 's3-symbol-logo.tradingview.com') {
    event.respondWith(caches.open(LOGOS).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }))));
    return;
  }
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    // no-cache: pregunta siempre al servidor si hay versión nueva, en vez de usar una copia de hace minutos
    fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html')))
  );
});
