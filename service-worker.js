const CACHE = 'rpg-sheet-v7';
const SHELL = ["./","./index.html","./data.js","./data-kb.js","./app.js","./manifest.json","./icon-192.png","./icon-512.png","./icon-maskable-512.png","./apple-touch-icon.png","./bar.webp","./button.webp","./capsule.webp","./coin-bronze.webp","./coin-gold.webp","./coin-silver.webp","./divider.webp","./frame-teal.webp","./header.webp","./lock-closed.webp","./lock-open.webp","./medallion.webp","./nameplate.webp","./nav.webp","./pill.webp","./plaque-gems.webp","./scroll-bottom.webp","./scroll.webp","./select.webp","./splash.webp","./square.webp","./stat.webp","./tab-character-off.webp","./tab-character-on.webp","./tab-combat-off.webp","./tab-combat-on.webp","./tab-inventory-off.webp","./tab-inventory-on.webp","./texture.webp"];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;
  e.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      }).catch(() => cached || (req.mode === 'navigate' ? caches.match('./index.html') : undefined));
      return cached && sameOrigin ? cached : (cached || network);
    })
  );
});
