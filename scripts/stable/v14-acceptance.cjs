#!/usr/bin/env node
'use strict';

const fs = require('fs');

function read(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function fail(message) {
  console.error(`V14 ACCEPTANCE FAILURE: ${message}`);
  process.exit(1);
}

const result = read('data/stable/v14-stable-decision.json');
const policy = read('data/stable/v14-policy.json');
const forward = read('data/stable/v14-forward-sessions.json');
const html = fs.readFileSync('preview-v14/app/index.html', 'utf8');

if (result.schemaVersion !== '14.0.0') fail('unexpected schema version');
if (result.mode !== 'STABLE_DECISION_SUPPORT') fail('unexpected system mode');
if (result.system?.automaticBrokerOrders !== false) fail('automatic broker orders must remain disabled');
if (policy.execution?.automaticBrokerOrders !== false) fail('policy enables automatic broker orders');
if (!Array.isArray(result.topFiveWatchlist)) fail('top-five watchlist is missing');
if (result.topFiveWatchlist.length > policy.watchlistSize) fail('watchlist exceeds policy size');
if (result.topFiveWatchlist.some((item, index) => item.watchRank !== index + 1)) fail('watchlist ranks are invalid');
if (!Array.isArray(result.qualifiedRecommendations)) fail('qualified recommendations are missing');
if (result.qualifiedRecommendations.length > policy.maximumQualifiedRecommendations) fail('too many qualified recommendations');
if (result.qualifiedRecommendations.some(item => String(item.tier || '').includes('TIER_B'))) fail('tier B entered qualified recommendations');
if (result.qualifiedRecommendations.some((item, index) => item.recommendationRank !== index + 1)) fail('qualified recommendation ranks are invalid');
if (result.decision?.noTrade === true && result.qualifiedRecommendations.length !== 0) fail('no-trade status conflicts with qualified recommendations');
if (result.decision?.noTrade === false && result.qualifiedRecommendations.length === 0) fail('trade status conflicts with empty recommendations');
if (!result.evidence?.methodology?.futureLeakageForbidden) fail('future leakage safeguard is missing');
if (!result.evidence?.methodology?.walkForward) fail('walk-forward safeguard is missing');
if (result.evidence?.methodology?.sameBarRule !== 'STOP_FIRST') fail('same-bar conservative rule changed');
if (!Array.isArray(forward.sessions)) fail('forward session ledger is invalid');

for (const marker of [
  'EGX Pro V14.0',
  'أفضل خمسة أسهم تحت النظر الآن',
  'التوصية الأولى',
  'لا توجد توصية شراء مؤهلة حاليًا',
  'V14_STABLE_DECISION_SYSTEM',
  '../../data/stable/v14-stable-decision.json',
]) {
  if (!html.includes(marker)) fail(`missing UI marker: ${marker}`);
}

const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map(match => match[1]);
const duplicates = [...new Set(ids.filter((value, index) => ids.indexOf(value) !== index))];
if (duplicates.length) fail(`duplicate HTML ids: ${duplicates.join(', ')}`);

console.log('V14.0 STABLE DECISION SYSTEM ACCEPTANCE PASSED');
console.log(JSON.stringify({
  sessionDate: result.sessionDate,
  watchlist: result.topFiveWatchlist.map(item => item.ticker),
  qualified: result.qualifiedRecommendations.map(item => item.ticker),
  modelStage: result.system?.modelStage,
  historicalResolved: result.evidence?.historical?.resolvedSignals,
  forwardCompleted: result.evidence?.forward?.completedForwardSessions,
}, null, 2));
