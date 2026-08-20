import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { POLICY } from '../src/policy.js';
import { FROZEN_RUNTIME_CONTRACT } from '../stability/frozen-runtime-contract.js';

function localFile(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url));
}

function gitBlobSha(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`);
  return createHash('sha1').update(header).update(buffer).digest('hex');
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('frozen RC2 critical runtime and monitor files are byte-identical to accepted baseline', () => {
  for (const [path, expectedSha] of Object.entries(FROZEN_RUNTIME_CONTRACT.criticalFiles)) {
    assert.equal(gitBlobSha(localFile(path)), expectedSha, `FROZEN_RUNTIME_DRIFT:${path}`);
  }
});

test('strict forward evidence snapshots are append-only and byte-immutable', () => {
  for (const [path, expectedSha] of Object.entries(FROZEN_RUNTIME_CONTRACT.immutableEvidenceFiles)) {
    assert.equal(gitBlobSha(localFile(path)), expectedSha, `FORWARD_EVIDENCE_MUTATED:${path}`);
    const snapshot = JSON.parse(localFile(path).toString('utf8'));
    assert.equal(snapshot.immutable, true);
    assert.equal(snapshot.scoringImpact, 'NONE');
    assert.match(snapshot.snapshotHash, /^[a-f0-9]{64}$/);
  }
});

test('frozen RC2 policy remains exactly identical to accepted baseline', () => {
  assert.deepEqual(plain(POLICY), plain(FROZEN_RUNTIME_CONTRACT.policy));
});

test('execution permissions remain fail-closed', () => {
  assert.equal(POLICY.permissions.researchOnly, true);
  assert.equal(POLICY.permissions.executionAllowed, false);
  assert.equal(POLICY.permissions.productionAllocation, false);
  assert.equal(POLICY.permissions.automaticOrders, false);
  assert.equal(POLICY.permissions.automaticChampionPromotion, false);
});

test('frozen runtime is not allowed to import validation, evidence, or sidecar modules', () => {
  const sourcePaths = Object.keys(FROZEN_RUNTIME_CONTRACT.criticalFiles)
    .filter((path) => path.endsWith('.js'));
  const forbidden = /(?:from\s*['"][^'"]*|import\s*\(['"][^'"]*)(?:sidecars|validation|stability|evidence)/i;
  for (const path of sourcePaths) {
    const source = localFile(path).toString('utf8');
    assert.equal(forbidden.test(source), false, `FORBIDDEN_SIDECAR_DEPENDENCY:${path}`);
  }
});

test('sidecar contract explicitly forbids influence on production scan and UI boot', () => {
  const rules = FROZEN_RUNTIME_CONTRACT.sidecarRules;
  assert.equal(rules.scoringImpact, 'NONE');
  assert.equal(rules.frozenCoreMayImportSidecars, false);
  assert.equal(rules.productionScanMayCallSidecars, false);
  assert.equal(rules.uiBootMayCallSidecars, false);
  assert.equal(rules.automaticPromotionFromSidecarEvidence, false);
});

test('session monitor contract cannot alter Alpha, recommendations, or execution', () => {
  const rules = FROZEN_RUNTIME_CONTRACT.monitorRules;
  assert.equal(rules.monitorId, 'SESSION_MONITOR_V1');
  assert.equal(rules.pollingMs, 300000);
  assert.equal(rules.timeZone, 'Africa/Cairo');
  assert.equal(rules.source, 'MUBASHER_DELAYED_15_MIN');
  assert.equal(rules.sourceDelayMinutes, 15);
  assert.equal(rules.monitorOnly, true);
  assert.equal(rules.scoringImpact, 'NONE');
  assert.equal(rules.recommendationMutationAllowed, false);
  assert.equal(rules.executionAllowed, false);
  assert.equal(rules.importsAlphaModules, false);
  assert.equal(rules.productionScanCalled, false);
  assert.equal(rules.historyEndpointReadOnly, true);
  assert.equal(rules.staleSourceMustNotClaimLive, true);
});

test('session monitor source does not call production scan or import Alpha modules', () => {
  const paths = ['api/session-monitor.js','monitor/session-quote.js','public/session-monitor-core.js','public/session-monitor.js'];
  const joined = paths.map(path => localFile(path).toString('utf8')).join('\n');
  assert.equal(/route\s*[:=]\s*['"]scan['"]/i.test(joined), false);
  assert.equal(/api\/index\?[^\n]*route=scan/i.test(joined), false);
  assert.equal(/src\/(engine|policy|confidence|originalScore|originalIndicators)/.test(joined), false);
  assert.equal(/executionAllowed\s*[:=]\s*true/i.test(joined), false);
  assert.equal(/automaticOrders\s*[:=]\s*true/i.test(joined), false);
});
