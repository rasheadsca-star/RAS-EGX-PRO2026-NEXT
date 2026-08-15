#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const readJson = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const readText = rel => fs.readFileSync(P(rel), 'utf8');
const finite = value => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value); return Number.isFinite(n) ? n : null;
};
const requiredCount = (total, thresholdPct) => Math.ceil(Number(total) * Number(thresholdPct) / 100 - 1e-9);
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

const gate = readJson('data/v17/resilient-session-status.json');
const sr = readJson('data/v17/internal-ohlc-support-resistance.json');
const current = readJson('data/v20/current.json');
const healthHtml = readText('v20/health.html');
const healthGapJs = readText('v20/health-gap.js');

// V17 internal OHLC S/R schema v3 uses minimumCoveragePct / minimumFreshnessPct /
// minimumConfidence and levelSessionDate. Older aliases remain accepted only so
// this V20 diagnostic can read historical evidence without changing V17 itself.
const thresholds = sr.thresholds || {};
const total = Number(sr.candidateUniverseCount || 0);
const trusted = Number(sr.candidateTrustedCount || 0);
const fresh = Number(sr.candidateTrustedFreshCount || 0);
const coveragePct = finite(sr.candidateCoveragePct ?? sr.coveragePct ?? sr.researchCoveragePct);
const freshnessPct = finite(sr.candidateFreshnessPct ?? sr.freshnessPct ?? sr.researchFreshnessPct);
const criticalFieldsPct = finite(sr.criticalFieldsPct ?? coveragePct);
const averageFreshConfidence = finite(sr.averageFreshConfidence);
const referenceSessionDate = sr.referenceSessionDate || null;
const sourceSessionDate = sr.sourceSessionDate || sr.levelSessionDate || referenceSessionDate;
const coverageThreshold = Number(thresholds.minimumCandidateCoveragePct ?? thresholds.minimumCoveragePct ?? 95);
const freshnessThreshold = Number(thresholds.minimumCandidateFreshnessPct ?? thresholds.minimumFreshnessPct ?? 98);
const criticalThreshold = Number(thresholds.minimumCandidateCriticalFieldsPct ?? 95);
const confidenceThreshold = Number(thresholds.minimumAverageFreshConfidence ?? thresholds.minimumConfidence ?? 0.8);
const requiredTrusted = requiredCount(total, coverageThreshold);
const requiredFresh = requiredCount(total, freshnessThreshold);
const requiredCritical = requiredCount(total, criticalThreshold);
const criticalCurrentEquivalent = Math.round(total * Number(criticalFieldsPct || 0) / 100);
const trustedGap = Math.max(0, requiredTrusted - trusted);
const freshGap = Math.max(0, requiredFresh - fresh);
const criticalGap = Math.max(0, requiredCritical - criticalCurrentEquivalent);
const conflicts = Array.isArray(sr.sourceConflicts) ? sr.sourceConflicts : [];
const missing = Array.isArray(sr.missingCandidateSymbols)
  ? sr.missingCandidateSymbols
  : Array.isArray(sr.missingSymbols) ? sr.missingSymbols : [];
const candidateSet = new Set((sr.candidateSymbols || []).map(String));
const staleTrusted = (sr.rows || [])
  .filter(row => candidateSet.has(String(row.symbol || row.ticker))
    && row.provenance?.trustedForExecution === true
    && String(row.sessionDate || row.levelSessionDate || '') !== String(sr.levelSessionDate || referenceSessionDate || ''))
  .map(row => row.symbol || row.ticker)
  .filter(Boolean);
const referenceAligned = referenceSessionDate === sourceSessionDate;

// Exact executionCandidateReady formula from scripts/v17/build-internal-ohlc-sr.cjs.
const expectedExecutionCandidateReady = sr.sourceSessionVerified === true
  && sr.sessionCompletionConfirmed === true
  && Boolean(referenceSessionDate)
  && referenceAligned
  && Number(coveragePct || 0) >= coverageThreshold
  && Number(freshnessPct || 0) >= freshnessThreshold
  && Number(averageFreshConfidence || 0) >= confidenceThreshold
  && conflicts.length === 0;

check(gate.priceTruth?.verifiedSessionDate === current.sessionDate, 'GAP_GATE_SESSION_NOT_CURRENT');
check(referenceSessionDate === current.sessionDate, 'GAP_SR_REFERENCE_SESSION_NOT_CURRENT');
check(sourceSessionDate === current.sessionDate, 'GAP_SR_SOURCE_SESSION_NOT_CURRENT');
check(finite(gate.executionInputs?.internal?.coveragePct) === coveragePct, 'GAP_COVERAGE_GATE_SR_MISMATCH');
check(finite(gate.executionInputs?.internal?.freshnessPct) === freshnessPct, 'GAP_FRESHNESS_GATE_SR_MISMATCH');
check(finite(gate.executionInputs?.internal?.criticalFieldsPct) === criticalFieldsPct, 'GAP_CRITICAL_GATE_SR_MISMATCH');
check(finite(gate.executionInputs?.internal?.averageFreshConfidence) === averageFreshConfidence, 'GAP_CONFIDENCE_GATE_SR_MISMATCH');
check(gate.executionInputs?.internal?.executionCandidateReady === (sr.executionCandidateReady === true), 'GAP_EXECUTION_CANDIDATE_GATE_SR_MISMATCH');
check(expectedExecutionCandidateReady === (sr.executionCandidateReady === true), 'GAP_EXECUTION_CANDIDATE_FORMULA_MISMATCH');
check(coverageThreshold === 95, 'GAP_COVERAGE_THRESHOLD_DRIFT');
check(freshnessThreshold === 98, 'GAP_FRESHNESS_THRESHOLD_DRIFT');
check(criticalThreshold === 95, 'GAP_CRITICAL_THRESHOLD_DRIFT');
check(confidenceThreshold === 0.8, 'GAP_CONFIDENCE_THRESHOLD_DRIFT');
check(requiredTrusted <= total && requiredFresh <= total && requiredCritical <= total, 'GAP_REQUIRED_COUNT_INVALID');
check(new Set(missing).size === missing.length, 'GAP_DUPLICATE_MISSING_SYMBOL');
check(new Set(staleTrusted).size === staleTrusted.length, 'GAP_DUPLICATE_STALE_TRUSTED_SYMBOL');
check([...missing].sort().join('|') === [...(gate.missingSymbols || [])].sort().join('|'), 'GAP_MISSING_SYMBOLS_GATE_SR_MISMATCH');

if (trustedGap > 0) check((gate.reasons || []).includes('INTERNAL_SR_COVERAGE_BELOW_95'), 'GAP_COVERAGE_REASON_MISSING');
if (freshGap > 0) check((gate.reasons || []).includes('INTERNAL_SR_FRESHNESS_BELOW_98'), 'GAP_FRESHNESS_REASON_MISSING');
if (criticalGap > 0) check((gate.reasons || []).includes('CRITICAL_FIELDS_BELOW_95'), 'GAP_CRITICAL_REASON_MISSING');
if (conflicts.length > 0) check((gate.reasons || []).includes('CRITICAL_SOURCE_CONFLICT'), 'GAP_CONFLICT_REASON_MISSING');
if (sr.executionCandidateReady !== true) check((gate.reasons || []).includes('INTERNAL_SR_NOT_EXECUTION_CANDIDATE'), 'GAP_INTERNAL_READY_REASON_MISSING');

check(healthHtml.includes('src="./health-gap.js"'), 'GAP_HEALTH_SCRIPT_NOT_LOADED');
check(healthGapJs.includes("loadJson('../data/v17/resilient-session-status.json')"), 'GAP_UI_V17_GATE_NOT_WIRED');
check(healthGapJs.includes("loadJson('../data/v17/internal-ohlc-support-resistance.json')"), 'GAP_UI_INTERNAL_SR_NOT_WIRED');
check(healthGapJs.includes("section.id = 'executionGapPanel'"), 'GAP_UI_PANEL_NOT_DEFINED');
check(healthGapJs.includes('Derived read-only gap'), 'GAP_UI_READ_ONLY_DISCLOSURE_MISSING');
check(!/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i.test(healthGapJs), 'GAP_UI_WRITE_METHOD_DETECTED');
check(!healthGapJs.includes('localStorage.setItem'), 'GAP_UI_LOCAL_MUTATION_DETECTED');
try { new Function(healthGapJs); } catch { failures.push('GAP_UI_JS_SYNTAX_INVALID'); }

const report = {
  schemaVersion: '20.0.0-execution-gap-regression-2',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  sessionDate: current.sessionDate,
  sourceSchemaVersion: sr.schemaVersion || null,
  thresholds: {
    minimumCandidateCoveragePct: coverageThreshold,
    minimumCandidateFreshnessPct: freshnessThreshold,
    minimumCandidateCriticalFieldsPct: criticalThreshold,
    minimumAverageFreshConfidence: confidenceThreshold,
    zeroSourceConflictsRequired: true
  },
  current: {
    candidateUniverseCount: total,
    candidateTrustedCount: trusted,
    candidateTrustedFreshCount: fresh,
    coveragePct,
    freshnessPct,
    criticalFieldsPct,
    averageFreshConfidence,
    sourceConflictCount: conflicts.length,
    executionCandidateReady: sr.executionCandidateReady === true
  },
  required: {
    trustedCandidateCount: requiredTrusted,
    trustedFreshCandidateCount: requiredFresh,
    criticalCandidateEquivalentCount: requiredCritical,
    sourceConflictCount: 0
  },
  gaps: {
    trustedCandidateCount: trustedGap,
    trustedFreshCandidateCount: freshGap,
    criticalCandidateEquivalentCount: criticalGap,
    sourceConflictCount: conflicts.length,
    confidenceGap: Math.max(0, confidenceThreshold - Number(averageFreshConfidence || 0))
  },
  symbols: {
    missingCandidateSymbols: missing,
    staleTrustedCandidateSymbols: staleTrusted,
    conflictSymbols: conflicts.map(x => x.symbol).filter(Boolean)
  },
  interpretation: {
    mathematicalThresholdGapOnly: true,
    guaranteesExecutionGrade: false,
    requiresFullV17GateRebuildAfterEvidenceChanges: true,
    note: 'Closing the numeric gaps and current conflicts is necessary but not represented as sufficient until the authoritative V17 gate is recomputed with the new evidence.'
  },
  checks: {
    gateAndInternalSrSessionAligned: referenceSessionDate === current.sessionDate && sourceSessionDate === current.sessionDate,
    gateAndInternalSrMetricsConsistent:
      finite(gate.executionInputs?.internal?.coveragePct) === coveragePct
      && finite(gate.executionInputs?.internal?.freshnessPct) === freshnessPct
      && finite(gate.executionInputs?.internal?.criticalFieldsPct) === criticalFieldsPct
      && finite(gate.executionInputs?.internal?.averageFreshConfidence) === averageFreshConfidence,
    executionCandidateFormulaRecomputed: expectedExecutionCandidateReady === (sr.executionCandidateReady === true),
    officialThresholdsReadFromInternalSr: coverageThreshold === 95 && freshnessThreshold === 98 && confidenceThreshold === 0.8,
    missingSymbolsMatchGate: [...missing].sort().join('|') === [...(gate.missingSymbols || [])].sort().join('|'),
    healthGapUiReadOnly: !/method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i.test(healthGapJs) && !healthGapJs.includes('localStorage.setItem'),
    healthGapUiReadsAuthoritativeSources: healthGapJs.includes("loadJson('../data/v17/resilient-session-status.json')") && healthGapJs.includes("loadJson('../data/v17/internal-ohlc-support-resistance.json')")
  }
};
fs.writeFileSync(P('data/v20/execution-gap-regression.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
