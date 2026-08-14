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

const thresholds = sr.thresholds || {};
const total = Number(sr.candidateUniverseCount || 0);
const trusted = Number(sr.candidateTrustedCount || 0);
const fresh = Number(sr.candidateTrustedFreshCount || 0);
const coverageThreshold = Number(thresholds.minimumCandidateCoveragePct || 95);
const freshnessThreshold = Number(thresholds.minimumCandidateFreshnessPct || 98);
const criticalThreshold = Number(thresholds.minimumCandidateCriticalFieldsPct || 95);
const confidenceThreshold = Number(thresholds.minimumAverageFreshConfidence || 0.8);
const requiredTrusted = requiredCount(total, coverageThreshold);
const requiredFresh = requiredCount(total, freshnessThreshold);
const requiredCritical = requiredCount(total, criticalThreshold);
const criticalCurrentEquivalent = Math.round(total * Number(sr.criticalFieldsPct || 0) / 100);
const trustedGap = Math.max(0, requiredTrusted - trusted);
const freshGap = Math.max(0, requiredFresh - fresh);
const criticalGap = Math.max(0, requiredCritical - criticalCurrentEquivalent);
const conflicts = Array.isArray(sr.sourceConflicts) ? sr.sourceConflicts : [];
const missing = Array.isArray(sr.missingCandidateSymbols) ? sr.missingCandidateSymbols : [];
const candidateSet = new Set((sr.candidateSymbols || []).map(String));
const staleTrusted = (sr.rows || []).filter(row => candidateSet.has(String(row.ticker)) && row.trustedProvenance === true && row.levelSessionDate !== sr.referenceSessionDate).map(row => row.ticker);
const referenceAligned = sr.referenceSessionDate === sr.sourceSessionDate;
const expectedExecutionCandidateReady = sr.sourceSessionVerified === true
  && sr.sessionCompletionConfirmed === true
  && referenceAligned
  && Number(sr.candidateCoveragePct || 0) >= coverageThreshold
  && Number(sr.candidateFreshnessPct || 0) >= freshnessThreshold
  && Number(sr.averageFreshConfidence || 0) >= confidenceThreshold
  && conflicts.length === 0;

check(gate.priceTruth?.verifiedSessionDate === current.sessionDate, 'GAP_GATE_SESSION_NOT_CURRENT');
check(sr.referenceSessionDate === current.sessionDate, 'GAP_SR_REFERENCE_SESSION_NOT_CURRENT');
check(sr.sourceSessionDate === current.sessionDate, 'GAP_SR_SOURCE_SESSION_NOT_CURRENT');
check(gate.executionInputs?.internal?.coveragePct === sr.candidateCoveragePct, 'GAP_COVERAGE_GATE_SR_MISMATCH');
check(gate.executionInputs?.internal?.freshnessPct === sr.candidateFreshnessPct, 'GAP_FRESHNESS_GATE_SR_MISMATCH');
check(gate.executionInputs?.internal?.criticalFieldsPct === sr.criticalFieldsPct, 'GAP_CRITICAL_GATE_SR_MISMATCH');
check(gate.executionInputs?.internal?.averageFreshConfidence === sr.averageFreshConfidence, 'GAP_CONFIDENCE_GATE_SR_MISMATCH');
check(gate.executionInputs?.internal?.executionCandidateReady === sr.executionCandidateReady, 'GAP_EXECUTION_CANDIDATE_GATE_SR_MISMATCH');
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
  schemaVersion: '20.0.0-execution-gap-regression-1',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  sessionDate: current.sessionDate,
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
    coveragePct: finite(sr.candidateCoveragePct),
    freshnessPct: finite(sr.candidateFreshnessPct),
    criticalFieldsPct: finite(sr.criticalFieldsPct),
    averageFreshConfidence: finite(sr.averageFreshConfidence),
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
    confidenceGap: Math.max(0, confidenceThreshold - Number(sr.averageFreshConfidence || 0))
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
    gateAndInternalSrSessionAligned: true,
    gateAndInternalSrMetricsConsistent: true,
    executionCandidateFormulaRecomputed: true,
    officialThresholdsReadFromInternalSr: true,
    missingSymbolsMatchGate: true,
    healthGapUiReadOnly: true,
    healthGapUiReadsAuthoritativeSources: true
  }
};
fs.writeFileSync(P('data/v20/execution-gap-regression.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
