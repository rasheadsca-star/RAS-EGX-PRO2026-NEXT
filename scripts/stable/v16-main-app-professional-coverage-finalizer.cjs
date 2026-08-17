#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = rel => path.join(ROOT, rel);
const PRICE = P('data/stable/v15-price-truth.json');
const DISPOSITION = P('data/stable/v16-market-universe-disposition.json');
const READINESS = P('data/stable/v16-main-app-professional-readiness.json');

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function write(file, value) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
const round = (v, d = 1) => Number.isFinite(Number(v)) ? Number(Number(v).toFixed(d)) : null;
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

function main() {
  const price = read(PRICE);
  const disposition = read(DISPOSITION);
  const readiness = read(READINESS);
  const pc = price.professionalCoverage || {};
  const ds = disposition.summary || {};

  if (pc.complete !== true || ds.professionalDataCoverageComplete !== true || disposition.expectedSession !== price.expectedSession) {
    console.log(JSON.stringify({ status: 'NO_FINALIZATION', reason: 'CURRENT_SESSION_PROFESSIONAL_COVERAGE_NOT_READY', priceSession: price.expectedSession || null, dispositionSession: disposition.expectedSession || null }, null, 2));
    return;
  }
  if (Number(pc.executionEligibleCoveragePct) !== 100 || Number(pc.universeDispositionCoveragePct) !== 100) {
    throw new Error('Professional coverage claims 100% are not supported by disposition evidence');
  }
  if (Number(pc.verifiedDispositionRows) !== Number(pc.rawUniverseRows)) throw new Error('Verified disposition rows do not cover the raw universe');
  if (Number(pc.executionEligibleAcceptedRows) !== Number(pc.executionEligibleUniverseRows)) throw new Error('Execution-eligible universe is not fully price-covered');

  const data = (readiness.axes || []).find(a => a.id === 'DATA_SESSION_INTEGRITY');
  if (!data) throw new Error('Readiness data axis missing');
  if (data.details?.currentExecutionGrade !== true || readiness.hardGates?.dataAndSessionIntegrity !== true) {
    throw new Error('Cannot finalize professional coverage while data hard gate is not passing');
  }

  data.points = 25;
  data.scorePct = 100;
  data.details = {
    ...(data.details || {}),
    rawCurrentSourceSessionEvidenceCoveragePct: round(pc.rawSessionEvidenceCoveragePct, 1),
    rawCurrentSessionEvidenceRows: Number(pc.rawSessionEvidenceRows || 0),
    currentSourceSessionEvidenceCoveragePct: round(pc.rawSessionEvidenceCoveragePct, 1),
    professionalExecutionEligibleCoveragePct: 100,
    professionalUniverseDispositionCoveragePct: 100,
    executionEligibleUniverseRows: Number(pc.executionEligibleUniverseRows || 0),
    executionEligibleAcceptedRows: Number(pc.executionEligibleAcceptedRows || 0),
    verifiedIneligibleRows: Number(pc.verifiedIneligibleRows || 0),
    verifiedIneligibleTickers: pc.verifiedIneligibleTickers || [],
    verifiedDispositionRows: Number(pc.verifiedDispositionRows || 0),
    verifiedRows: Number(pc.verifiedDispositionRows || 0),
    evidenceCoveragePct: 100,
    verifiedRowsRatioPct: 100,
    professionalCoverageComplete: true,
    rawCoverageDiagnosticRetained: true,
  };
  data.requirements = (data.requirements || []).filter(r => !['SOURCE_EVIDENCE_100', 'VERIFIED_ROWS_100'].includes(r.code));

  readiness.softGaps = (readiness.softGaps || []).filter(r => !['SOURCE_EVIDENCE_100', 'VERIFIED_ROWS_100'].includes(r.code));
  readiness.requirementsTo100 = (readiness.requirementsTo100 || []).filter(r => !['SOURCE_EVIDENCE_100', 'VERIFIED_ROWS_100'].includes(r.code));
  readiness.foundationQualityScore = round((readiness.axes || []).reduce((sum, axis) => sum + Number(axis.points || 0), 0), 1);
  if (readiness.hardGates?.liveForwardMinimum !== true) {
    readiness.professionalReadinessScore = Math.min(Number(readiness.professionalReadinessScore || 0), 79);
    readiness.capReason = 'LIVE_FORWARD_HARD_GATE';
    readiness.professionalClaimAllowed = false;
  }
  readiness.evidence = {
    ...(readiness.evidence || {}),
    marketUniverseDispositionGeneratedAt: disposition.generatedAt || null,
    professionalCoverageGeneratedAt: pc.generatedAt || null,
    rawMarketSessionEvidenceCoveragePct: round(pc.rawSessionEvidenceCoveragePct, 1),
    professionalExecutionEligibleCoveragePct: 100,
    professionalUniverseDispositionCoveragePct: 100,
  };
  readiness.interpretation = {
    ...(readiness.interpretation || {}),
    professionalCoverageMeaningAr: 'تغطية 100% المهنية تعني أن كل سهم صالح للتنفيذ لديه سعر جلسة موثق، وكل صف غير صالح للتنفيذ لديه سبب عزل موثق؛ ولا تعني اختلاق سعر جلسة لصف لم يتداول أو لم تتوفر له أدلة جلسة.',
  };
  readiness.readinessHash = sha({
    engine: readiness.engine,
    sessionDate: readiness.sessionDate,
    professionalReadinessScore: readiness.professionalReadinessScore,
    foundationQualityScore: readiness.foundationQualityScore,
    axes: readiness.axes,
    hardGates: readiness.hardGates,
    hardBlockers: readiness.hardBlockers,
    softGaps: readiness.softGaps,
    professionalCoverage: pc,
  });
  write(READINESS, readiness);
  console.log(JSON.stringify({
    status: 'FINALIZED',
    professionalReadinessScore: readiness.professionalReadinessScore,
    foundationQualityScore: readiness.foundationQualityScore,
    dataAxisScorePct: data.scorePct,
    rawMarketSessionEvidenceCoveragePct: pc.rawSessionEvidenceCoveragePct,
    executionEligibleCoveragePct: pc.executionEligibleCoveragePct,
    universeDispositionCoveragePct: pc.universeDispositionCoveragePct,
    verifiedDispositionRows: pc.verifiedDispositionRows,
    rawUniverseRows: pc.rawUniverseRows,
    remainingSoftGaps: readiness.softGaps,
    remainingHardBlockers: readiness.hardBlockers,
  }, null, 2));
}

main();
