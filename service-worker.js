// V16.3-PROFESSIONAL shell with the isolated V16.9 primary basket integration.
// Installed navigation marker: version=16.3.9.2
const BUILD = 'V16.3-PROFESSIONAL-16.3.9.2-V169-BASKET-20260909-P3-FRESHNESS-GUARD';
const REQUIRED_VERSION = '16.3.9.2';
const ROOT_URL = new URL('./', self.location.href);
const LATEST_URL = new URL(`./?launch=installed-icon&latest=1&version=${REQUIRED_VERSION}&mobileReset=1&sw=${encodeURIComponent(BUILD)}`, ROOT_URL).href;
const CANONICAL_DECISION_URL = new URL('./data/stable/v16-main-app-current.json', ROOT_URL);
const PRICE_TRUTH_URL = new URL('./data/stable/v15-price-truth.json', ROOT_URL);

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

function isDecisionRequest(url) {
  return [
    '/data/stable/v15-practical-decision.json',
    '/data/stable/v16-v169-primary-decision.json',
    '/data/stable/v16-main-app-current.json'
  ].some(suffix => url.pathname.endsWith(suffix));
}

function normalizeDate(value) {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function decisionSession(primary) {
  return normalizeDate(
    primary?.dataTruth?.decisionSession ||
    primary?.sessionDate ||
    primary?.recommendations?.[0]?.sessionDate ||
    null
  );
}

function marketSession(primary, priceTruth) {
  return normalizeDate(
    primary?.dataTruth?.marketSession ||
    primary?.expectedLatestSession ||
    priceTruth?.expectedSession ||
    priceTruth?.marketDate ||
    null
  );
}

function jsonResponse(value) {
  return new Response(`${JSON.stringify(value, null, 2)}\n`, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate'
    }
  });
}

async function freshDecisionResponse(search = '') {
  const canonicalUrl = new URL(CANONICAL_DECISION_URL.href);
  const priceTruthUrl = new URL(PRICE_TRUTH_URL.href);
  canonicalUrl.search = search;
  priceTruthUrl.search = search;
  canonicalUrl.searchParams.set('swcb', `${Date.now()}-decision`);
  priceTruthUrl.searchParams.set('swcb', `${Date.now()}-truth`);

  const [canonicalResponse, priceTruthResponse] = await Promise.all([
    fetch(canonicalUrl.href, { cache: 'no-store' }),
    fetch(priceTruthUrl.href, { cache: 'no-store' })
  ]);
  if (!canonicalResponse.ok) throw new Error(`Canonical decision HTTP ${canonicalResponse.status}`);

  const primary = await canonicalResponse.json();
  let priceTruth = null;
  if (priceTruthResponse.ok) {
    try { priceTruth = await priceTruthResponse.json(); } catch (_) {}
  }

  const canonicalSession = decisionSession(primary);
  const latestMarketSession = marketSession(primary, priceTruth);
  if (canonicalSession && latestMarketSession && canonicalSession !== latestMarketSession) {
    return jsonResponse({
      ...primary,
      recommendations: [],
      executionAllowed: false,
      recommendationsReady: false,
      systemState: 'STALE_RECOMMENDATIONS_BLOCKED',
      state: 'STALE_RECOMMENDATIONS_BLOCKED',
      staleRecommendationsBlocked: true,
      staleReason: `canonical=${canonicalSession}; market=${latestMarketSession}`,
      statusAr: 'تم إيقاف عرض التوصيات لأن جلسة التوصيات لا تطابق أحدث جلسة سوق. انتظر اكتمال التحديث التلقائي.'
    });
  }
  return jsonResponse(primary);
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

  // Every decision path, including legacy and installed-app requests, is routed
  // through the canonical snapshot and blocked if it is older than market truth.
  if (isDecisionRequest(url)) {
    event.respondWith((async () => {
      try {
        return await freshDecisionResponse(url.search);
      } catch (_) {
        return new Response(JSON.stringify({
          recommendations: [],
          executionAllowed: false,
          recommendationsReady: false,
          systemState: 'DECISION_FRESHNESS_UNAVAILABLE',
          state: 'DECISION_FRESHNESS_UNAVAILABLE',
          staleRecommendationsBlocked: true,
          statusAr: 'تعذر التحقق من حداثة التوصيات؛ تم إيقاف عرضها احترازيًا.'
        }, null, 2) + '\n', {
          status: 503,
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate'
          }
        });
      }
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
        return new Response('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body style="background:#061426;color:#fff;font-family:Arial;padding:30px"><h2>غير متصل</h2><p>لا يتم عرض نسخة قديمة دون اتصال. اتصل بالإنترنت ثم أعد فتح EGX Pro V16.3.9.2.</p></body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
      }
      throw error;
    }
  })());
});
