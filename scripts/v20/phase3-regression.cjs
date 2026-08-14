#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const finite = value => Number.isFinite(Number(value)) ? Number(value) : null;
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const current = read('data/v20/current.json');
const audit = read('data/v20/risk-reward-audit.json');
const profiles = read('data/v20/stock-profiles.json');
const archiveIndex = read('data/v20/signal-archive/index.json');
const forward = read('data/v20/forward-evaluation.json');

const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

check(current.riskRewardPolicy?.primaryMetric === 'CONSERVATIVE_NET_RR_AFTER_ROUND_TRIP_COSTS', 'PRIMARY_RR_POLICY_NOT_NET_COST_AWARE');
check(audit.primaryMetric === 'CONSERVATIVE_NET_RR_AFTER_ROUND_TRIP_COSTS', 'AUDIT_PRIMARY_RR_POLICY_DRIFT');
check(audit.legacyMetricPolicy === 'AUDIT_ONLY_REFERENCE_UNVERIFIED', 'LEGACY_RR_NOT_AUDIT_ONLY');
check(audit.methodology?.exactLegacyFormulaClaimed === false, 'UNVERIFIED_LEGACY_RR_FORMULA_CLAIMED');
check(profiles.profileCount === (current.opportunities || []).length, 'PROFILE_COUNT_MISMATCH');
check(profiles.technicalIndicatorPolicy === 'POINT_IN_TIME_TRUSTED_OHLC_ONLY_STALE_CONTEXT_NEVER_CURRENT_DECISION', 'TECHNICAL_INDICATOR_POLICY_DRIFT');

for (const row of current.opportunities || []) {
  const rr = row.riskReward || {};
  const t1Net = finite(row.tradePlan?.target1Metrics?.netRiskReward);
  const primary = finite(rr.primaryTarget1NetRiskReward);
  check(rr.primaryMetric === 'CONSERVATIVE_NET_RR_AFTER_ROUND_TRIP_COSTS', `PRIMARY_RR_NOT_CONSERVATIVE_NET_${row.ticker}`);
  check(rr.legacyIsPrimary === false, `LEGACY_RR_PRIMARY_${row.ticker}`);
  check(primary === t1Net, `PRIMARY_NET_RR_MISMATCH_${row.ticker}`);
  if (finite(rr.legacyRiskReward) !== null) check(rr.legacyReference === 'UNVERIFIED_PRICE_REFERENCE', `LEGACY_REFERENCE_NOT_UNVERIFIED_${row.ticker}`);
  if (rr.materialMismatch === true) check((rr.auditReasons || []).includes('LEGACY_RR_MATERIAL_MISMATCH_VS_CONSERVATIVE_ENTRY_HIGH_REFERENCE'), `MISMATCH_NOT_EXPLICIT_${row.ticker}`);
}

for (const profile of profiles.profiles || []) {
  check(profile.opportunity?.scoreIsConfidence === false, `SCORE_CONFIDENCE_MIXED_${profile.ticker}`);
  check(profile.confidence?.dimensionsAreIndependent === true, `CONFIDENCE_DIMENSIONS_MIXED_${profile.ticker}`);
  check(['CURRENT_POINT_IN_TIME_READY','HISTORICAL_CONTEXT_ONLY','INSUFFICIENT_TRUSTED_HISTORY','UNAVAILABLE'].includes(profile.technicalAnalysis?.status), `TECHNICAL_STATUS_UNEXPECTED_${profile.ticker}`);
  if (profile.technicalAnalysis?.usedForCurrentDecision === true) {
    check(profile.technicalAnalysis?.currentTechnicalReady === true, `UNREADY_TECHNICAL_USED_FOR_CURRENT_DECISION_${profile.ticker}`);
    check(profile.technicalAnalysis?.asOfSession === current.sessionDate, `TECHNICAL_ASOF_SESSION_MISMATCH_${profile.ticker}`);
    check(profile.whyThisStock?.technicalEvidenceUsed === true, `TECHNICAL_USAGE_NOT_DISCLOSED_${profile.ticker}`);
  } else {
    check(profile.whyThisStock?.technicalEvidenceUsed !== true, `STALE_TECHNICAL_STRENGTH_LEAK_${profile.ticker}`);
    check(!(profile.whyThisStock?.strengths || []).some(x => String(x).startsWith('CURRENT_TRUSTED_TECHNICAL_') || String(x).startsWith('CURRENT_RSI_')), `STALE_TECHNICAL_STRENGTH_${profile.ticker}`);
  }
  check(profile.sectorContext?.sector === null, `UNVERIFIED_SECTOR_INFERRED_${profile.ticker}`);
}

const immutableCore = {
  schemaVersion: '20.0.0-immutable-signal-core-1',
  sessionDate: current.sessionDate,
  activeChampion: current.governance?.activeChampion || null,
  executionStatus: current.executionStatus,
  decisionSupportOnly: current.decisionSupportOnly === true,
  portfolio: {
    riskState: current.portfolio?.riskState || null,
    recommendedExposurePct: finite(current.portfolio?.recommendedExposurePct) || 0,
    cashPct: finite(current.portfolio?.cashPct) || 100,
  },
  opportunities: (current.opportunities || []).map(row => ({
    ticker: row.ticker,
    status: row.status,
    entryLow: finite(row.tradePlan?.entryLow),
    entryHigh: finite(row.tradePlan?.entryHigh),
    stop: finite(row.tradePlan?.stop),
    target1: finite(row.tradePlan?.target1),
    target2: finite(row.tradePlan?.target2),
    positionWeightPct: finite(row.suggestedPositionWeightPct) || 0,
  })),
};
const expectedHash = sha(immutableCore);
const archiveEntry = (archiveIndex.entries || []).find(entry => entry.immutableSignalHash === expectedHash);
check(Boolean(archiveEntry), 'CURRENT_SIGNAL_NOT_ARCHIVED');
if (archiveEntry) {
  const archived = read(archiveEntry.file);
  check(archived.immutableSignalHash === expectedHash, 'ARCHIVE_HASH_MISMATCH');
  check(JSON.stringify(archived.immutableCore) === JSON.stringify(immutableCore), 'ARCHIVE_CORE_MISMATCH');
}

check(forward.schemaVersion === '20.0.0-forward-evaluation-3', 'FORWARD_AUTHORITATIVE_SCHEMA_NOT_V3');
check(forward.asOfSessionDate === current.sessionDate, 'FORWARD_AUTHORITATIVE_ASOF_MISMATCH');
check(forward.authoritativeEvidence?.file === 'data/v20/forward-evaluation.json', 'FORWARD_AUTHORITATIVE_FILE_NOT_DECLARED');
check(forward.authoritativeEvidence?.selfContainedStatus === true, 'FORWARD_EMBEDDED_STATUS_NOT_REQUIRED');
check(forward.authoritativeEvidence?.selfContainedRegression === true, 'FORWARD_EMBEDDED_REGRESSION_NOT_REQUIRED');
check(forward.authoritativeEvidence?.derivedSidecarsAreAuthoritative === false, 'FORWARD_SIDECARS_MISTAKENLY_AUTHORITATIVE');
check(forward.resolutionStatus?.schemaVersion === '20.0.0-forward-resolution-status-2', 'FORWARD_EMBEDDED_STATUS_MISSING');
check(forward.resolutionStatus?.asOfSessionDate === forward.asOfSessionDate, 'FORWARD_STATUS_ASOF_MISMATCH');
check(forward.evaluationRegression?.schemaVersion === '20.0.0-forward-evaluation-regression-2', 'FORWARD_EMBEDDED_REGRESSION_MISSING');
check(forward.evaluationRegression?.ok === true, 'FORWARD_EMBEDDED_REGRESSION_FAILED');
check(forward.evaluationRegression?.authoritativeFile === 'data/v20/forward-evaluation.json', 'FORWARD_REGRESSION_AUTHORITY_DRIFT');
check(forward.evaluationRegression?.evidence?.fabricatedSameSessionResolutionCount === 0, 'FORWARD_SAME_SESSION_FABRICATION_DETECTED');

const evaluations = forward.evaluations || [];
check(forward.resolutionStatus?.evaluationCount === evaluations.length, 'FORWARD_STATUS_COUNT_MISMATCH');
check(forward.resolutionStatus?.resolvedCount === evaluations.filter(x => x.status === 'RESOLVED').length, 'FORWARD_STATUS_RESOLVED_MISMATCH');
check(forward.resolutionStatus?.pendingCount === evaluations.filter(x => x.status === 'PENDING').length, 'FORWARD_STATUS_PENDING_MISMATCH');
check(forward.evaluationRegression?.evidence?.evaluationCount === evaluations.length, 'FORWARD_REGRESSION_COUNT_MISMATCH');
check(forward.evaluationRegression?.evidence?.resolvedCount === evaluations.filter(x => x.status === 'RESOLVED').length, 'FORWARD_REGRESSION_RESOLVED_MISMATCH');
check(forward.evaluationRegression?.evidence?.pendingCount === evaluations.filter(x => x.status === 'PENDING').length, 'FORWARD_REGRESSION_PENDING_MISMATCH');

const currentForward = evaluations.filter(x => x.immutableSignalHash === expectedHash);
for (const horizon of [1, 3, 5, 10, 20]) {
  const item = currentForward.find(x => x.horizonSessions === horizon);
  check(Boolean(item), `MISSING_FORWARD_HORIZON_${horizon}`);
  if (item) {
    check(['PENDING', 'RESOLVED'].includes(item.status), `INVALID_FORWARD_STATUS_${horizon}`);
    if (item.status === 'PENDING') {
      check(item.evaluationSessionDate === null, `FABRICATED_PENDING_FORWARD_DATE_${horizon}`);
      check(item.portfolioReturnGrossPct === null && item.portfolioReturnNetPct === null, `FABRICATED_PENDING_FORWARD_RETURN_${horizon}`);
      check(item.appliedPortfolio?.grossReturnPct === null && item.appliedPortfolio?.netReturnPct === null, `FABRICATED_PENDING_APPLIED_RETURN_${horizon}`);
      check(item.researchEvaluation?.equalWeightIssuedGrossReturnPct === null && item.researchEvaluation?.equalWeightIssuedNetReturnPct === null, `FABRICATED_PENDING_RESEARCH_RETURN_${horizon}`);
    } else {
      check(item.researchEvaluation?.appliedToProduction === false, `RESEARCH_FORWARD_APPLIED_TO_PRODUCTION_${horizon}`);
      check(item.portfolioReturnNetPct === item.appliedPortfolio?.netReturnPct, `FORWARD_APPLIED_RETURN_SEMANTICS_DRIFT_${horizon}`);
    }
  }
}

const report = {
  schemaVersion: '20.0.0-phase3-regression-3',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  checks: {
    conservativeNetRiskRewardPrimary: true,
    legacyRiskRewardAuditOnly: true,
    technicalIndicatorsRequirePointInTimeTrust: true,
    staleTechnicalCannotDriveCurrentDecision: true,
    scoreConfidenceSeparated: true,
    immutableSignalArchive: true,
    forwardHorizonsSeparated: true,
    forwardEvidenceSelfContained: true,
    forwardDerivedSidecarsNonAuthoritative: true,
    forwardSameSessionFabricationBlocked: true,
    forwardResearchProductionSeparation: true,
  },
};

fs.writeFileSync(P('data/v20/phase3-regression.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
