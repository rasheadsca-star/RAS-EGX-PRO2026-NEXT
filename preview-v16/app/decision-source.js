(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const legacyDecisionSuffix = '/data/stable/v15-practical-decision.json';
  const rawPrimaryDecisionSuffix = '/data/stable/v16-v169-primary-decision.json';
  const legacyUpdateSuffix = '/data/stable/v15-update-status.json';
  const primaryUrl = new URL('../../data/stable/v16-main-app-current.json', window.location.href);
  const priceTruthUrl = new URL('../../data/stable/v15-price-truth.json', window.location.href);

  window.__EGX_PRIMARY_DECISION__ = primaryUrl.href;
  window.__EGX_MAIN_APP_CANONICAL_SNAPSHOT__ = primaryUrl.href;

  const requestUrl = input => {
    try {
      return new URL(typeof input === 'string' ? input : input.url, window.location.href);
    } catch (_) {
      return null;
    }
  };

  const noStore = init => ({
    ...(init || {}),
    cache: 'no-store',
    headers: { ...((init || {}).headers || {}), 'Cache-Control': 'no-cache' },
  });

  async function fetchPrimary(search = '') {
    const routedUrl = new URL(primaryUrl.href);
    routedUrl.search = search;
    const response = await nativeFetch(routedUrl.href, noStore());
    if (!response.ok) throw new Error(`Canonical MAIN APP snapshot HTTP ${response.status}`);
    return response;
  }

  async function readPriceTruth(search = '') {
    try {
      const routedUrl = new URL(priceTruthUrl.href);
      routedUrl.search = search;
      const response = await nativeFetch(routedUrl.href, noStore());
      if (!response.ok) return null;
      return await response.json();
    } catch (_) {
      return null;
    }
  }

  async function mergedUpdateStatus(input, init, requestedUrl) {
    const [legacyResponse, primaryResponse, priceTruth] = await Promise.all([
      nativeFetch(input, noStore(init)),
      fetchPrimary(requestedUrl.search),
      readPriceTruth(requestedUrl.search),
    ]);

    if (!legacyResponse.ok) return legacyResponse;

    const [legacy, primary] = await Promise.all([
      legacyResponse.json(),
      primaryResponse.json(),
    ]);

    const recommendations = Array.isArray(primary.recommendations) ? primary.recommendations : [];
    const truth = primary.dataTruth || {};
    const actualScanAt = truth.marketScanAt || legacy.lastAutomaticScanAt || legacy.generatedAt || null;
    const statusGeneratedAt = primary.snapshotGeneratedAt || legacy.generatedAt || actualScanAt || null;
    const marketSessionDate = truth.marketSession || priceTruth?.expectedSession || primary.expectedLatestSession || primary.sessionDate || null;
    const recommendationSessionDate = truth.decisionSession || primary.sessionDate || marketSessionDate || null;
    const recommendationGeneratedAt = truth.decisionBuiltAt || primary.generatedAt || null;
    const recommendationSessionAligned = primary?.governance?.sessionAligned === true;
    const currentExecutionGrade = truth.executionGrade === true || priceTruth?.executionGrade === true;
    const executionEligible = primary.executionAllowed === true;

    const merged = {
      ...legacy,
      schemaVersion: '16.9.2-canonical-governance-status',
      generatedAt: statusGeneratedAt,
      lastAutomaticScanAt: actualScanAt,
      productInterface: 'EGX_PROFESSIONAL_MAIN_APP_V16_9_2',
      systemState: primary.systemState || primary.state || 'BLOCKED',
      sessionDate: marketSessionDate,
      expectedLatestSession: marketSessionDate,
      marketSessionDate,
      recommendationSessionDate,
      recommendationGeneratedAt,
      recommendationSessionAligned,
      executionGrade: currentExecutionGrade,
      executionEligible,
      recommendationsReady: executionEligible,
      recommendationCount: recommendations.length,
      recommendationTickers: recommendations.map(row => row.ticker),
      productionEngine: primary?.governance?.activeEngine || primary.selectedModel?.id || 'V16_9_EQUAL_WEIGHT_BASKET',
      primaryTickers: recommendations.map(row => row.ticker),
      protectedDecisionPath: 'data/stable/v16-main-app-current.json',
      canonicalSnapshotHash: primary.snapshotHash || null,
      sessionTruth: {
        scannerRunAt: actualScanAt,
        statusGeneratedAt,
        latestCompletedMarketSession: marketSessionDate,
        recommendationSignalSession: recommendationSessionDate,
        recommendationBuiltAt: recommendationGeneratedAt,
        priceTruthGeneratedAt: truth.priceTruthAt || priceTruth?.generatedAt || null,
        aligned: recommendationSessionAligned,
        executionGrade: currentExecutionGrade,
        executionEligible,
        sourceSessionEvidenceCoveragePct: truth.sourceSessionEvidenceCoveragePct ?? null,
        state: primary.systemState || primary.state || 'BLOCKED',
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

    if (requestedUrl.pathname.endsWith(legacyDecisionSuffix) || requestedUrl.pathname.endsWith(rawPrimaryDecisionSuffix)) {
      return fetchPrimary(requestedUrl.search)
        .catch(() => nativeFetch(input, init));
    }

    if (requestedUrl.pathname.endsWith(legacyUpdateSuffix)) {
      return mergedUpdateStatus(input, init, requestedUrl)
        .catch(() => nativeFetch(input, init));
    }

    return nativeFetch(input, init);
  };

  function loadPreCloseRuntime() {
    if (window.__V169_PRE_CLOSE_RUNTIME_LOADER__) return;
    window.__V169_PRE_CLOSE_RUNTIME_LOADER__ = true;
    const script = document.createElement('script');
    script.src = `v16-9-preclose-runtime.js?v=16.9.2-preclose-20260818-r1`;
    script.defer = true;
    script.dataset.v169PreCloseRuntime = 'true';
    script.onerror = () => console.warn('V16.9 pre-close runtime could not be loaded.');
    (document.body || document.head || document.documentElement).appendChild(script);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadPreCloseRuntime, { once: true });
  } else {
    loadPreCloseRuntime();
  }
})();
