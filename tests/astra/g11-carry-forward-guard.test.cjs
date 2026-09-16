'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../../astra/certification/g11-carry-forward-guard.cjs');

const fixtures = new Map(G.SELF_TEST_FIXTURES.map((x) => [x.id, x]));

function assertFixture(id, expectedUnsafe) {
  const fixture = fixtures.get(id);
  assert.ok(fixture, `missing fixture ${id}`);
  const findings = G.analyzeCarryForwardSource(fixture.source);
  assert.equal(findings.length > 0, expectedUnsafe, JSON.stringify(findings, null, 2));
}

test('guard self-test: carryForwardForbidden true is safe policy, not executable carry-forward', () => {
  assertFixture('SAFE_EXPLICIT_FORBIDDEN_POLICY', false);
});

test('guard self-test: executable carryForward helper is rejected', () => {
  assertFixture('UNSAFE_EXECUTABLE_CARRY_FORWARD', true);
});

test('guard self-test: documentation saying carry forward is forbidden is safe', () => {
  assertFixture('SAFE_PROHIBITION_DOCUMENTATION', false);
});

test('guard self-test: previous-session price promoted as current is rejected', () => {
  assertFixture('UNSAFE_PREVIOUS_PRICE_PROMOTED_CURRENT', true);
});
