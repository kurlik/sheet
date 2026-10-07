/* Critical Roll: офлайн и обновления. Меняйте VERSION при каждой выкладке index.html. */
const VERSION = 'sheet-6.8.4';
const APPV = VERSION.slice(6);   // та же версия, что APP_VERSION в index.html
const CORE = ['./index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
const PAGE_HDR = { headers: { 'Content-Type': 'text/html; charset=utf-8' } };
/* 6.8.4: всё качаем мимо HTTP-кэша браузера (cache: 'reload'), иначе до 10 минут ловили старую страницу.
   Если свежая страница уже лежит в кэше (её положила кнопка «Обновить»), второй раз 4,6 МБ не качаем. */
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await Promise.all(CORE.map(async u => {
      if (u === './index.html') {
        const old = await caches.match('./index.html');
        if (old) { const t = await old.text(); if (t.indexOf("APP_VERSION = '" + APPV + "'") >= 0) { await c.put(u, new Response(t, PAGE_HDR)); return; } }
      }
      const res = await fetch(new Request(u, { cache: 'reload' }));
      if (!res.ok) throw new Error(u + ' ' + res.status);
      await c.put(u, res);
    }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url); if (u.origin !== self.location.origin) return;   // Firebase и прочее — мимо кэша
  if (u.pathname.endsWith('/service-worker.js') || r.cache === 'no-store') return;   // проверка обновлений — всегда с сайта
  const page = r.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('/index.html');
  if (page) {   // страница: сеть (с проверкой свежести), но не дольше 3 с — дальше из кэша; без сети — из кэша
    let put = Promise.resolve(), req = r;
    try { req = new Request(r, { cache: 'no-cache' }); } catch (x) { req = r; }
    const net = fetch(req).then(res => { if (res.ok && res.type === 'basic') { const c = res.clone(); put = caches.open(VERSION).then(x => x.put('./index.html', c)); } return res; });
    const cached = () => caches.match('./index.html').then(m => m || caches.match('./'));
    e.waitUntil(net.then(() => put).catch(() => {}));
    e.respondWith(new Promise(done => {
      let over = false; const t = setTimeout(() => cached().then(m => { if (m && !over) { over = true; done(m); } }), 3000);
      net.then(res => { if (!over) { over = true; clearTimeout(t); done(res); } })
        .catch(() => cached().then(m => { if (!over) { over = true; clearTimeout(t); done(m || Response.error()); } }));
    }));
    return;
  }
  e.respondWith(caches.match(r, { ignoreSearch: false }).then(m => m || fetch(r).then(res => { if (res.ok && !u.search) { const c = res.clone(); caches.open(VERSION).then(x => x.put(r, c)); } return res; })));
});
