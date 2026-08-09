'use strict';

const { SOURCE_STATES } = require('../contracts.cjs');

function updateSourceState(previous = {}, attempt = {}) {
  const status = String(attempt.status || 'FAILED').toUpperCase();
  if (!SOURCE_STATES.has(status)) throw new Error(`INVALID_SOURCE_STATE:${status}`);
  const success = status === 'HEALTHY' || status === 'DEGRADED';
  return {
    sourceId: attempt.sourceId || previous.sourceId,
    status,
    lastCheckedAt: attempt.checkedAt || new Date().toISOString(),
    lastSuccessfulAt: success ? (attempt.checkedAt || new Date().toISOString()) : (previous.lastSuccessfulAt || null),
    lastKnownValid: success && attempt.payload !== undefined ? attempt.payload : (previous.lastKnownValid ?? null),
    currentAttempt: {
      status,
      message: attempt.message || null,
      evidence: attempt.evidence || [],
    },
    consecutiveFailures: success ? 0 : Number(previous.consecutiveFailures || 0) + 1,
  };
}

module.exports = { updateSourceState };
