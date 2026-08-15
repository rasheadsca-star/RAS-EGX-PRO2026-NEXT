#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const writeAtomic = (rel, value) => {
  const file = P(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
};
const finite = value => Number.isFinite(Number(value));
const sha256 = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

function findCandidateArrays(value, out = []) {
  if (Array.isArray(value)) {
    if (value.length && value.every(row => row && typeof row === 'object' && finite(row.nativeResearchScore) && (row.ticker || row.symbol))) out.push(value);
    for (const item of value) findCandidateArrays(item, out);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) findCandidateArrays(item, out);
  }
  return out;
}

const selection = read('data/v20/full-market-native-selection.json');
const policy = read('data/v20/decision-intelligence-policy.json');
const current = read('data/v20/current.json');
const expectedPublished = Number(selection?.summary?.publishedResearchCandidateCount ?? selection?.summary?.publishedCandidateCount ?? 30);
const arrays = findCandidateArrays(selection);
let published = Array.isArray(selection.publishedCandidates) ? selection.publishedCandidates : null;
if (!published || !published.length) {
  published = arrays.find(rows => rows.length === expectedPublished && rows.every(row => Number(row.rank) >= 1)) || null;
}
if (!published || !published.length) throw new Error('Cannot resolve published Native candidate array from full-market selection');
published = published.slice().sort((a, b) => Number(a.rank || 9999) - Number(b.rank || 9999));
if (expectedPublished && published.length !== expectedPublished) throw new Error(`Native published count mismatch: ${published.length} vs ${expectedPublished}`);

const engineId = selection.engineId || selection.engine || policy?.fullMarketNative?.engineId || 'V20_FULL_MARKET_NATIVE_SELECTION_V1';
if (engineId !== 'V20_FULL_MARKET_NATIVE_SELECTION_V1') throw new Error(`Unexpected Native engine identity: ${engineId}`);
if (policy?.fullMarketNative?.legacySeedDependency !== false) throw new Error('Native legacy seed dependency must remain false');
if (Number(selection?.summary?.legacyScoringContributionPct ?? policy?.fullMarketNative?.legacyScoringContributionPct ?? 0) !== 0) throw new Error('Native legacy scoring contribution must remain 0%');

const rows = published.map((row, index) => ({
  rank: Number(row.rank || index + 1),
  ticker: String(row.ticker || row.symbol || '').toUpperCase(),
  nameAr: row.nameAr ?? null,
  nameEn: row.nameEn ?? null,
  sessionDate: current.sessionDate,
  price: finite(row.price) ? Number(row.price) : null,
  nativeResearchScore: Number(row.nativeResearchScore),
  nativeResearchTier: row.nativeResearchTier ?? null,
  discoveryScore: finite(row.discoveryScore) ? Number(row.discoveryScore) : null,
  liquidity2Score: finite(row.liquidity2Score) ? Number(row.liquidity2Score) : null,
  srConfluenceScore: finite(row.srConfluenceScore) ? Number(row.srConfluenceScore) : null,
  srMethodCount: finite(row.srMethodCount) ? Number(row.srMethodCount) : null,
  technicalScore: finite(row.technicalScore) ? Number(row.technicalScore) : null,
  netRiskReward: finite(row.netRiskReward) ? Number(row.netRiskReward) : null,
  tradePlan: {
    entryLow: finite(row.entryLow) ? Number(row.entryLow) : null,
    entryHigh: finite(row.entryHigh) ? Number(row.entryHigh) : null,
    stop: finite(row.stop) ? Number(row.stop) : null,
    target1: finite(row.target1) ? Number(row.target1) : null,
    target2: finite(row.target2) ? Number(row.target2) : null,
    alignmentState: row.alignmentState ?? null,
    entryDistancePct: finite(row.entryDistancePct) ? Number(row.entryDistancePct) : null,
    roundTripTransactionCostPct: Number(policy?.fullMarketNative?.roundTripTransactionCostPct ?? 0.6)
  },
  rankingTieBreaker: row.rankingTieBreaker || null,
  wasInLegacySeedUniverse: row.wasInLegacySeedUniverse === true,
  baselineResearchRank: finite(row.baselineResearchRank) ? Number(row.baselineResearchRank) : null,
  researchOnly: true,
  grantsExecutionPermission: false
}));

const rankingDigest = sha256(rows.map(row => ({rank: row.rank, ticker: row.ticker, score: row.nativeResearchScore, tier: row.nativeResearchTier, plan: row.tradePlan, tieBreak: row.rankingTieBreaker})));
const out = {
  schemaVersion: '20.0.0-native-current-1',
  generatedAt: new Date().toISOString(),
  sessionDate: current.sessionDate,
  engineId,
  modelVersion: 'V1',
  status: 'SHADOW_RESEARCH_ONLY_UNCALIBRATED',
  authoritativeFor: 'FULL_MARKET_NATIVE_RESEARCH_RANKING',
  notAuthoritativeFor: ['V17_PRODUCTION_ELIGIBILITY', 'EXECUTION_PERMISSION', 'PRODUCTION_ALLOCATION', 'CHAMPION_PROMOTION'],
  candidateUniverseIsFullMarketIndependent: selection.candidateUniverseIsFullMarketIndependent !== false,
  legacySeedDependency: false,
  legacyScoringContributionPct: 0,
  rankingContract: rows[0]?.rankingTieBreaker?.contract || policy?.fullMarketNative?.rankingDiscrimination?.contract || 'V20_SAFETY_STRENGTH_LEXICOGRAPHIC_TIE_BREAK_V2',
  summary: {...(selection.summary || {}), publishedResearchCandidateCount: rows.length},
  rankingDigest,
  publishedCandidates: rows,
  source: {
    selectionArtifact: 'data/v20/full-market-native-selection.json',
    policyArtifact: 'data/v20/decision-intelligence-policy.json',
    regressionOwnsRanking: false
  }
};

writeAtomic('data/v20/native-current.json', out);
console.log(JSON.stringify({ok: true, sessionDate: out.sessionDate, engineId, published: rows.length, rankingDigest, legacyScoringContributionPct: 0}, null, 2));
