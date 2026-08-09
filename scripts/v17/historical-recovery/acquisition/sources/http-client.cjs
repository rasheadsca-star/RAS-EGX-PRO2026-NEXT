'use strict';

function allowedUrl(url, source) {
  try {
    const parsed = new URL(url);
    const base = new URL(source.baseDomain);
    return parsed.protocol === 'https:' && (parsed.hostname === base.hostname || parsed.hostname.endsWith(`.${base.hostname}`));
  } catch { return false; }
}

async function fetchWithPolicy(url, source, state = {}, options = {}) {
  if (!allowedUrl(url, source)) throw new Error(`SOURCE_DOMAIN_NOT_ALLOWED:${url}`);
  const headers = { 'User-Agent': options.userAgent || 'RAS-EGX-V17-Research/1.0 (evidence acquisition; contact repository owner)' };
  if (state.etag) headers['If-None-Match'] = state.etag;
  if (state.lastModified) headers['If-Modified-Since'] = state.lastModified;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 20_000);
  try {
    const response = await (options.fetchImpl || fetch)(url, { headers, signal: controller.signal, redirect: 'follow' });
    if (response.status === 304) return { status: 'NOT_MODIFIED', body: null, etag: state.etag || null, lastModified: state.lastModified || null };
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    return { status: 'FETCHED', body: bytes, contentType: response.headers.get('content-type'), etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), fetchedAt: new Date().toISOString() };
  } finally { clearTimeout(timeout); }
}

module.exports = { allowedUrl, fetchWithPolicy };
