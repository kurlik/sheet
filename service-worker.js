/* Critical Roll: офлайн и обновления. Меняйте VERSION при каждой выкладке index.html. */
const VERSION = 'sheet-7.14.0';
const APPV = VERSION.slice(6);   // та же версия, что APP_VERSION в index.html
const CORE = ['./index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png'];
const PAGE_HDR = { headers: { 'Content-Type': 'text/html; charset=utf-8' } };
/* 6.8.6: картинки лежат файлами img/<хеш>.webp (имя от содержимого) в своём кэше IMG, который живёт между выпусками:
   при обновлении качается только страница, а картинок — лишь новые. Список картинок берём из самой страницы. */
const IMG = 'cr-img-1';   // не «sheet-…»: кнопка «Обновить» кладёт страницу во все кэши sheet-*
/* 7.5: картинки каталога карты (map/<хеш>.webp) не качаются при установке: кэшируются, когда карта их впервые покажет,
   и живут в своём кэше MAP между выпусками (имя от содержимого — устареть не могут). */
const MAP = 'cr-map-1';
const imgList = html => [...new Set(html.match(/img\/[0-9a-f]{12}\.webp/g) || [])].map(x => './' + x);
async function cacheImgs(html) {
  const c = await caches.open(IMG), have = new Set((await c.keys()).map(r => new URL(r.url).pathname.replace(/^.*\//, '')));
  const need = imgList(html).filter(u => !have.has(u.slice(6)));
  for (let i = 0; i < need.length; i += 8) await Promise.all(need.slice(i, i + 8).map(async u => {
    const hit = await caches.match(u);   // уже лежит в кэше прошлой версии — не качаем заново
    const res = hit || await fetch(u);   // имя от содержимого: ответ из HTTP-кэша браузера тоже годится
    if (!res.ok) throw new Error(u + ' ' + res.status);
    await c.put(u, res);
  }));
}
/* 6.8.4: всё качаем мимо HTTP-кэша браузера (cache: 'reload'), иначе до 10 минут ловили старую страницу.
   Если свежая страница уже лежит в кэше (её положила кнопка «Обновить»), второй раз страницу не качаем. */
self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    let page = '';
    await Promise.all(CORE.map(async u => {
      if (u === './index.html') {
        const old = await caches.match('./index.html');
        if (old) { const t = await old.text(); if (t.indexOf("APP_VERSION = '" + APPV + "'") >= 0) { page = t; await c.put(u, new Response(t, PAGE_HDR)); return; } }
      }
      const res = await fetch(new Request(u, { cache: 'reload' }));
      if (!res.ok) throw new Error(u + ' ' + res.status);
      if (u === './index.html') page = await res.clone().text();
      await c.put(u, res);
    }));
    await cacheImgs(page);   // без всех картинок новая версия не встаёт: офлайн должен показывать всё
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(k => k !== VERSION && k !== IMG && k !== MAP).map(k => caches.delete(k)));
    // картинки, которых нет в текущей странице, больше не нужны
    const m = await caches.match('./index.html', { cacheName: VERSION });
    if (m) {
      const keep = new Set(imgList(await m.text()).map(u => u.slice(2))), c = await caches.open(IMG);
      await Promise.all((await c.keys()).filter(r => !keep.has(new URL(r.url).pathname.replace(/^.*\/img\//, 'img/'))).map(r => c.delete(r)));
    }
    await self.clients.claim();
  })());
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
  const box = /\/img\/[0-9a-f]{12}\.webp$/.test(u.pathname) ? IMG : /\/map\/[0-9a-f]{12}\.webp$/.test(u.pathname) ? MAP : VERSION;   // картинки — в свой кэш
  e.respondWith(caches.match(r, { ignoreSearch: false }).then(m => m || fetch(r).then(res => { if (res.ok && !u.search) { const c = res.clone(); caches.open(box).then(x => x.put(r, c)); } return res; })));
});
