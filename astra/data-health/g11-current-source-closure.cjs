#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { readHistory } = require('../../scripts/history/history-storage.cjs');
const { validateCurrentRow } = require('../../scripts/history/adapters/g11-approved-current-source-adapter.cjs');
const { readJson, safeTicker, writeJsonAtomic } = require('../../scripts/history/lib/utils.cjs');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const R = (p) => path.join(ROOT, p);
const read = (p, d = null) => readJson(R(p), d);
const write = (p, v) => writeJsonAtomic(R(p), v);
const expected = String(process.env.EXPECTED_SESSION || '').slice(0, 10);
const evaluatedAt = process.env.G11_EVALUATED_AT || new Date().toISOString();
if (!/^\d{4}-\d{2}-\d{2}$/.test(expected)) throw new Error(`EXPECTED_SESSION missing/invalid: ${expected}`);

function mapRows(raw) {
  return Array.isArray(raw) ? raw : Object.entries(raw || {}).map(([ticker, value]) => ({ ...(value || {}), ticker: value?.ticker || ticker }));
}
function dateOnly(v) { const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/); return m ? m[1] : null; }
function validCurrent(doc) {
  const row = (doc?.sessions || []).find((s) => dateOnly(s.date || s.sessionDate) === expected);
  if (!row || doc?.symbolVerified !== true) return false;
  return validateCurrentRow({
    sessionDate: expected,
    open:Number(row.open), high:Number(row.high), low:Number(row.low), close:Number(row.close),
    volume:row.volume === null || row.volume === undefined ? null : Number(row.volume),
  }, expected).ok;
}

const symbolMap = read('data/symbol-map.json', {});
const active = mapRows(symbolMap).map((x) => ({ ...x, ticker:safeTicker(x.ticker) })).filter((x) => x.ticker && x.active !== false);
const gaps = [];
for (const entry of active) {
  const doc = readHistory(ROOT, entry.ticker);
  if (validCurrent(doc)) continue;
  const latest = (doc?.sessions || []).map((s) => dateOnly(s.date || s.sessionDate)).filter(Boolean).sort().at(-1) || null;
  gaps.push({
    securityId:`EGX:${entry.ticker}`,
    ticker:entry.ticker,
    component:'CURRENT_CANONICAL_HISTORY_AND_V16_SOURCE_FEATURES',
    expectedSession:expected,
    actualSession:latest,
    source:`data/history/${entry.ticker}.json`,
    reason:latest && latest < expected ? 'LATEST_VALIDATION_APPROVED_ROW_PREDATES_EXPECTED_SESSION' : 'EXPECTED_SESSION_VALIDATED_ROW_UNAVAILABLE',
    affectedStrategy:'PORTFOLIO_BASKET_EQUAL_WEIGHT',
    affectedModule:'market-regime + V16 source features + production candidate selection',
    canAffectCurrentDecisioning:true,
    status:'UNRESOLVED_CURRENT_SESSION_GAP',
  });
}

const stalePath = R('docs/astra/G11_STALE_RECORDS.json');
const identityPath = R('docs/astra/G11_SOURCE_IDENTITY_REPAIR.json');
const identityBytes = fs.readFileSync(identityPath);
const identity = JSON.parse(identityBytes.toString('utf8'));

write('docs/astra/G11_STALE_RECORDS.json', {
  schemaVersion:'astra-g11-stale-records-1',
  evaluatedAt,
  sourceHead:process.env.GITHUB_SHA || null,
  expectedSession:expected,
  total:gaps.length,
  resolved:0,
  unresolved:gaps.length,
  records:gaps,
  rebaselinedForCurrentSession:true,
  safety:{carryForward:false,syntheticMarketData:false},
});
write('docs/astra/G11_CURRENT_GAP_REBASELINE.json', {
  schemaVersion:'astra-g11-current-gap-rebaseline-1',
  generatedAt:evaluatedAt,
  expectedSession:expected,
  activeUniverse:active.length,
  currentBeforeFallback:active.length-gaps.length,
  fallbackTargets:gaps.length,
  fallbackTargetTickers:gaps.map((x)=>x.ticker),
});

try {
  identity.expectedSession = expected;
  identity.currentClosureSessionOverride = {
    session:expected,
    temporaryRuntimeOverride:true,
    reason:'Source-identity evidence is preserved; only the current source-closure session is aligned to the dynamically resolved expected session.',
  };
  fs.writeFileSync(identityPath, JSON.stringify(identity, null, 2)+'\n', 'utf8');
  const result = cp.spawnSync(process.execPath, [R('astra/data-health/g11-approved-source-closure.cjs')], {
    cwd:ROOT,
    stdio:'inherit',
    env:{...process.env, EXPECTED_SESSION:expected},
  });
  if (result.status !== 0) process.exitCode = result.status || 1;
} finally {
  fs.writeFileSync(identityPath, identityBytes);
}
