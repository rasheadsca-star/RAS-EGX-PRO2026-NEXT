'use strict';

const REQUIRED_ADAPTER_METHODS = Object.freeze([
  'discover',
  'fetchIndex',
  'fetchDocument',
  'parse',
  'normalize',
  'validate',
  'healthCheck',
]);

const SOURCE_STATES = new Set(['HEALTHY', 'DEGRADED', 'STALE', 'FAILED']);

function validateAdapter(adapter) {
  const issues = [];
  if (!adapter || typeof adapter !== 'object') return { valid: false, issues: ['ADAPTER_REQUIRED'] };
  if (!adapter.sourceId) issues.push('SOURCE_ID_REQUIRED');
  for (const method of REQUIRED_ADAPTER_METHODS) {
    if (typeof adapter[method] !== 'function') issues.push(`METHOD_REQUIRED:${method}`);
  }
  return { valid: issues.length === 0, issues };
}

function assertAdapter(adapter) {
  const result = validateAdapter(adapter);
  if (!result.valid) throw new Error(`INVALID_SOURCE_ADAPTER:${result.issues.join(',')}`);
  return adapter;
}

function sourceAttempt({ sourceId, status, checkedAt = new Date(), message = null, evidence = [] }) {
  const normalizedStatus = String(status || '').toUpperCase();
  if (!SOURCE_STATES.has(normalizedStatus)) throw new Error(`INVALID_SOURCE_STATE:${status}`);
  return {
    sourceId,
    status: normalizedStatus,
    checkedAt: new Date(checkedAt).toISOString(),
    message,
    evidence: Array.isArray(evidence) ? evidence : [],
  };
}

module.exports = { REQUIRED_ADAPTER_METHODS, SOURCE_STATES, validateAdapter, assertAdapter, sourceAttempt };
