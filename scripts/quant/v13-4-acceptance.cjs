#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const Q = path.join(ROOT, 'data', 'quant');
const required = [
  'feature-store.json',
  'market-regime.json',
  'strategy-backtests.json',
  'walk-forward-results.json',
  'recommendation-model.json',
  'daily-recommendations.json',
  'recommendation-audit.json'
];

function fail(message) {
  console.error(`V13.4 ACCEPTANCE FAILURE: ${message}`);
  process.exit(1);
}

function read(name) {
  const file = path.join(Q, name);
  if (!fs.existsSync(file)) fail(`missing ${name}`);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`invalid JSON ${name}: ${error.message}`); }
}

for (const name of required) {
  const file = path.join(Q, name);
  if (!fs.existsSync(file) || fs.statSync(file).size < 20) fail(`missing or empty ${name}`);
}

const features = read('feature-store.json');
const regime = read('market-regime.json');
const backtests = read('strategy-backtests.json');
const walk = read('walk-forward-results.json');
const model = read('recommendation-model.json');
const recs = read('daily-recommendations.json');
const audit = read('recommendation-audit.json');

for (const doc of [features, regime, backtests, walk, model, recs, audit]) {
  if (doc.schemaVersion !== '13.4.0') fail(`unexpected schema version ${doc.schemaVersion}`);
}

if (model.liveExecutionEnabled !== false || recs.liveExecutionEnabled !== false) fail('live execution must be disabled');
if (audit.controls?.noLookahead !== true || audit.controls?.futureDataAtSignal !== false) fail('no-lookahead controls are missing');
if (audit.controls?.sameBarConflictRule !== 'stop_first') fail('same-bar conflict must be stop_first');
if (backtests.assumptions?.entryTiming !== 'next_session_open_plus_slippage') fail('backtest must enter after the signal session');
if (!(Number(backtests.assumptions?.roundTripCostPct) > 0)) fail('transaction-cost assumption is missing');

const blocked = new Set(['SAIB', 'NDRL', 'SPHT', 'EGSA', 'FAITA', 'ESRS']);
const allCandidates = [...(recs.paperCandidates || []), ...(recs.watchCandidates || [])];
for (const item of allCandidates) {
  if (blocked.has(String(item.ticker || '').toUpperCase())) fail(`blocked ticker leaked into candidates: ${item.ticker}`);
  if (item.signalDate !== recs.sessionId) fail(`${item.ticker} signal date does not match the current session`);
  if (!['PAPER_CANDIDATE', 'WATCH_CONDITIONAL'].includes(item.status)) fail(`${item.ticker} has unsafe status ${item.status}`);
  const p = item.plan || {};
  if (![p.entryLow, p.entryHigh, p.stopLoss, p.target1, p.target2].every(Number.isFinite)) fail(`${item.ticker} has incomplete plan`);
  if (!(p.entryLow <= p.entryHigh && p.stopLoss < p.entryLow && p.target1 > p.entryHigh && p.target2 > p.target1)) fail(`${item.ticker} has illogical trade plan`);
  if (!(Number(p.validEntrySessions) === 1)) fail(`${item.ticker} entry validity must be one session`);
}

for (const item of recs.paperCandidates || []) {
  const strategy = (model.strategies || []).find(s => s.strategyId === item.strategyId);
  if (!strategy?.researchValidated) fail(`${item.ticker} became a paper candidate from an unvalidated strategy`);
}

let previousTestEnd = null;
for (const fold of walk.folds || []) {
  if (!(fold.trainStart <= fold.trainEnd && fold.trainEnd < fold.testStart && fold.testStart <= fold.testEnd)) fail(`invalid chronology in fold ${fold.fold}`);
  if (previousTestEnd && fold.testStart <= previousTestEnd) fail(`overlapping validation blocks at fold ${fold.fold}`);
  previousTestEnd = fold.testEnd;
  for (const selection of fold.selections || []) {
    for (const trade of selection.validationTrades || []) {
      if (trade.signalDate < fold.testStart || trade.signalDate > fold.testEnd) fail(`validation trade outside fold ${fold.fold}`);
      if (trade.entryDate < trade.signalDate) fail(`lookahead timing error in ${trade.ticker}`);
    }
  }
}

for (const strategy of backtests.strategies || []) {
  if (strategy.metrics?.sameBarStopFirstCount < 0) fail('invalid same-bar count');
  for (const trade of strategy.sampleTrades || []) {
    if (trade.entryDate < trade.signalDate) fail(`entry before signal in ${trade.ticker}`);
    if (trade.sameBarConflict && trade.outcome !== 'STOP_FIRST_SAME_BAR') fail(`same-bar rule violated in ${trade.ticker}`);
  }
}

if (!Array.isArray(features.symbols) || !features.symbols.length) fail('feature store is empty');
if (!Array.isArray(model.strategies) || model.strategies.length !== 3) fail('the three required strategies are not present');
if (!['BULLISH', 'BALANCED', 'BEARISH', 'HIGH_VOLATILITY'].includes(regime.code)) fail(`unknown regime ${regime.code}`);

console.log('V13.4 acceptance tests passed.');
console.log(`Feature symbols: ${features.symbols.length}`);
console.log(`Walk-forward folds: ${(walk.folds || []).length}`);
console.log(`Paper candidates: ${(recs.paperCandidates || []).length}`);
console.log(`Watch candidates: ${(recs.watchCandidates || []).length}`);
