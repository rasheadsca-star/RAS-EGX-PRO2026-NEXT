import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const api = readFileSync(new URL('../api/recommendation-history.js', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../public/recommendation-history-ui.js', import.meta.url), 'utf8');
const loader = readFileSync(new URL('../public/portfolio-manager.js', import.meta.url), 'utf8');

test('complete recommendation history is read-only and cannot change RC2 decisions', () => {
  assert.match(api, /scoringImpact:'NONE'/);
  assert.match(api, /recommendationMutationAllowed:false/);
  assert.match(api, /executionAllowed:false/);
  assert.match(api, /automaticOrders:false/);
  assert.match(api, /!\['GET','HEAD'\]\.includes\(req\.method\)/);
  assert.equal(/automaticOrders\s*:\s*true/.test(api), false);
  assert.equal(/executionAllowed\s*:\s*true/.test(api), false);
  assert.equal(/method\s*:\s*['"]POST['"]/.test(api), false);
  assert.equal(/broker|placeOrder|submitOrder|executeTrade/i.test(api), false);
});

test('published history and historical replay are explicitly separated', () => {
  assert.match(api, /Actual RC2 snapshots persisted from production\/immutable evidence/);
  assert.match(api, /Historical backtest signals generated with no-lookahead rules/);
  assert.match(api, /HISTORICAL_REPLAY_NOT_LIVE_PUBLISHED/);
  assert.match(ui, /Published RC2/);
  assert.match(ui, /Historical Replay/);
  assert.match(ui, /ليست ادعاءً بأنها نُشرت حيًا/);
});

test('history UI exposes full metrics, filters and five-minute refresh', () => {
  assert.match(ui, /const REFRESH_MS=300000/);
  assert.match(ui, /T1 Published/);
  assert.match(ui, /Stop Published/);
  assert.match(ui, /Avg Net Published/);
  assert.match(ui, /متوسط الهدف المخطط/);
  assert.match(ui, /متوسط مسافة الوقف/);
  assert.match(ui, /Entry Rate Published/);
  assert.match(ui, /rc2HistoryOutcome/);
  assert.match(ui, /rc2HistoryTicker/);
  assert.match(ui, /scope=all&format=csv/);
});

test('V16.9 RC2 loader includes complete recommendation history UI', () => {
  assert.match(loader, /recommendation-history-ui\.js\?v=20260824-history1/);
});
