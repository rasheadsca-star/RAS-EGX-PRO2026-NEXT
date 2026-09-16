'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

test('all 42 baseline identity cases receive deterministic final dispositions', () => {
  const a = read('docs/astra/G11_SOURCE_IDENTITY_REPAIR.json');
  assert.equal(a.reviewed, 42);
  assert.equal(a.records.length, 42);
  assert.equal(a.finalDispositionAccountingCloses, true);
  assert.equal(a.records.every((x) => Boolean(x.finalDisposition) && Boolean(x.finalDispositionReason)), true);
  assert.equal(a.records.some((x) => x.nameMatchingUsedForResolution === true), false);
});

test('source-does-not-cover and invalid-source cases are never silently relabeled as repaired identities', () => {
  const a = read('docs/astra/G11_SOURCE_IDENTITY_REPAIR.json');
  const unresolved = a.records.filter((x) => x.repairedMappingStatus !== 'RESOLVED_EXACT_SOURCE_ID');
  assert.equal(unresolved.length, a.unresolved);
  for (const row of unresolved) {
    assert.ok(row.finalDisposition);
    assert.notEqual(row.finalDisposition, 'REPAIRED_EXACT_SOURCE_ID_CURRENT_ROW_VALID');
    if (row.productionRelevantBlocker === false) assert.ok(row.alternativeCanonicalCurrentEvidence);
  }
});

test('original stale-set disposition accounting closes without carry-forward assumptions', () => {
  const a = read('docs/astra/G11_CURRENT_DATA_REPAIR_REPORT.json');
  const s = a.finalStaleDisposition;
  assert.equal(s.baselineTotal, 20);
  assert.equal(s.repaired + s.remaining, s.baselineTotal);
  assert.equal(s.records.length, s.baselineTotal);
  assert.equal(s.records.every((x) => x.currentValidCanonicalRow === (x.status === 'REPAIRED_OR_ALREADY_CURRENT_WITH_VALIDATION_APPROVED_EVIDENCE')), true);
});
