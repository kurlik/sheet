/* Лист персонажа: офлайн и обновления. Меняйте VERSION при каждой выкладке index.html. */
const VERSION = 'sheet-6.7.1';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== self.location.origin) return;   // Firebase и прочее — мимо кэша
  const page = r.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('/index.html');
  if (page) {   // страница: сеть, но не дольше 3 с — дальше из кэша (свежая версия подтянется к следующему запуску); без сети — из кэша
    let put = Promise.resolve();
    const net = fetch(r).then(res => { if (res.ok) { const c = res.clone(); put = caches.open(VERSION).then(x => x.put('./index.html', c)); } return res; });
    const cached = () => caches.match('./index.html').then(m => m || caches.match('./'));
    e.waitUntil(net.then(() => put).catch(() => {}));
    e.respondWith(new Promise(done => {
      let over = false; const t = setTimeout(() => cached().then(m => { if (m && !over) { over = true; done(m); } }), 3000);
      net.then(res => { if (!over) { over = true; clearTimeout(t); done(res); } })
        .catch(() => cached().then(m => { if (!over) { over = true; clearTimeout(t); done(m || Response.error()); } }));
    }));
    return;
  }
  e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => { if (res.ok) { const c = res.clone(); caches.open(VERSION).then(x => x.put(r, c)); } return res; })));
});
