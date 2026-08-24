import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FROZEN_RUNTIME_CONTRACT } from '../stability/frozen-runtime-contract.js';

const source = readFileSync(new URL('../api/intraday.js', import.meta.url), 'utf8');

test('intraday endpoint exposes read-only CORS for MAIN APP quotes', () => {
  assert.match(source, /access-control-allow-origin', '\*'/);
  assert.match(source, /access-control-allow-methods', 'GET, OPTIONS'/);
  assert.match(source, /String\(req\.method \|\| 'GET'\)\.toUpperCase\(\) === 'OPTIONS'/);
  assert.match(source, /statusCode = 204/);
});

test('CORS transport cannot enable recommendation mutation or execution', () => {
  assert.match(source, /recommendationMutationAllowed:\s*false/);
  assert.match(source, /publicationAllowed:\s*false/);
  assert.match(source, /executionAllowed:\s*false/);
  assert.match(source, /automaticOrders:\s*false/);
  assert.equal(/executionAllowed\s*:\s*true/.test(source), false);
  assert.equal(/automaticOrders\s*:\s*true/.test(source), false);
  assert.equal(/method\s*===?\s*['"]POST['"]/.test(source), false);
});

test('frozen contract records MAIN APP CORS as transport only', () => {
  const rules = FROZEN_RUNTIME_CONTRACT.intradayRules;
  assert.equal(rules.corsReadOnly, true);
  assert.equal(rules.corsAllowedMethods, 'GET_OPTIONS');
  assert.equal(rules.corsMayMutateRecommendations, false);
  assert.equal(rules.corsMayExecuteOrders, false);
  assert.equal(rules.scoringImpact, 'NONE');
  assert.equal(rules.executionAllowed, false);
});
