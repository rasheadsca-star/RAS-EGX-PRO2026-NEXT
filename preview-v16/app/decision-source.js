(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const legacyDecisionSuffix = '/data/stable/v15-practical-decision.json';
  const legacyUpdateSuffix = '/data/stable/v15-update-status.json';
  const primaryUrl = new URL('../../data/stable/v16-v169-primary-decision.json', window.location.href);

  window.__EGX_PRIMARY_DECISION__ = primaryUrl.href;

  const requestUrl = input => {
    try {
      return new URL(typeof input === 'string' ? input : input.url, window.location.href);
    } catch (_) {
      return null;
    }
  };

  const noStore = init => ({ ...(init || {}), cache: 'no-store' });

  async function fetchPrimary(search = '') {
    const routedUrl = new URL(primaryUrl.href);
    routedUrl.search = search;
    const response = await nativeFetch(routedUrl.href, noStore());
    if (!response.ok) throw new Error(`Primary decision HTTP ${response.status}`);
    return response;
  }

  async function mergedUpdateStatus(input, init, requestedUrl) {
    const [legacyResponse, primaryResponse] = await Promise.all([
      nativeFetch(input, noStore(init)),
      fetchPrimary(requestedUrl.search),
    ]);

    if (!legacyResponse.ok) return legacyResponse;

    const [legacy, primary] = await Promise.all([
      legacyResponse.json(),
      primaryResponse.json(),
    ]);

    const recommendations = Array.isArray(primary.recommendations) ? primary.recommendations : [];
    const sessionDate = primary.sessionDate || legacy.recommendationSessionDate || legacy.sessionDate || null;
    const generatedAt = primary.generatedAt || legacy.generatedAt || null;

    const merged = {
      ...legacy,
      schemaVersion: '16.9.2-protected-status',
      generatedAt,
      lastAutomaticScanAt: generatedAt,
      productInterface: 'EGX_PROFESSIONAL_V16_9_2',
      sessionDate,
      expectedLatestSession: sessionDate,
      recommendationSessionDate: sessionDate,
      recommendationGeneratedAt: generatedAt,
      recommendationsReady: primary.practicalReady === true && recommendations.length > 0,
      recommendationCount: recommendations.length,
      recommendationTickers: recommendations.map(row => row.ticker),
      productionEngine: primary.selectedModel?.id || 'V16_9_EQUAL_WEIGHT_BASKET',
      primaryTickers: recommendations.map(row => row.ticker),
      protectedDecisionPath: 'data/stable/v16-v169-primary-decision.json',
    };

    return new Response(`${JSON.stringify(merged, null, 2)}\n`, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    });
  }

  window.fetch = function routedFetch(input, init) {
    const requestedUrl = requestUrl(input);
    if (!requestedUrl) return nativeFetch(input, init);

    if (requestedUrl.pathname.endsWith(legacyDecisionSuffix)) {
      return fetchPrimary(requestedUrl.search)
        .catch(() => nativeFetch(input, init));
    }

    if (requestedUrl.pathname.endsWith(legacyUpdateSuffix)) {
      return mergedUpdateStatus(input, init, requestedUrl)
        .catch(() => nativeFetch(input, init));
    }

    return nativeFetch(input, init);
  };
})();
