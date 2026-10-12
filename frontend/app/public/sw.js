/* hotelapp — service worker.
 * Стратегия:
 *  - страницы (navigate): сначала сеть, без сети — последняя сохранённая копия;
 *  - собранные Vite файлы /assets/* (имя с хешем): из кеша, иначе сеть;
 *  - остальная статика (иконки, manifest): из кеша, в фоне обновляется;
 *  - backend/*.php, uploads и всё с других доменов — не трогаем, всегда сеть.
 * Уведомления о срочных заявках (push) — в конце файла.
 * Менять VERSION нужно только при правках самого sw.js.
 */
const VERSION = 'v6';
const SHELL_CACHE = `hotelapp-shell-${VERSION}`;
const ASSET_CACHE = `hotelapp-assets-${VERSION}`;
const MAX_ASSETS = 80;

const SCOPE = self.registration.scope;
const SHELL_URL = new URL('./', SCOPE).href;
const PRECACHE = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png']
  .map((p) => new URL(p, SCOPE).href);

const isBypassed = (url) =>
  url.origin !== self.location.origin ||
  url.pathname.includes('/backend/') ||
  url.pathname.includes('/uploads/') ||
  url.pathname.endsWith('.php') ||
  url.pathname.endsWith('/sw.js');

async function precache() {
  const shell = await caches.open(SHELL_CACHE);
  const assets = await caches.open(ASSET_CACHE);
  // Оболочка приложения и файлы, на которые она ссылается (js/css из сборки).
  try {
    const res = await fetch(SHELL_URL, { cache: 'no-cache' });
    if (res.ok) {
      await shell.put(SHELL_URL, res.clone());
      const html = await res.text();
      const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
        .map((m) => new URL(m[1], SHELL_URL))
        .filter((u) => !isBypassed(u))
        .map((u) => u.href);
      await Promise.all(refs.map((u) => assets.add(u).catch(() => {})));
    }
  } catch (e) { /* нет сети при установке — закешируется при первом заходе */ }
  await Promise.all(PRECACHE.map((u) => assets.add(u).catch(() => {})));
}

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL_CACHE, ASSET_CACHE];
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('hotelapp-') && !keep.includes(n)).map((n) => caches.delete(n)));
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

async function handleNavigate(event) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = (await event.preloadResponse) || (await fetch(event.request));
    if (res.ok && res.type === 'basic') cache.put(event.request, res.clone());
    return res;
  } catch (e) {
    const cached = (await cache.match(event.request, { ignoreSearch: true })) || (await cache.match(SHELL_URL));
    if (cached) return cached;
    const any = (await cache.keys())[0];
    if (any) return cache.match(any);
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Offline</title><body style="font-family:sans-serif;text-align:center;padding:40px;background:#e4e6eb">' +
      '<h2 style="color:#333">📡</h2><p>Нет связи / No connection</p>' +
      '<button onclick="location.reload()" style="padding:12px 24px;font-size:16px">⟳</button></body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
    );
  }
}

async function handleHashedAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) { await cache.put(request, res.clone()); trim(ASSET_CACHE, MAX_ASSETS); }
  return res;
}

async function handleStatic(event) {
  const cache = await caches.open(ASSET_CACHE);
  const cached = await cache.match(event.request);
  const network = fetch(event.request).then((res) => {
    if (res.ok) cache.put(event.request, res.clone());
    return res;
  });
  if (cached) { event.waitUntil(network.catch(() => {})); return cached; }
  return network;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (isBypassed(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(event));
  } else if (url.pathname.includes('/assets/')) {
    event.respondWith(handleHashedAsset(request));
  } else if (/\.(?:js|css|png|jpe?g|svg|webp|ico|woff2?|webmanifest|json)$/.test(url.pathname)) {
    event.respondWith(handleStatic(event));
  }
});

// ---------------------------------------------------------------- уведомления о срочных заявках
// Сервер (backend/core/push.php) присылает:
//   {type:'urgent', id, title, body, count, silent} — новая срочная заявка
//   {type:'done', id, count}                        — заявку выполнили (на iPhone не приходит)
// count — сколько срочных заявок открыто; это число на иконке приложения.

const ICON = new URL('icons/icon-192.png', SCOPE).href;

async function setBadge(count) {
  try {
    if (count > 0 && self.navigator.setAppBadge) await self.navigator.setAppBadge(count);
    else if (self.navigator.clearAppBadge) await self.navigator.clearAppBadge();
  } catch (e) { /* значки не поддерживаются */ }
}

async function tellClients(msg) {
  const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  list.forEach((c) => c.postMessage(msg));
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }

  event.waitUntil((async () => {
    if (data.type === 'done') {
      const list = await self.registration.getNotifications({ tag: `urgent-${data.id}` });
      list.forEach((n) => n.close());
      await setBadge(data.count || 0);
      await tellClients({ type: 'urgent-refresh' });
      return;
    }
    if (data.type !== 'urgent') return;
    const silent = !!data.silent;
    const rtl = data.lang === 'he' || data.lang === 'ar';
    await self.registration.showNotification(data.title || '🚨', {
      body: data.body || '',
      tag: `urgent-${data.id}`,
      renotify: !silent,
      silent,
      vibrate: silent ? [] : [300, 120, 300, 120, 300],
      requireInteraction: !silent,
      icon: ICON,
      dir: rtl ? 'rtl' : 'ltr',
      lang: data.lang || 'ru',
      timestamp: Date.now(),
      data: { id: data.id, hotel_id: data.hotel_id || 0 }
    });
    await setBadge(data.count || 1);
    await tellClients({ type: 'urgent-refresh' });
  })());
});

// Уведомление о срочной заявке висит, пока заявку не выполнят: нажатие его не убирает,
// а смахнутое показываем снова без звука (на Android от числа уведомлений зависит цифра на иконке).
self.addEventListener('notificationclose', (event) => {
  const n = event.notification;
  if (!/^urgent-\d+$/.test(n.tag || '')) return;
  event.waitUntil(self.registration.showNotification(n.title, {
    body: n.body, tag: n.tag, silent: true, renotify: false, icon: ICON,
    dir: n.dir, lang: n.lang, data: n.data
  }).catch(() => {}));
});

self.addEventListener('notificationclick', (event) => {
  if (!/^urgent-\d+$/.test(event.notification.tag || '')) event.notification.close();
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = list.find((c) => c.url.startsWith(SCOPE));
    if (app) {
      await app.focus().catch(() => {});
      app.postMessage({ type: 'urgent-open', hotel_id: event.notification.data?.hotel_id || 0 });
      return;
    }
    await self.clients.openWindow(new URL('./?tab=urgent' + (event.notification.data?.hotel_id ? '&hotel=' + event.notification.data.hotel_id : ''), SCOPE).href);
  })());
});
