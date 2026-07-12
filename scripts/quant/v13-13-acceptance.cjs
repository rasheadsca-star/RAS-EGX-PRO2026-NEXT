#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());

function read(relative, required = true) {
  const file = path.join(ROOT, relative);
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`Missing ${relative}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function fail(message) {
  console.error(`V13.13 ACCEPTANCE FAILURE: ${message}`);
  process.exit(1);
}

const required = [
  'data/v13-13-daily-pipeline-policy.json',
  'data/quant/live-reranked-decision-v13-13.json',
  'scripts/postclose/v13-13-session-consolidator.cjs',
  'scripts/quant/v13-13-live-rerank.cjs',
  'preview-v13/app/live-decision.html',
  'preview-v13/app/daily-decision.html',
  'preview-v13/app/index.html'
];
for (const relative of required) {
  if (!fs.existsSync(path.join(ROOT, relative))) fail(`missing ${relative}`);
}

const live = read('data/quant/live-reranked-decision-v13-13.json');
const daily = read('data/quant/daily-decision-workspace-v13-11.json');
const policy = read('data/v13-13-daily-pipeline-policy.json');
const mode = String(process.env.V13_13_ACCEPTANCE_MODE || 'AUTO').toUpperCase();

if (live.schemaVersion !== '13.13.0') fail(`unexpected live schema ${live.schemaVersion}`);
if (live.liveExecutionEnabled !== false) fail('live execution must remain false');
if (live.intradayTierPromotionEnabled !== false) fail('intraday tier promotion must remain false');
if (!Array.isArray(live.candidates) || !Array.isArray(live.topCandidates)) fail('candidate arrays missing');
if (live.topCandidates.length > Number(policy.liveRanking.maximumDisplayedCandidates || 10)) fail('too many displayed candidates');

const tickers = live.candidates.map(x => x.ticker);
if (new Set(tickers).size !== tickers.length) fail('duplicate candidate tickers');
for (const item of live.candidates) {
  if (item.tierChangedIntraday !== false) fail(`${item.ticker} tier changed intraday`);
  if (item.liveExecutionEnabled !== false) fail(`${item.ticker} live execution enabled`);
  if (item.baselineTier === 'TIER_B_PRIORITY_WATCH' && item.actionablePaper === true) {
    fail(`${item.ticker} Tier B became actionable`);
  }
}
for (let i = 1; i < live.candidates.length; i += 1) {
  if (Number(live.candidates[i - 1].liveDecisionScore) < Number(live.candidates[i].liveDecisionScore)) {
    fail('live ranking order invalid');
  }
}

if (mode === 'POSTCLOSE') {
  const consolidation = read('data/postclose/latest-v13-13.json');
  const summary = read('data/history-summary.json');
  if (!['CONSOLIDATED', 'ALREADY_CONSOLIDATED'].includes(consolidation.status)) {
    fail(`post-close status is ${consolidation.status}`);
  }
  if (consolidation.targetPassed !== true) fail('post-close target did not pass');
  if (summary.latestMarketSession !== consolidation.sessionDate) {
    fail(`history summary ${summary.latestMarketSession} does not match ${consolidation.sessionDate}`);
  }
  if (daily.sessionId !== consolidation.sessionDate) {
    fail(`daily decision ${daily.sessionId} does not match ${consolidation.sessionDate}`);
  }
  if (live.analysisSessionId !== consolidation.sessionDate) {
    fail(`live baseline ${live.analysisSessionId} does not match ${consolidation.sessionDate}`);
  }
}

const page = fs.readFileSync(path.join(ROOT, 'preview-v13/app/live-decision.html'), 'utf8');
for (const text of [
  'V13.13',
  'الترتيب الحي',
  'جلسة التحليل اليومي',
  'لقطة السوق الحالية',
  'لا يغير طبقة التوصية'
]) {
  if (!page.includes(text)) fail(`live page missing ${text}`);
}
if (!page.includes('../../data/quant/live-reranked-decision-v13-13.json')) {
  fail('live page missing the V13.13 data source');
}

const dailyPage = fs.readFileSync(path.join(ROOT, 'preview-v13/app/daily-decision.html'), 'utf8');
for (const text of ['liveRankStrip1313', 'live-decision.html', 'V13.13']) {
  if (!dailyPage.includes(text)) fail(`daily page missing ${text}`);
}

const index = fs.readFileSync(path.join(ROOT, 'preview-v13/app/index.html'), 'utf8');
for (const text of ['EGX Pro V13.13', 'live-decision.html', 'الترتيب الحي V13.13']) {
  if (!index.includes(text)) fail(`index missing ${text}`);
}
if (!index.includes('class="view active" id="view-daily1311"')) fail('daily decision must remain default');

console.log(`V13.13 acceptance tests passed in ${mode} mode.`);
