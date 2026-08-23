'use strict';
(() => {
  const VERSION = '16.3.3';
  const ASSET_BUILD = '16.3.3-portfolio-deep-20260823-r2';
  const SW_BUILD = 'V16.3.3-PORTFOLIO-DEEP-20260823-R2';
  const head = document.head || document.documentElement;
  const MAIN_PORTFOLIO_KEY = 'egx-v16-professional-portfolio';
  const ANALYZER_PORTFOLIO_KEY = 'egx-main-app-stock-analyzer-portfolio-v1';
  const DEEP_PORTFOLIO_KEY = 'egx-v137-portfolio';
  let bridgeRevision = 0;

  document.documentElement.dataset.egxVersion = VERSION;
  document.title = document.title.replace(/V16(?:\.\d+)?/g, `V${VERSION}`);
  document.querySelectorAll('meta[name="description"]').forEach(meta => {
    meta.content = meta.content.replace(/V16(?:\.\d+)?/g, `V${VERSION}`);
  });

  async function refreshServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      const registration = await navigator.serviceWorker.register(`../../service-worker.js?v=${encodeURIComponent(SW_BUILD)}`, {
        scope: '../../',
        updateViaCache: 'none'
      });
      await registration.update();
      const worker = registration.waiting || registration.installing;
      if (worker) worker.postMessage({ type: 'SKIP_WAITING' });
    } catch (_) {}
  }

  if (!document.querySelector('link[data-v163]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `v16-3.css?v=${ASSET_BUILD}`;
    link.dataset.v163 = 'true';
    head.appendChild(link);
  }

  function loadScript(src, datasetKey) {
    return new Promise(resolve => {
      const existing = document.querySelector(`script[data-${datasetKey}]`);
      if (existing) {
        existing.addEventListener('load', resolve, { once: true });
        setTimeout(resolve, 0);
        return;
      }
      const script = document.createElement('script');
      script.src = `${src}${src.includes('?') ? '&' : '?'}v=${ASSET_BUILD}`;
      script.defer = true;
      script.dataset[datasetKey] = 'true';
      script.onload = resolve;
      script.onerror = resolve;
      (document.body || document.documentElement).appendChild(script);
    });
  }

  function parseStorage(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch (_) {
      return fallback;
    }
  }

  function deepPortfolioRows() {
    const merged = new Map();
    const mainRows = parseStorage(MAIN_PORTFOLIO_KEY, []);
    if (Array.isArray(mainRows)) {
      mainRows.forEach(row => {
        const ticker = String(row?.ticker || '').trim().toUpperCase();
        const quantity = Number(row?.quantity);
        const averagePrice = Number(row?.entry);
        if (ticker && Number.isFinite(quantity) && quantity > 0 && Number.isFinite(averagePrice) && averagePrice > 0) {
          merged.set(ticker, { ticker, quantity, averagePrice, source: 'V16_PORTFOLIO' });
        }
      });
    }

    const analyzer = parseStorage(ANALYZER_PORTFOLIO_KEY, {});
    if (analyzer && typeof analyzer === 'object' && !Array.isArray(analyzer)) {
      Object.entries(analyzer).forEach(([rawTicker, position]) => {
        if (!position?.owned) return;
        const ticker = String(rawTicker || '').trim().toUpperCase();
        const quantity = Number(position?.qty);
        const averagePrice = Number(position?.avgCost);
        if (!ticker || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(averagePrice) || averagePrice <= 0) return;
        if (!merged.has(ticker)) merged.set(ticker, { ticker, quantity, averagePrice, source: 'STOCK_ANALYZER' });
      });
    }
    return [...merged.values()];
  }

  function ensurePortfolioBridgeMarker() {
    let marker = document.getElementById('rows');
    if (marker) return marker;
    const view = document.getElementById('view-portfolio');
    if (!view) return null;
    const tablePanel = [...view.querySelectorAll('.panel')].find(panel => panel.querySelector('#portfolioRows')) || view;
    marker = document.createElement('span');
    marker.id = 'rows';
    marker.hidden = true;
    marker.setAttribute('aria-hidden', 'true');
    tablePanel.appendChild(marker);
    return marker;
  }

  function syncPortfolioBridge() {
    const mapped = deepPortfolioRows().map(({ ticker, quantity, averagePrice }) => ({ ticker, quantity, averagePrice }));
    localStorage.setItem(DEEP_PORTFOLIO_KEY, JSON.stringify(mapped));
    const marker = ensurePortfolioBridgeMarker();
    if (marker) {
      bridgeRevision += 1;
      marker.textContent = `${bridgeRevision}|${mapped.map(x => `${x.ticker}:${x.quantity}:${x.averagePrice}`).join('|')}`;
    }
  }

  function installPortfolioBridge() {
    syncPortfolioBridge();
    const portfolioRows = document.getElementById('portfolioRows');
    if (portfolioRows && !portfolioRows.dataset.deepPortfolioBridge) {
      portfolioRows.dataset.deepPortfolioBridge = 'true';
      new MutationObserver(() => syncPortfolioBridge()).observe(portfolioRows, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
    document.querySelector('[data-view="portfolio"]')?.addEventListener('click', () => setTimeout(syncPortfolioBridge, 80));
    window.addEventListener('storage', event => {
      if ([MAIN_PORTFOLIO_KEY, ANALYZER_PORTFOLIO_KEY].includes(event.key)) syncPortfolioBridge();
    });
    document.addEventListener('click', event => {
      if (event.target.closest('#saSavePosition,#saOwnedYes,#saOwnedNo,#addPortfolioBtn,#clearPortfolioBtn,[data-r]')) {
        setTimeout(syncPortfolioBridge, 120);
      }
    });
  }

  const openRequestedView = () => {
    const params = new URLSearchParams(location.search);
    const requested = params.get('view');
    const target = requested === 'evaluation' ? 'evidence' : requested;
    if (!target) return;
    window.setTimeout(() => document.querySelector(`[data-view="${target}"]`)?.click(), 300);
  };

  const start = async () => {
    await refreshServiceWorker();
    installPortfolioBridge();
    await loadScript('v16-3.js', 'v163');
    await loadScript('recommendation-freshness.js', 'recommendationFreshness');
    await loadScript('v16-9-basket-overlay.js', 'v169BasketOverlay');
    await loadScript('session-truth-ui.js', 'sessionTruthUi');
    await loadScript('../../preview-v13/app/portfolio-technical-scenarios.js', 'v16PortfolioTechnicalScenarios');
    await loadScript('../../preview-v13/app/portfolio-historical-calibration.js', 'v16PortfolioHistoricalCalibration');
    syncPortfolioBridge();
    openRequestedView();
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
