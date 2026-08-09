'use strict';
const { assertAdapter, sourceAttempt } = require('../../contracts.cjs');
const { fetchWithPolicy } = require('../http-client.cjs');

function createCompanyIrAdapter(source, options = {}) {
  const adapter = {
    sourceId: source.sourceId,
    async discover() { return { sourceId: source.sourceId, companies: source.companyTickers || [], indexes: source.indexUrls || [] }; },
    async fetchIndex(url, state = {}) { return fetchWithPolicy(url, source, state, options); },
    async fetchDocument(url, state = {}) { return fetchWithPolicy(url, source, state, options); },
    parse(payload) { return { status: 'DOCUMENT_LEVEL_PARSER_REQUIRED', payload }; },
    normalize(parsed) { return parsed; },
    validate(parsed) { return { valid: Boolean(parsed), issues: parsed ? [] : ['PARSED_DOCUMENT_REQUIRED'] }; },
    async healthCheck() {
      try {
        const result = await fetchWithPolicy(source.healthUrl || source.baseDomain, source, {}, { ...options, timeoutMs: options.timeoutMs || 12_000 });
        return sourceAttempt({ sourceId: source.sourceId, status: result.status === 'FETCHED' ? 'HEALTHY' : 'DEGRADED', evidence: [source.healthUrl || source.baseDomain] });
      } catch (error) { return sourceAttempt({ sourceId: source.sourceId, status: 'FAILED', message: error.message }); }
    },
  };
  return assertAdapter(adapter);
}

module.exports = { createCompanyIrAdapter };
