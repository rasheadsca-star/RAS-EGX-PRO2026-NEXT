'use strict';
(() => {
  const VERSION = '16.3.3';
  const ASSET_BUILD = '16.3.3-session-truth-20260814-r3';
  const SW_BUILD = 'V16.3.3-V169-SESSION-TRUTH-20260814-R3';
  const head = document.head || document.documentElement;

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
      script.src = `${src}?v=${ASSET_BUILD}`;
      script.defer = true;
      script.dataset[datasetKey] = 'true';
      script.onload = resolve;
      script.onerror = resolve;
      (document.body || document.documentElement).appendChild(script);
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
    await loadScript('v16-3.js', 'v163');
    await loadScript('recommendation-freshness.js', 'recommendationFreshness');
    await loadScript('v16-9-basket-overlay.js', 'v169BasketOverlay');
    await loadScript('session-truth-ui.js', 'sessionTruthUi');
    openRequestedView();
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
