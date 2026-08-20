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

test('frozen RC2 critical runtime files are byte-identical to accepted baseline', () => {
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
