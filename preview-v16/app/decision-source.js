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

    // Keep four different truths separate:
    // 1) wall-clock scanner run time, 2) latest completed market session,
    // 3) recommendation signal session, 4) recommendation build time.
    // A post-close build can cross midnight in Cairo without creating a new EGX session.
    const actualScanAt = legacy.lastAutomaticScanAt || legacy.generatedAt || null;
    const statusGeneratedAt = legacy.generatedAt || actualScanAt || null;
    const marketSessionDate = legacy.expectedLatestSession || legacy.sessionDate || primary.sessionDate || null;
    const recommendationSessionDate = primary.sessionDate || legacy.recommendationSessionDate || marketSessionDate || null;
    const recommendationGeneratedAt = primary.generatedAt || legacy.recommendationGeneratedAt || null;
    const recommendationSessionAligned = Boolean(
      marketSessionDate &&
      recommendationSessionDate &&
      marketSessionDate === recommendationSessionDate
    );

    const merged = {
      ...legacy,
      schemaVersion: '16.9.2-session-truth-status',
      generatedAt: statusGeneratedAt,
      lastAutomaticScanAt: actualScanAt,
      productInterface: 'EGX_PROFESSIONAL_V16_9_2',
      sessionDate: marketSessionDate,
      expectedLatestSession: marketSessionDate,
      marketSessionDate,
      recommendationSessionDate,
      recommendationGeneratedAt,
      recommendationSessionAligned,
      recommendationsReady:
        recommendationSessionAligned &&
        primary.practicalReady === true &&
        recommendations.length > 0,
      recommendationCount: recommendations.length,
      recommendationTickers: recommendations.map(row => row.ticker),
      productionEngine: primary.selectedModel?.id || 'V16_9_EQUAL_WEIGHT_BASKET',
      primaryTickers: recommendations.map(row => row.ticker),
      protectedDecisionPath: 'data/stable/v16-v169-primary-decision.json',
      sessionTruth: {
        scannerRunAt: actualScanAt,
        statusGeneratedAt,
        latestCompletedMarketSession: marketSessionDate,
        recommendationSignalSession: recommendationSessionDate,
        recommendationBuiltAt: recommendationGeneratedAt,
        aligned: recommendationSessionAligned,
      },
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
