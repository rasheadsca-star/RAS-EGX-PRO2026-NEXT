'use strict';
(() => {
  const VERSION = '16.3.1';
  const SW_BUILD = 'V16.3.1-MOBILE-HOTFIX-20260803';
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
    link.href = `v16-3.css?v=${VERSION}`;
    link.dataset.v163 = 'true';
    head.appendChild(link);
  }

  const loadUpgrade = () => new Promise(resolve => {
    const existing = document.querySelector('script[data-v163]');
    if (existing) {
      if (document.documentElement.dataset.v163Ready === 'true') resolve();
      else existing.addEventListener('load', resolve, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = `v16-3.js?v=${VERSION}`;
    script.defer = true;
    script.dataset.v163 = 'true';
    script.onload = resolve;
    script.onerror = resolve;
    (document.body || document.documentElement).appendChild(script);
  });

  const openRequestedView = () => {
    const params = new URLSearchParams(location.search);
    const requested = params.get('view');
    const target = requested === 'evaluation' ? 'evidence' : requested;
    if (!target) return;
    window.setTimeout(() => document.querySelector(`[data-view="${target}"]`)?.click(), 300);
  };

  const start = async () => {
    await refreshServiceWorker();
    await loadUpgrade();
    openRequestedView();
  };

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
