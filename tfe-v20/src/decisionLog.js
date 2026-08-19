const COLUMNS = [
  'sessionDate','generatedAt','rank','ticker','decision','publicationState','price',
  'technicalScore','technicalReading','researchScore','fusionRankScore','fusionResearchWeight','fusionHistoricalWeight','liquidityScore','srScore',
  'entryLow','entryHigh','stop','target1','target2','structuralNetRR','alignmentState',
  'historicalTrades','historicalT1Pct','historicalWilsonLower95Pct','historicalSampleReliability','historicalAvgNetPct',
  'dataQuality','priceConflictPct','v17Status','sourceCommit'
];

function esc(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"','""')}"` : s;
}

export function buildDecisionLogRows(items, { sessionDate = null, generatedAt = new Date().toISOString(), sourceCommit = null } = {}) {
  return items.map((x, i) => ({
    sessionDate: sessionDate ?? x.sessionDate ?? null,
    generatedAt,
    rank: x.rank ?? i + 1,
    ticker: x.ticker,
    decision: x.decision,
    publicationState: x.publicationState ?? null,
    price: x.price,
    technicalScore: x.scores?.core,
    technicalReading: x.technical?.technicalReading ?? null,
    researchScore: x.scores?.research,
    fusionRankScore: x.scores?.fusionRank,
    fusionResearchWeight: x.fusionWeights?.research ?? null,
    fusionHistoricalWeight: x.fusionWeights?.historicalConfidence ?? null,
    liquidityScore: x.scores?.liquidity,
    srScore: x.scores?.supportResistance,
    entryLow: x.tradePlan?.entryLow,
    entryHigh: x.tradePlan?.entryHigh,
    stop: x.tradePlan?.stop,
    target1: x.tradePlan?.target1,
    target2: x.tradePlan?.target2,
    structuralNetRR: x.tradePlan?.structuralNetRR,
    alignmentState: x.tradePlan?.alignmentState,
    historicalTrades: x.historicalConfidence?.historicalTradeCount,
    historicalT1Pct: x.historicalConfidence?.target1HitRatePct,
    historicalWilsonLower95Pct: x.historicalConfidence?.confidenceWilsonLower95Pct,
    historicalSampleReliability: x.historicalConfidence?.sampleReliability,
    historicalAvgNetPct: x.historicalConfidence?.avgNetPct,
    dataQuality: x.quality?.state,
    priceConflictPct: x.quality?.conflictPct,
    v17Status: x.v17?.status ?? null,
    sourceCommit,
  }));
}

export function toDecisionLogCsv(rows) {
  return '\uFEFF' + [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => esc(r[c])).join(','))].join('\r\n') + '\r\n';
}
