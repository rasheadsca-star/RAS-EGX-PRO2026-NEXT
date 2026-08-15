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
const numberOrNull = value => finite(value) ? Number(value) : null;
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
const nativePolicy = policy?.fullMarketNativeSelection || {};
const expectedPublished = Number(selection?.summary?.publishedResearchCandidateCount ?? selection?.summary?.publishedCandidateCount ?? nativePolicy.maximumPublishedResearchCandidates ?? 30);
const arrays = findCandidateArrays(selection);
let published = Array.isArray(selection.recommendationRanking) ? selection.recommendationRanking : (Array.isArray(selection.publishedCandidates) ? selection.publishedCandidates : null);
if (!published || !published.length) {
  published = arrays.find(rows => rows.length === expectedPublished && rows.every(row => Number(row.rank) >= 1)) || null;
}
if (!published || !published.length) throw new Error('Cannot resolve published Native candidate array from full-market selection');
published = published.slice().sort((a, b) => Number(a.rank || 9999) - Number(b.rank || 9999));
if (expectedPublished && published.length !== expectedPublished) throw new Error(`Native published count mismatch: ${published.length} vs ${expectedPublished}`);

const engineId = selection.engineId || selection.engine || nativePolicy.engineId || 'V20_FULL_MARKET_NATIVE_SELECTION_V1';
if (engineId !== 'V20_FULL_MARKET_NATIVE_SELECTION_V1') throw new Error(`Unexpected Native engine identity: ${engineId}`);
if (nativePolicy.legacySeedDependency !== false) throw new Error('Native legacy seed dependency must remain false');
if (nativePolicy.candidateUniverseIsFullMarketIndependent !== true) throw new Error('Native candidate universe must remain full-market independent');
const legacyContribution = Number(selection?.summary?.legacyScoringContributionPct ?? nativePolicy.legacyScoringContributionPct ?? 0);
if (legacyContribution !== 0) throw new Error('Native legacy scoring contribution must remain 0%');
const rankingContract = published[0]?.rankingTieBreaker?.contract || selection?.rankingDiscrimination?.contract || nativePolicy?.rankingDiscrimination?.contract || 'V20_SAFETY_STRENGTH_LEXICOGRAPHIC_TIE_BREAK_V2';
if (rankingContract !== 'V20_SAFETY_STRENGTH_LEXICOGRAPHIC_TIE_BREAK_V2') throw new Error(`Native ranking contract drift: ${rankingContract}`);
const roundTripTransactionCostPct = Number(nativePolicy?.tradePlan?.roundTripTransactionCostPct ?? 0.6);
if (roundTripTransactionCostPct !== 0.6) throw new Error(`Native transaction-cost policy drift: ${roundTripTransactionCostPct}`);

const rows = published.map((row, index) => {
  const entryLow = numberOrNull(row.entryLow ?? row.tradePlan?.entryLow);
  const entryHigh = numberOrNull(row.entryHigh ?? row.tradePlan?.entryHigh);
  const stop = numberOrNull(row.stop ?? row.tradePlan?.stop);
  const target1 = numberOrNull(row.target1 ?? row.tradePlan?.target1);
  const target2 = numberOrNull(row.target2 ?? row.tradePlan?.target2);
  const alignmentState = row.alignmentState ?? row.tradePlan?.alignmentState ?? null;
  const entryDistancePct = numberOrNull(row.entryDistancePct ?? row.tradePlan?.entryDistancePct);
  const netRiskReward = numberOrNull(row.netRiskReward);
  if (!(netRiskReward >= Number(nativePolicy.minimumNetRiskReward ?? 0.7))) throw new Error(`Published Native candidate ${row.ticker || row.symbol} is below minimum Net R/R`);
  return {
    rank: Number(row.rank || index + 1),
    ticker: String(row.ticker || row.symbol || '').toUpperCase(),
    nameAr: row.nameAr ?? null,
    nameEn: row.nameEn ?? null,
    sessionDate: current.sessionDate,
    price: numberOrNull(row.price),
    nativeResearchScore: Number(row.nativeResearchScore),
    nativeResearchTier: row.nativeResearchTier ?? null,
    discoveryScore: numberOrNull(row.discoveryScore),
    liquidity2Score: numberOrNull(row.liquidity2Score),
    srConfluenceScore: numberOrNull(row.srConfluenceScore),
    srMethodCount: numberOrNull(row.srMethodCount),
    technicalScore: numberOrNull(row.technicalScore),
    netRiskReward,
    // Flat issued-plan fields are canonical compatibility fields for immutable forward evaluation.
    entryLow,
    entryHigh,
    stop,
    target1,
    target2,
    alignmentState,
    entryDistancePct,
    tradePlan: {
      entryLow,
      entryHigh,
      stop,
      target1,
      target2,
      alignmentState,
      entryDistancePct,
      roundTripTransactionCostPct
    },
    rankingTieBreaker: row.rankingTieBreaker || null,
    wasInLegacySeedUniverse: row.wasInLegacySeedUniverse === true,
    baselineResearchRank: numberOrNull(row.baselineResearchRank),
    researchOnly: true,
    grantsExecutionPermission: false,
    grantsProductionAllocation: false
  };
});

for (let i = 1; i < rows.length; i += 1) {
  if (rows[i - 1].nativeResearchScore < rows[i].nativeResearchScore) throw new Error(`Native score ordering drift at ${rows[i - 1].ticker}/${rows[i].ticker}`);
}
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
  candidateUniverseIsFullMarketIndependent: true,
  legacySeedDependency: false,
  legacyScoringContributionPct: 0,
  executionPermission: false,
  productionAllocation: false,
  automaticPromotion: false,
  rankingContract,
  rankingDiscrimination: {
    contract: rankingContract,
    appliesOnlyOnExactScoreTie: true,
    mutatesNativeResearchScore: false,
    canOverrideHigherNativeResearchScore: false
  },
  summary: {...(selection.summary || {}), publishedResearchCandidateCount: rows.length, legacyScoringContributionPct: 0},
  rankingDigest,
  publishedCandidates: rows,
  source: {
    selectionArtifact: 'data/v20/full-market-native-selection.json',
    policyArtifact: 'data/v20/decision-intelligence-policy.json',
    rankingFinalizer: 'scripts/v20/finalize-native-ranking-v1.cjs',
    regressionOwnsRanking: false
  }
};

writeAtomic('data/v20/native-current.json', out);
console.log(JSON.stringify({ok: true, sessionDate: out.sessionDate, engineId, published: rows.length, rankingDigest, legacyScoringContributionPct: 0, rankingContract, executionPermission: false}, null, 2));
