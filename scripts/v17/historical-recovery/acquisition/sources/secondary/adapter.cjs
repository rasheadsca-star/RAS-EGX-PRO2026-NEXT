'use strict';
const { assertAdapter, sourceAttempt } = require('../../contracts.cjs');
const { fetchWithPolicy } = require('../http-client.cjs');

function createSecondaryAdapter(source, options = {}) {
  return assertAdapter({
    sourceId: source.sourceId,
    async discover() { return { sourceId: source.sourceId, use: 'CROSS_CHECK_AND_OFFICIAL_DOCUMENT_DISCOVERY_ONLY' }; },
    async fetchIndex(url, state = {}) { return fetchWithPolicy(url, source, state, options); },
    async fetchDocument(url, state = {}) { return fetchWithPolicy(url, source, state, options); },
    parse(payload) { return { status: 'SECONDARY_EVIDENCE_ONLY', payload }; },
    normalize(parsed) { return parsed; },
    validate(parsed) { return { valid: Boolean(parsed), issues: parsed ? [] : ['SECONDARY_EVIDENCE_REQUIRED'] }; },
    async healthCheck() { return sourceAttempt({ sourceId: source.sourceId, status: 'DEGRADED', message: 'Secondary source may cross-check but cannot become authoritative corporate-financial evidence.' }); },
  });
}

module.exports = { createSecondaryAdapter };
