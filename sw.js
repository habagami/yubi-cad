// オフライン用のキャッシュ(アプリ本体のみ)
const CACHE = 'naiso-zumen-v18';
const FILES = ['./', 'index.html', 'css/style.css', 'js/splash.js', 'js/config.js', 'js/store.js', 'js/catalog.js', 'js/render.js', 'js/solve.js', 'js/detect.js', 'js/check.js', 'js/elevation.js', 'js/estimate.js', 'js/dxf.js', 'js/ai.js', 'js/app.js', 'js/photomeasure.js', 'manifest.webmanifest', 'icon.svg', 'icon-light.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'wordmark.svg', 'sample-plan.jpg'];
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // ネット優先、オフライン時はキャッシュ
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((ca) => ca.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
});
