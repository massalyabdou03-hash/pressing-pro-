/* Pressing Pro : fait fonctionner l'app sans connexion.
   - Pages : réseau d'abord, copie locale si pas de réseau.
   - Fichiers du site : réseau d'abord (3 s max), sinon la copie locale. Une mise à jour arrive donc dès l'ouverture.
   - Librairies et polices (CDN) : copie locale d'abord.
   - Données (Supabase) : jamais mises en cache ici, l'app gère sa propre file d'attente. */
const VERSION = 'pp-v4';
const CORE = [
  '/app.html',
  '/assets/style.css',
  '/assets/core.js',
  '/assets/app.js',
  '/assets/config.js',
  '/assets/icons/logo.svg',
  '/assets/icons/icon-192.png',
  '/assets/icons/apple-touch-icon.png',
  '/manifest.webmanifest',
  '/admin.html',
  '/assets/admin.js',
  '/assets/icons/admin.svg',
  '/assets/icons/admin-192.png',
  '/admin.webmanifest',
  '/suivi.html',
  '/assets/vendor/qrcode.js',
  '/assets/vendor/supabase.js',
  '/assets/vendor/591.supabase.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(VERSION)
      .then(cache => Promise.all(CORE.map(url => cache.add(new Request(url, { cache: 'reload' })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const CDN = /(^|\.)(jsdelivr\.net|cloudflare\.com|googleapis\.com|gstatic\.com)$/;

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (/supabase\.(co|in)$/.test(url.hostname)) return;

  // Pages : réseau d'abord, sinon la copie (l'app pour toute page de l'app)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }).catch(async () => {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        if (url.pathname.startsWith('/admin')) return caches.match('/admin.html');
        return caches.match('/app.html');
      })
    );
    return;
  }

  // Librairies et polices : copie locale d'abord
  if (CDN.test(url.hostname)) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  // Fichiers du site : réseau d'abord (3 s max), sinon la copie locale
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(VERSION).then(async cache => {
        const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
        const late = new Promise(r => setTimeout(r, 3000));
        const hit = await Promise.race([net.then(() => null, () => 'fail'), late.then(() => 'slow')]);
        if (hit === null) return net;
        const copy = await cache.match(req);
        return copy || net;
      })
    );
  }
});
