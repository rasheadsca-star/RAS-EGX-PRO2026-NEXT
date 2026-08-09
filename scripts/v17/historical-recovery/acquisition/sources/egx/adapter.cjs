'use strict';
const { assertAdapter, sourceAttempt } = require('../../contracts.cjs');
const { fetchWithPolicy } = require('../http-client.cjs');

function createEgxAdapter(source, options = {}) {
  return assertAdapter({
    sourceId: source.sourceId,
    async discover() { return { sourceId: source.sourceId, accessMethod: source.accessMethod, structuredEndpointVerified: false, reason: 'NO_STABLE_PUBLIC_STRUCTURED_ENDPOINT_VERIFIED' }; },
    async fetchIndex(url = source.baseDomain, state = {}) { return fetchWithPolicy(url, source, state, options); },
    async fetchDocument(url, state = {}) { return fetchWithPolicy(url, source, state, options); },
    parse(payload) { return { status: 'MANUAL_DOCUMENT_REVIEW_REQUIRED', payload }; },
    normalize(parsed) { return parsed; },
    validate(parsed) { return { valid: Boolean(parsed), issues: parsed ? [] : ['EGX_DOCUMENT_REQUIRED'] }; },
    async healthCheck() {
      try { await fetchWithPolicy(source.baseDomain, source, {}, { ...options, timeoutMs: 12_000 }); return sourceAttempt({ sourceId: source.sourceId, status: 'DEGRADED', message: 'Official site reachable; no stable structured market-wide endpoint verified.' }); }
      catch (error) { return sourceAttempt({ sourceId: source.sourceId, status: 'FAILED', message: error.message }); }
    },
  });
}

module.exports = { createEgxAdapter };
