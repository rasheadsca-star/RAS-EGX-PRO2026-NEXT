import test from 'node:test';
import assert from 'node:assert/strict';
import { FROZEN_RUNTIME_CONTRACT } from '../stability/frozen-runtime-contract.js';

test('complete RC2 history contract is reporting-only and fail-closed', () => {
  const r = FROZEN_RUNTIME_CONTRACT.recommendationHistoryRules;
  assert.equal(r.moduleId, 'RC2_COMPLETE_RECOMMENDATION_HISTORY_V1');
  assert.equal(r.publishedArchiveSource, 'main:data/rc2/recommendation-history.json');
  assert.equal(r.publishedEvaluation, 'ORIGINAL_PLAN_FORWARD_EVALUATION');
  assert.equal(r.replayClassification, 'HISTORICAL_REPLAY_NOT_LIVE_PUBLISHED');
  assert.equal(r.entryTiming, 'NEXT_SESSION_OR_LATER_ONLY');
  assert.equal(r.entryExpirySessions, 3);
  assert.equal(r.maxHoldSessions, 10);
  assert.equal(r.sameBarAmbiguity, 'STOP_FIRST');
  assert.equal(r.cacheMs, 300000);
  assert.equal(r.uiRefreshMs, 300000);
  assert.equal(r.scoringImpact, 'NONE');
  assert.equal(r.recommendationMutationAllowed, false);
  assert.equal(r.executionAllowed, false);
  assert.equal(r.automaticOrders, false);
  assert.equal(r.productionScanCalled, false);
});
