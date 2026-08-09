'use strict';
const { assertAdapter, sourceAttempt } = require('../../contracts.cjs');
const { fetchWithPolicy } = require('../http-client.cjs');

function createFraAdapter(source, options = {}) {
  return assertAdapter({
    sourceId: source.sourceId,
    async discover() { return { sourceId: source.sourceId, contentTypes: source.contentTypes, automationScope: 'REGULATORY_NOTICES_AND_DECISIONS' }; },
    async fetchIndex(url = source.baseDomain, state = {}) { return fetchWithPolicy(url, source, state, options); },
    async fetchDocument(url, state = {}) { return fetchWithPolicy(url, source, state, options); },
    parse(payload) { return { status: 'REGULATORY_DOCUMENT_REVIEW_REQUIRED', payload }; },
    normalize(parsed) { return parsed; },
    validate(parsed) { return { valid: Boolean(parsed), issues: parsed ? [] : ['FRA_DOCUMENT_REQUIRED'] }; },
    async healthCheck() {
      try { await fetchWithPolicy(source.baseDomain, source, {}, { ...options, timeoutMs: 12_000 }); return sourceAttempt({ sourceId: source.sourceId, status: 'HEALTHY', message: 'Official regulatory pages reachable; not a company-financial database.' }); }
      catch (error) { return sourceAttempt({ sourceId: source.sourceId, status: 'FAILED', message: error.message }); }
    },
  });
}

module.exports = { createFraAdapter };
