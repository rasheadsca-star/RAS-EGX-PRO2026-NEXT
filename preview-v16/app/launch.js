'use strict';
(() => {
  const VERSION = '16.3.0';
  const head = document.head || document.documentElement;
  if (!document.querySelector('link[data-v163]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `v16-3.css?v=${VERSION}`;
    link.dataset.v163 = 'true';
    head.appendChild(link);
  }
  const loadUpgrade = () => new Promise(resolve => {
    if (document.querySelector('script[data-v163]')) { resolve(); return; }
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
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => loadUpgrade().then(openRequestedView), { once: true });
  } else {
    loadUpgrade().then(openRequestedView);
  }
})();
