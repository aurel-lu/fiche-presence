/* Mode hors-ligne : l'app est mise en cache à l'installation, puis servie depuis le cache
 * pendant qu'une copie fraîche est récupérée en arrière-plan pour l'ouverture suivante.
 * Changer VERSION à chaque mise en ligne pour que tous les fichiers soient renouvelés ensemble. */
const VERSION = 'fiche-presence-2';
const ASSETS = [
  './', 'index.html', 'styles.css', 'core.js', 'data.js', 'app.js', 'manifest.webmanifest',
  'icons/favicon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const cache = caches.open(VERSION);
  const cached = cache.then(c => c.match(req, { ignoreSearch: true }));
  const fresh = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res && res.ok) { const copy = res.clone(); cache.then(c => c.put(req, copy)); }
    return res;
  });
  event.respondWith(cached.then(hit => hit || fresh));
  event.waitUntil(fresh.catch(() => undefined));
});
