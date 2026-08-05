(() => {
  'use strict';

  const nativeFetch = window.fetch.bind(window);
  const legacySuffix = '/data/stable/v15-practical-decision.json';
  const primaryUrl = new URL('../../data/stable/v16-v169-primary-decision.json', window.location.href);

  window.__EGX_PRIMARY_DECISION__ = primaryUrl.href;

  window.fetch = function routedFetch(input, init) {
    let requestedUrl;
    try {
      requestedUrl = new URL(typeof input === 'string' ? input : input.url, window.location.href);
    } catch (_) {
      return nativeFetch(input, init);
    }

    if (!requestedUrl.pathname.endsWith(legacySuffix)) {
      return nativeFetch(input, init);
    }

    const routedUrl = new URL(primaryUrl.href);
    routedUrl.search = requestedUrl.search;

    return nativeFetch(routedUrl.href, { ...(init || {}), cache: 'no-store' })
      .then(response => response.ok ? response : nativeFetch(input, init))
      .catch(() => nativeFetch(input, init));
  };
})();
