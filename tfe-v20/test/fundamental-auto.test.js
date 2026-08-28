import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../api/fundamental.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/fundamental-auto.js', import.meta.url), 'utf8');
const wrapper = readFileSync(new URL('../public/portfolio-manager.js', import.meta.url), 'utf8');

test('fundamental endpoint is read-only, source-explicit, and searches full-market records', () => {
  assert.match(api, /v16-fundamental-analysis\.json/);
  assert.match(api, /document\?\.records/);
  assert.match(api, /scoringImpact:\s*'NONE'/);
  assert.match(api, /recommendationMutationAllowed:\s*false/);
  assert.match(api, /executionAllowed:\s*false/);
  assert.equal(/analyzeTicker|rankAnalyses|backtestHistory/.test(api), false);
});

test('automatic fundamental UI loads the dedicated endpoint and does not persist automatically', () => {
  assert.match(ui, /\/api\/fundamental/);
  assert.match(ui, /relativeFairValue/);
  assert.match(ui, /redFlags/);
  assert.match(ui, /peerComparison/);
  assert.match(ui, /officialVerified/);
  assert.equal(/localStorage\.setItem/.test(ui), false);
});

test('portfolio module wrapper loads automatic fundamentals alongside existing deep portfolio layer', () => {
  assert.match(wrapper, /portfolio-deep-analysis\.js/);
  assert.match(wrapper, /fundamental-auto\.js/);
});
