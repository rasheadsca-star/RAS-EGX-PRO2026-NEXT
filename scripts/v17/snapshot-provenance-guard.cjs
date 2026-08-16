#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const finite = value => Number.isFinite(Number(value));

const snapshot = read('data/v17/current.json');
const decision = read('data/today-decision-center.json');
const liquidity = read('data/v17/liquidity-gate.json');
const resilient = read('data/v17/resilient-session-status.json');

if (snapshot.sessionDate !== decision.sessionDate || snapshot.sessionDate !== liquidity.referenceSessionDate) {
  throw new Error('Snapshot provenance sessions are not aligned.');
}
if (snapshot?.enrichment?.immutableSignalHashTouched !== false || snapshot?.enrichment?.scope !== 'DISPLAY_AND_PROVENANCE_ONLY') {
  throw new Error('Snapshot enrichment must remain outside Immutable Signal Hash.');
}
if (snapshot?.currentResearch?.liquidity?.provenance !== 'data/v17/liquidity-gate.json') {
  throw new Error('Snapshot currentResearch does not expose canonical liquidity provenance.');
}
if (snapshot?.currentResearch?.liquidity?.gatePassed !== liquidity.gatePassed) {
  throw new Error('Snapshot liquidity gate differs from canonical liquidity gate.');
}
if (Number(snapshot?.currentResearch?.liquidity?.candidateExecutionOkCount) !== Number(liquidity.candidateExecutionOkCount)) {
  throw new Error('Snapshot liquidity execution count differs from canonical liquidity gate.');
}
if (Math.abs(Number(snapshot?.currentResearch?.liquidity?.candidateEvidenceCoveragePct) - Number(liquidity.candidateEvidenceCoveragePct)) > 0.001) {
  throw new Error('Snapshot liquidity evidence coverage differs from canonical liquidity gate.');
}
if (snapshot?.systemHealth?.liquidityGatePassed !== (resilient?.executionInputs?.liquidityGatePassed === true)) {
  throw new Error('Snapshot systemHealth liquidity state differs from resilient gate.');
}

const decisionMap = new Map((decision.rankedOpportunities || []).map(row => [String(row.symbol || '').toUpperCase(), row]));
const recommendations = Array.isArray(snapshot.recommendations) ? snapshot.recommendations : [];
if (snapshot.recommendationMode === 'CURRENT_RESEARCH_WATCH_ONLY') {
  if (!recommendations.length) throw new Error('Research snapshot has no recommendations to validate.');
  for (const rec of recommendations) {
    const source = decisionMap.get(String(rec.ticker || '').toUpperCase());
    if (!source) throw new Error(`Missing decision provenance for ${rec.ticker}`);
    if (!rec.liquidity || !rec.supportResistanceEvidence || !rec.executionProvenance) {
      throw new Error(`Missing research provenance for ${rec.ticker}`);
    }
    if (rec.executionAllowed === true || Number(rec.portfolioWeightPct || 0) !== 0) {
      throw new Error(`Research recommendation ${rec.ticker} unexpectedly executable/allocated.`);
    }

    const sourceLiquidityAvailable = Boolean(source?.liquidity && typeof source.liquidity === 'object');
    if (!sourceLiquidityAvailable) {
      if (rec.liquidity.evidenceState !== 'MISSING_RESEARCH_ONLY' || rec.liquidity.executionLiquidityOk !== false || rec.liquidity.evidenceAvailable !== false) {
        throw new Error(`Missing liquidity evidence was not preserved fail-closed for ${rec.ticker}`);
      }
    } else {
      if (rec.liquidity.evidenceState !== 'AVAILABLE') throw new Error(`Available liquidity evidence mislabeled for ${rec.ticker}`);
      if (rec.liquidity.executionLiquidityOk !== (source.liquidity.executionLiquidityOk === true)) {
        throw new Error(`Liquidity eligibility mismatch for ${rec.ticker}`);
      }
      if (finite(source?.liquidity?.score) && Number(rec.liquidity.score) !== Number(source.liquidity.score)) {
        throw new Error(`Liquidity score mismatch for ${rec.ticker}`);
      }
    }

    const sourceSrAvailable = Boolean(source?.supportResistance && typeof source.supportResistance === 'object');
    if (!sourceSrAvailable) {
      if (rec.supportResistanceEvidence.evidenceState !== 'MISSING_RESEARCH_ONLY'
        || rec.supportResistanceEvidence.sessionDate !== null
        || rec.supportResistanceEvidence.executionEligible !== false) {
        throw new Error(`Missing S/R evidence was not preserved fail-closed for ${rec.ticker}`);
      }
    } else {
      if (rec.supportResistanceEvidence.evidenceState !== 'AVAILABLE') throw new Error(`Available S/R evidence mislabeled for ${rec.ticker}`);
      if (rec.supportResistanceEvidence.sessionDate !== source.supportResistance.sessionDate) {
        throw new Error(`S/R session provenance mismatch for ${rec.ticker}`);
      }
      if (rec.supportResistanceEvidence.executionEligible !== (source.supportResistance.executionEligible === true)) {
        throw new Error(`S/R execution eligibility mismatch for ${rec.ticker}`);
      }
    }

    if (rec.executionProvenance.executionAllowed !== false) {
      throw new Error(`Research execution provenance is unsafe for ${rec.ticker}`);
    }
    if ((!sourceSrAvailable || !sourceLiquidityAvailable) && rec.executionProvenance.missingResearchEvidenceExplicitlyPreserved !== true) {
      throw new Error(`Missing research evidence is not explicitly disclosed for ${rec.ticker}`);
    }
  }
}

if (resilient.executionGrade !== true) {
  if (snapshot?.systemHealth?.executionGrade !== false) throw new Error('Snapshot claims execution grade while resilient gate does not.');
  if (Number(snapshot?.portfolioPolicy?.plannedAllocationPct || 0) !== 0) throw new Error('Non-execution snapshot has portfolio allocation.');
}

console.log(JSON.stringify({
  ok: true,
  sessionDate: snapshot.sessionDate,
  recommendationMode: snapshot.recommendationMode,
  checkedRecommendations: recommendations.length,
  liquidityGatePassed: liquidity.gatePassed,
  liquidityEvidenceCoveragePct: liquidity.candidateEvidenceCoveragePct,
  liquidityExecutionOkCount: liquidity.candidateExecutionOkCount,
  executionGrade: resilient.executionGrade,
  immutableSignalHashTouched: snapshot.enrichment.immutableSignalHashTouched,
  missingEvidencePolicy: snapshot.enrichment.missingEvidencePolicy || null,
}, null, 2));
