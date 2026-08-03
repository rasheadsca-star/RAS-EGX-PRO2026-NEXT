// V16.3 PROFESSIONAL ICON MIGRATION
const BUILD = 'V16.3-PROFESSIONAL-20260803';
const ROOT_URL = new URL('./', self.location.href);
const LATEST_URL = new URL(`./?launch=installed-icon&latest=1&version=16.3&sw=${encodeURIComponent(BUILD)}`, ROOT_URL).href;

function isLegacyAppUrl(value) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    const path = url.pathname.replace(/\/+$/, '');
    return [
      '/preview-v13/app/unified-decision-center.html',
      '/preview-v13/app/index.html',
      '/preview-v14/app/index.html',
      '/preview-v15/app/index.html'
    ].some(suffix => path.endsWith(suffix));
  } catch (_) { return false; }
}
function isDirectLaunch(request, url) {
  if (url.searchParams.has('allowLegacy')) return false;
  if (['pwa', 'desktop-icon', 'installed-icon', 'legacy-icon'].some(value => Array.from(url.searchParams.values()).includes(value))) return true;
  if (!request.referrer) return true;
  try { return new URL(request.referrer).origin !== url.origin; } catch (_) { return true; }
}
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.clients.claim();
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(windows.map(async client => {
      if (!isLegacyAppUrl(client.url)) return;
      try { await client.navigate(LATEST_URL); } catch (_) {}
    }));
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'OPEN_LATEST') {
    event.waitUntil((async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (windows[0]) await windows[0].navigate(LATEST_URL);
      else await self.clients.openWindow(LATEST_URL);
    })());
  }
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const target = new URL('./?launch=notification&latest=1&version=16.3', ROOT_URL).href;
    if (windows[0]) { await windows[0].focus(); await windows[0].navigate(target); }
    else await self.clients.openWindow(target);
  })());
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && isLegacyAppUrl(url) && isDirectLaunch(request, url)) {
    event.respondWith(Response.redirect(LATEST_URL, 302));
    return;
  }
  event.respondWith((async () => {
    try { return await fetch(request, { cache: 'no-store' }); }
    catch (error) {
      if (request.mode === 'navigate') {
        return new Response('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body style="background:#061426;color:#fff;font-family:Arial;padding:30px"><h2>غير متصل</h2><p>لا يتم عرض نسخة قديمة دون اتصال. اتصل بالإنترنت ثم أعد فتح EGX Pro V16.3.</p></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
      throw error;
    }
  })());
});
