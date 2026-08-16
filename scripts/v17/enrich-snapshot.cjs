#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);

function read(rel, fallback = null) {
  try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); }
  catch (error) {
    if (fallback !== null) return fallback;
    throw new Error(`Cannot read ${rel}: ${error.message}`);
  }
}
function writeAtomic(rel, value) {
  const file = P(rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function finite(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function sym(value) {
  return String(value || '').trim().toUpperCase().replace(/\.CA$/, '').replace(/[^A-Z0-9.]/g, '');
}
function compactLiquidity(value) {
  if (!value || typeof value !== 'object') return {
    evidenceState: 'MISSING_RESEARCH_ONLY',
    candidate: false,
    decision: 'MISSING_EVIDENCE',
    score: null,
    currentTurnover: null,
    avg20Turnover: null,
    currentVolume: null,
    historicalSessionsUsed: 0,
    evidenceAvailable: false,
    executionLiquidityOk: false,
    conditionalLiquidityOk: false,
    provenance: null,
  };
  return {
    evidenceState: 'AVAILABLE',
    candidate: value.candidate === true,
    decision: value.decision || null,
    score: finite(value.score),
    currentTurnover: finite(value.currentTurnover),
    avg20Turnover: finite(value.avg20Turnover),
    currentVolume: finite(value.currentVolume),
    historicalSessionsUsed: finite(value.historicalSessionsUsed, 0),
    evidenceAvailable: value.evidenceAvailable === true,
    executionLiquidityOk: value.executionLiquidityOk === true,
    conditionalLiquidityOk: value.conditionalLiquidityOk === true,
    provenance: value.provenance || null,
  };
}
function compactSr(value) {
  if (!value || typeof value !== 'object') return {
    evidenceState: 'MISSING_RESEARCH_ONLY',
    source: null,
    sessionDate: null,
    researchSessionDate: null,
    freshness: 'MISSING',
    confidence: null,
    methodology: null,
    provenance: null,
    externalValidation: null,
    executionEligible: false,
  };
  return {
    evidenceState: 'AVAILABLE',
    source: value.source || null,
    sessionDate: value.sessionDate || null,
    researchSessionDate: value.researchSessionDate || null,
    freshness: value.freshness || null,
    confidence: finite(value.confidence),
    methodology: value.methodology || null,
    provenance: value.provenance || null,
    externalValidation: value.externalValidation || null,
    executionEligible: value.executionEligible === true,
  };
}

const snapshot = read('data/v17/current.json');
const decision = read('data/today-decision-center.json');
const resilient = read('data/v17/resilient-session-status.json', {});
const liquidity = read('data/v17/liquidity-gate.json', {});

if (!snapshot?.sessionDate || snapshot.sessionDate !== decision?.sessionDate) {
  throw new Error(`Snapshot/decision session mismatch: ${snapshot?.sessionDate || 'missing'} vs ${decision?.sessionDate || 'missing'}`);
}

const rows = Array.isArray(decision.rankedOpportunities) ? decision.rankedOpportunities : [];
const bySymbol = new Map(rows.map(row => [sym(row.symbol), row]).filter(([symbol]) => symbol));
let enrichedRecommendations = 0;

if (snapshot.recommendationMode === 'CURRENT_RESEARCH_WATCH_ONLY') {
  for (const rec of Array.isArray(snapshot.recommendations) ? snapshot.recommendations : []) {
    const source = bySymbol.get(sym(rec.ticker));
    if (!source) continue;
    rec.liquidity = compactLiquidity(source.liquidity);
    rec.supportResistanceEvidence = compactSr(source.supportResistance);
    rec.executionProvenance = {
      sessionExecutionGrade: decision?.sessionTruth?.executionGrade === true,
      finalResilientStatus: decision?.sessionTruth?.resilientStatus || resilient.status || null,
      liquidityGatePassed: decision?.summary?.liquidityGatePassed === true,
      internalSrExecutionEligible: source?.supportResistance?.executionEligible === true,
      perSymbolLiquidityExecutionOk: source?.liquidity?.executionLiquidityOk === true,
      executionAllowed: source.executionAllowed === true,
      source: 'data/today-decision-center.json',
      missingResearchEvidenceExplicitlyPreserved: !source.supportResistance || !source.liquidity,
    };
    enrichedRecommendations += 1;
  }
}

snapshot.currentResearch = {
  ...(snapshot.currentResearch || {}),
  completedOhlcSession: decision?.sessionTruth?.completedOhlcSession || null,
  currentSessionCompletionConfirmed: decision?.sessionTruth?.currentSessionCompletionConfirmed === true,
  finalResilientStatus: decision?.sessionTruth?.resilientStatus || resilient.status || null,
  finalExecutionGrade: decision?.sessionTruth?.executionGrade === true,
  liquidity: {
    engine: liquidity.engine || decision?.liquidityPolicy?.engine || null,
    gatePassed: liquidity.gatePassed === true,
    sessionAligned: liquidity.sessionAligned === true,
    referenceSessionDate: liquidity.referenceSessionDate || null,
    candidateUniverseCount: finite(liquidity.candidateUniverseCount),
    candidateEvidenceCoveragePct: finite(liquidity.candidateEvidenceCoveragePct),
    candidateExecutionOkCount: finite(liquidity.candidateExecutionOkCount),
    candidateExecutionOkPct: finite(liquidity.candidateExecutionOkPct),
    thresholds: liquidity.thresholds || null,
    rulesSource: liquidity?.sourceLineage?.rulesSource || decision?.liquidityPolicy?.rulesSource || null,
    provenance: 'data/v17/liquidity-gate.json',
  },
};

snapshot.systemHealth = {
  ...(snapshot.systemHealth || {}),
  liquidity: resilient?.executionInputs?.liquidity || snapshot.currentResearch.liquidity,
  liquidityGatePassed: resilient?.executionInputs?.liquidityGatePassed === true,
  supportResistance: {
    coveragePct: finite(resilient.coveragePct),
    freshnessPct: finite(resilient.freshnessPct),
    criticalFieldsPct: finite(resilient.criticalFieldsPct),
    sourceConflictCount: Array.isArray(resilient.sourceConflicts) ? resilient.sourceConflicts.length : 0,
    missingSymbolCount: Array.isArray(resilient.missingSymbols) ? resilient.missingSymbols.length : 0,
    executionCandidateReady: resilient?.executionInputs?.internal?.executionCandidateReady === true,
  },
};

snapshot.lineage = {
  ...(snapshot.lineage || {}),
  liquidityGateSource: 'data/v17/liquidity-gate.json',
  currentResearchDecisionSource: 'data/today-decision-center.json',
};

snapshot.enrichment = {
  schemaVersion: '17.0.0-snapshot-enrichment-2',
  generatedAt: new Date().toISOString(),
  enrichedRecommendations,
  immutableSignalHashTouched: false,
  scope: 'DISPLAY_AND_PROVENANCE_ONLY',
  missingEvidencePolicy: 'EXPLICIT_RESEARCH_ONLY_NEVER_SYNTHESIZED',
};

writeAtomic('data/v17/current.json', snapshot);
console.log(JSON.stringify({
  sessionDate: snapshot.sessionDate,
  recommendationMode: snapshot.recommendationMode,
  enrichedRecommendations,
  liquidityGatePassed: snapshot.currentResearch.liquidity.gatePassed,
  liquidityEvidenceCoveragePct: snapshot.currentResearch.liquidity.candidateEvidenceCoveragePct,
  liquidityExecutionOkCount: snapshot.currentResearch.liquidity.candidateExecutionOkCount,
  immutableSignalHashTouched: false,
}, null, 2));
