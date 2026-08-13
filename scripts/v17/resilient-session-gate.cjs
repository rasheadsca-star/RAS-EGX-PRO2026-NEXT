#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
function read(p) { try { return JSON.parse(fs.readFileSync(path.join(root, p), 'utf8')); } catch { return null; } }
function write(p, v) {
  const f = path.join(root, p);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const t = `${f}.tmp`;
  fs.writeFileSync(t, `${JSON.stringify(v, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(t, 'utf8'));
  fs.renameSync(t, f);
}
function n(v) { const x = Number(v); return Number.isFinite(x) ? x : null; }
function age(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 6000) / 10 : null;
}

const health = read('data/source-health.json') || {};
const fresh = read('data/price-freshness-report.json') || {};
const audit = read('data/price-source-audit.json') || {};
const market = read('data/market.json') || {};
const cache = read('data/full-market-cache.json') || {};

const marketRows = Array.isArray(market.rows) ? market.rows.length : Array.isArray(market.data) ? market.data.length : 0;
const cacheRows = Array.isArray(cache.rows) ? cache.rows.length : 0;
const availableRows = Math.max(marketRows, cacheRows);
const last = fresh.lastSourceUpdate || health.lastSuccessAt || health.generatedAt || market.updatedAt || cache.updatedAt || null;
const sourceAge = n(fresh.sourceAgeMinutes) ?? age(last);
const primary = process.env.MUBASHER_PRIMARY_OUTCOME || 'unknown';
const sr = process.env.RENDERED_SR_OUTCOME || 'unknown';
const merge = process.env.MERGE_SR_OUTCOME || 'unknown';
const summary = audit.summary || {};
const marketCoveragePct = n(summary.marketCoveragePct) ?? n(health.universeCoveragePct) ?? 0;
const sourceCoveragePct = n(summary.sourceCoveragePct) ?? n(health.coveragePct) ?? marketCoveragePct;
const stale = sourceAge !== null && sourceAge > 2160;
const usable = availableRows > 0;
const priceTruthHealthy = usable && !stale && marketCoveragePct >= 90;
const researchMinimumHealthy = usable && !stale && marketCoveragePct >= 75;
const supportResistanceReady = sr === 'success' && merge === 'success';
const auxiliaryFeedReady = primary === 'success';
const executionInputsReady = priceTruthHealthy && supportResistanceReady && auxiliaryFeedReady;

let mode = 'NORMAL';
const reasons = [];
if (!usable) {
  mode = 'BLOCKED';
  reasons.push('NO_USABLE_MARKET_DATA');
}
if (stale) {
  mode = 'BLOCKED';
  reasons.push('SOURCE_DATA_STALE');
}
if (usable && !stale && marketCoveragePct < 75) {
  mode = 'BLOCKED';
  reasons.push('MARKET_PRICE_COVERAGE_BELOW_RESEARCH_MINIMUM');
} else if (usable && !stale && marketCoveragePct < 90) {
  mode = 'DEGRADED';
  reasons.push('MARKET_PRICE_COVERAGE_BELOW_PREFERRED_THRESHOLD');
}
if (!auxiliaryFeedReady && mode !== 'BLOCKED') {
  mode = 'DEGRADED';
  reasons.push('AUXILIARY_MUBASHER_FEED_UNAVAILABLE');
}
if (!supportResistanceReady && mode !== 'BLOCKED') {
  mode = 'DEGRADED';
  reasons.push('SUPPORT_RESISTANCE_UNAVAILABLE_OR_UNVERIFIED');
}

const confidenceCap = mode === 'NORMAL' ? 1 : mode === 'DEGRADED' ? 0.72 : 0;
const out = {
  schemaVersion: '17.0.0-resilient-session-gate-2',
  generatedAt: new Date().toISOString(),
  mode,
  reasons: [...new Set(reasons)],
  priceTruth: {
    healthy: priceTruthHealthy,
    researchMinimumHealthy,
    marketCoveragePct,
    sourceCoveragePct,
    stale,
    sourceAgeMinutes: sourceAge,
    sourceName: health.sourceName || market.source || null,
  },
  executionInputs: {
    ready: executionInputsReady,
    auxiliaryFeedReady,
    supportResistanceReady,
  },
  sourceState: {
    auxiliaryMubasherFeed: primary,
    renderedSupportResistance: sr,
    mergedSupportResistance: merge,
    availableRows,
    marketRows,
    cacheRows,
    lastSourceUpdate: last,
    sourceAgeMinutes: sourceAge,
    stale,
  },
  confidencePolicy: {
    confidenceCap,
    confidenceCapPct: Math.round(confidenceCap * 100),
    allowResearchRanking: researchMinimumHealthy,
    allowAutomaticPromotion: false,
    allowExecutionGradeClaim: mode === 'NORMAL' && executionInputsReady,
    requireExplicitDegradedLabel: mode !== 'NORMAL',
  },
  readiness: {
    researchReady: researchMinimumHealthy,
    priceTruthHealthy,
    executionReady: mode === 'NORMAL' && executionInputsReady,
  },
  sourceAuditSummary: summary,
  invariant: 'V16 champion and main branch are not modified or promoted by this V17 lab gate.',
};

write('data/v17/resilient-session-status.json', out);
console.log(JSON.stringify(out, null, 2));
if (mode === 'BLOCKED') process.exitCode = 2;
