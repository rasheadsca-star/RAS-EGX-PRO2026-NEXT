// V16.9.1 ISOLATED PRIMARY DECISION AND INSTALLED ICON MIGRATION
const BUILD = 'V16.9.1-PRIMARY-DECISION-20260805';
const REQUIRED_VERSION = '16.9.1';
const ROOT_URL = new URL('./', self.location.href);
const LATEST_URL = new URL(`./?launch=installed-icon&latest=1&version=${REQUIRED_VERSION}&mobileReset=1&sw=${encodeURIComponent(BUILD)}`, ROOT_URL).href;
const PRIMARY_DECISION_URL = new URL('./data/stable/v16-v169-primary-decision.json', ROOT_URL);

function appState(value) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    const path = url.pathname.replace(/\/+$/, '');
    const legacy = [
      '/preview-v13/app/unified-decision-center.html',
      '/preview-v13/app/index.html',
      '/preview-v14/app/index.html',
      '/preview-v15/app/index.html'
    ].some(suffix => path.endsWith(suffix));
    const v16Direct = path.endsWith('/preview-v16/app/index.html');
    const staleV16 = v16Direct && url.searchParams.get('version') !== REQUIRED_VERSION && !url.searchParams.has('allowLegacy');
    return { url, legacy, staleV16 };
  } catch (_) {
    return { url: null, legacy: false, staleV16: false };
  }
}

function shouldMigrate(value) {
  const state = appState(value);
  return state.legacy || state.staleV16;
}

function isDirectLaunch(request, url) {
  if (url.searchParams.has('allowLegacy')) return false;
  if (['pwa', 'desktop-icon', 'installed-icon', 'legacy-icon'].some(value => Array.from(url.searchParams.values()).includes(value))) return true;
  if (!request.referrer) return true;
  try { return new URL(request.referrer).origin !== url.origin; } catch (_) { return true; }
}

function isSharedLegacyDecision(url) {
  return url.pathname.endsWith('/data/stable/v15-practical-decision.json');
}

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.clients.claim();
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    await Promise.all(windows.map(async client => {
      if (!shouldMigrate(client.url)) return;
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
    const target = new URL(`./?launch=notification&latest=1&version=${REQUIRED_VERSION}`, ROOT_URL).href;
    if (windows[0]) { await windows[0].focus(); await windows[0].navigate(target); }
    else await self.clients.openWindow(target);
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Older UI bundles still request the shared V15 decision path. Always serve
  // the isolated V16.9 primary file instead, so legacy scanners cannot alter
  // the recommendations displayed to users.
  if (isSharedLegacyDecision(url)) {
    event.respondWith((async () => {
      const primaryUrl = new URL(PRIMARY_DECISION_URL.href);
      primaryUrl.search = url.search;
      try {
        const primary = await fetch(primaryUrl.href, { cache: 'no-store' });
        if (primary.ok) return primary;
      } catch (_) {}
      return fetch(request, { cache: 'no-store' });
    })());
    return;
  }

  if (request.mode === 'navigate' && shouldMigrate(url) && isDirectLaunch(request, url)) {
    event.respondWith(Response.redirect(LATEST_URL, 302));
    return;
  }

  event.respondWith((async () => {
    try {
      const response = await fetch(request, { cache: 'no-store' });
      return response;
    } catch (error) {
      if (request.mode === 'navigate') {
        return new Response('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body style="background:#061426;color:#fff;font-family:Arial;padding:30px"><h2>غير متصل</h2><p>لا يتم عرض نسخة قديمة دون اتصال. اتصل بالإنترنت ثم أعد فتح EGX Pro V16.9.1.</p></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
      throw error;
    }
  })());
});
