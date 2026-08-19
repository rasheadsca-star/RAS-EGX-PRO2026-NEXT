import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../public/ui-v169.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../public/styles-v169.css', import.meta.url), 'utf8');
const api = await readFile(new URL('../api/index.js', import.meta.url), 'utf8');

test('V16.9 professional shell exposes all five primary views', () => {
  for (const id of ['view-dashboard','view-market','view-portfolio','view-fundamentals','view-evidence']) assert.ok(html.includes(`id="${id}"`), id);
});

test('V16.9 interface includes recommendation, market, position and evidence options', () => {
  for (const id of ['recommendationFilter','marketSearch','positionResult','fundamentalTicker','confidenceGate','evaluationRows']) assert.ok(html.includes(`id="${id}"`), id);
});

test('portfolio and fundamentals are explicitly non-alpha local helpers', () => {
  assert.ok(html.includes('محفوظة محليًا فقط'));
  assert.ok(html.includes('لا يدخل في RC2 Fusion Rank'));
  assert.ok(js.includes('localStorage'));
});

test('UI adapter never imports engine, scorer or policy modules', () => {
  assert.equal(/from\s+['"].*src\/(engine|originalScore|policy)/.test(js), false);
  assert.equal(/import\s*\(/.test(js), false);
});

test('UI adapter consumes public API instead of reimplementing technical scoring', () => {
  assert.ok(js.includes("const API='/api/index'"));
  assert.equal(js.includes('function scoreBars'), false);
  assert.equal(js.includes('function analyzeTicker'), false);
});

test('market-index and history endpoints declare zero scoring impact', () => {
  assert.ok(api.includes("scoringImpact: 'NONE'"));
  assert.ok(api.includes("route === 'market-index'"));
  assert.ok(api.includes("route === 'history'"));
});

test('professional visual contract retains core V16.9 layout classes', () => {
  for (const cls of ['.topbar','.tabs','.recommendation-grid','.selected-layout','.market-results','.portfolio-grid','.evidence-grid']) assert.ok(css.includes(cls), cls);
});

test('interface contains no execution-enabling control', () => {
  assert.equal(/executionAllowed\s*=\s*true/i.test(js), false);
  assert.equal(/automaticOrders\s*=\s*true/i.test(js), false);
  assert.ok(html.includes('Execution مقفول'));
});
