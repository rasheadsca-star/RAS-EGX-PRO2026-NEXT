'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const artifactPath = path.join(ROOT, 'docs/astra/G11_DERIVED_BUILD_FAILURES.json');
const read = () => JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

test('derived build failure accounting closes', () => {
  const a = read();
  assert.equal(a.accountingCloses, true);
  assert.equal(a.diagnosedUnavailable + a.unexplainedBuildFailures, a.totalBuildFailures);
});

test('derived build failures contain no unexplained omission', () => {
  const a = read();
  assert.equal(a.unexplainedBuildFailures, 0, JSON.stringify(a.records, null, 2));
});

test('every diagnosed derived failure has explicit input state, root cause, and production impact', () => {
  const a = read();
  for (const row of a.records) {
    assert.ok(row.ticker);
    assert.ok(row.securityId);
    assert.ok(row.failedComponent);
    assert.ok(row.classification);
    assert.ok(row.inputState);
    assert.ok(Number.isInteger(row.inputState.validHistorySessions));
    assert.ok(row.rootCause);
    assert.ok(row.productionImpact);
  }
});
