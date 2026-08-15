#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const read = rel => JSON.parse(fs.readFileSync(P(rel), 'utf8'));
const writeRegression = value => fs.writeFileSync(P('data/v20/regression.json'), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
const runNode = (rel, env = {}) => execFileSync(process.execPath, [P(rel)], {
  cwd: root,
  env: { ...process.env, ...env },
  stdio: 'inherit',
});

// 1) Independent critic. It intentionally fails if research-platform integrity is
// broken or if execution readiness is overstated.
require('./final-acceptance.cjs');
const finalAcceptance = read('data/v20/final-acceptance.json');
let regression = read('data/v20/regression.json');
regression.finalAcceptance = finalAcceptance;
regression.finalAcceptanceMirror = {
  authoritativeRuntimeSource: 'scripts/v20/final-acceptance.cjs',
  detailedSidecar: 'data/v20/final-acceptance.json',
  persistedInMainEvidence: 'data/v20/regression.json#finalAcceptance',
  generatedInSameMainRun: true,
};
writeRegression(regression);

// 2) Read-only execution readiness gap from authoritative V17 evidence.
require('./execution-gap-regression.cjs');
const executionGap = read('data/v20/execution-gap-regression.json');
if (executionGap.ok !== true) process.exitCode = 1;
regression = read('data/v20/regression.json');
regression.executionReadinessGap = executionGap;
regression.executionReadinessGapMirror = {
  authoritativeRuntimeSource: 'scripts/v20/execution-gap-regression.cjs',
  transientDetailedSidecar: 'data/v20/execution-gap-regression.json',
  persistedInMainEvidence: 'data/v20/regression.json#executionReadinessGap',
  generatedInSameMainRun: true,
  guaranteesExecutionGrade: false,
};
writeRegression(regression);

// 3) Backtest/calibration readiness. Existing V19 evidence must never be relabeled
// as an independent V20 score backtest.
require('./build-backtest-readiness.cjs');
require('./backtest-readiness-regression.cjs');
const backtestReadiness = read('data/v20/backtest-readiness.json');
const backtestRegression = read('data/v20/backtest-readiness-regression.json');
if (backtestRegression.ok !== true) process.exitCode = 1;
regression = read('data/v20/regression.json');
regression.backtestReadiness = backtestReadiness;
regression.backtestReadinessRegression = backtestRegression;
regression.backtestReadinessMirror = {
  authoritativeRuntimeBuilder: 'scripts/v20/build-backtest-readiness.cjs',
  authoritativeRuntimeRegression: 'scripts/v20/backtest-readiness-regression.cjs',
  persistedReadiness: 'data/v20/regression.json#backtestReadiness',
  persistedRegression: 'data/v20/regression.json#backtestReadinessRegression',
  generatedInSameMainRun: true,
  predictivePerformanceValidated: false,
};
writeRegression(regression);

// 4) S/R remediation is diagnostic only. It must not mutate V17 or claim that
// closing the arithmetic gaps is sufficient for execution grade.
require('./build-sr-remediation-audit.cjs');
require('./sr-remediation-regression.cjs');
const srRemediation = read('data/v20/sr-remediation-audit.json');
const srRemediationRegression = read('data/v20/sr-remediation-regression.json');
if (srRemediationRegression.ok !== true) process.exitCode = 1;
regression = read('data/v20/regression.json');
regression.supportResistanceRemediation = srRemediation;
regression.supportResistanceRemediationRegression = srRemediationRegression;
regression.supportResistanceRemediationMirror = {
  authoritativeRuntimeBuilder: 'scripts/v20/build-sr-remediation-audit.cjs',
  authoritativeRuntimeRegression: 'scripts/v20/sr-remediation-regression.cjs',
  persistedAudit: 'data/v20/regression.json#supportResistanceRemediation',
  persistedRegression: 'data/v20/regression.json#supportResistanceRemediationRegression',
  generatedInSameMainRun: true,
  automaticV17MutationAllowed: false,
  guaranteesExecutionGrade: false,
};
writeRegression(regression);

// 5) Full-market technical evidence is research display evidence only. Run it in
// the authoritative Main cycle; individual network failures reduce coverage rather
// than fabricating indicators. Its regression rejects any score/execution leakage.
runNode('scripts/v20/build-full-market-technical.cjs', {
  V20_FULL_TECH_NETWORK_REFRESH: process.env.V20_FULL_TECH_NETWORK_REFRESH || 'true',
  V20_FULL_TECH_CONCURRENCY: process.env.V20_FULL_TECH_CONCURRENCY || '6',
  V20_FULL_TECH_PRICE_TOLERANCE_PCT: process.env.V20_FULL_TECH_PRICE_TOLERANCE_PCT || '5',
});
runNode('scripts/v20/full-market-technical-regression.cjs');
const fullMarketTechnical = read('data/v20/full-market-technical.json');
const fullMarketTechnicalRegression = read('data/v20/full-market-technical-regression.json');
if (fullMarketTechnicalRegression.ok !== true) process.exitCode = 1;
regression = read('data/v20/regression.json');
// Persist the complete evidence in the already-authoritative regression artifact so
// the research UI can fall back to it even though the raw sidecar is transient.
regression.fullMarketTechnical = fullMarketTechnical;
regression.fullMarketTechnicalRegression = fullMarketTechnicalRegression;
regression.fullMarketTechnicalMirror = {
  authoritativeRuntimeBuilder: 'scripts/v20/build-full-market-technical.cjs',
  authoritativeRuntimeRegression: 'scripts/v20/full-market-technical-regression.cjs',
  transientDetailedSidecar: 'data/v20/full-market-technical.json',
  persistedEvidence: 'data/v20/regression.json#fullMarketTechnical',
  persistedRegression: 'data/v20/regression.json#fullMarketTechnicalRegression',
  generatedInSameMainRun: true,
  usedForDecisionScore: false,
  usedForExecutionGate: false,
  usedForProductionAllocation: false,
};
writeRegression(regression);

// 6) Real-Chrome acceptance for research evidence pages. This is runtime/layout
// acceptance, not a human pixel-perfect claim.
runNode('scripts/v20/extended-pages-smoke.cjs');
const extendedBrowser = read('data/v20/extended-pages-smoke.json');
if (extendedBrowser.ok !== true) process.exitCode = 1;
regression = read('data/v20/regression.json');
regression.extendedResearchBrowserAcceptance = extendedBrowser;
regression.extendedResearchBrowserAcceptanceMirror = {
  authoritativeRuntimeSource: 'scripts/v20/extended-pages-smoke.cjs',
  transientDetailedSidecar: 'data/v20/extended-pages-smoke.json',
  persistedEvidence: 'data/v20/regression.json#extendedResearchBrowserAcceptance',
  generatedInSameMainRun: true,
  humanPixelPerfectClaimed: false,
};
writeRegression(regression);

// 7) Release manifest is generated only after all same-run evidence above has been
// persisted into the authoritative regression artifact.
require('./build-release-manifest.cjs');
require('./release-manifest-regression.cjs');

const releaseManifest = read('data/v20/release-manifest.json');
const releaseRegression = read('data/v20/release-manifest-regression.json');
regression = read('data/v20/regression.json');
regression.releaseManifest = releaseManifest;
regression.releaseManifestRegression = releaseRegression;
regression.releaseManifestMirror = {
  authoritativeRuntimeBuilder: 'scripts/v20/build-release-manifest.cjs',
  authoritativeRuntimeRegression: 'scripts/v20/release-manifest-regression.cjs',
  transientDetailedManifest: 'data/v20/release-manifest.json',
  transientDetailedRegression: 'data/v20/release-manifest-regression.json',
  persistedManifest: 'data/v20/regression.json#releaseManifest',
  persistedRegression: 'data/v20/regression.json#releaseManifestRegression',
  generatedInSameMainRun: true,
};
writeRegression(regression);

console.log(JSON.stringify({
  finalStatus: finalAcceptance.finalStatus,
  researchPlatformReady: finalAcceptance.researchPlatformReady,
  executionReady: finalAcceptance.executionReady,
  productionBlockerCount: finalAcceptance.criticSummary?.productionBlockerCount ?? null,
  executionGap: executionGap.gaps,
  backtestStatus: backtestReadiness.status,
  backtestClaimAllowed: backtestReadiness.claimPolicy?.v20ScoreBacktestClaimAllowed === true,
  srRemediationRegressionOk: srRemediationRegression.ok === true,
  fullMarketTechnicalCurrentReady: fullMarketTechnical.summary?.currentReadyCount ?? null,
  fullMarketTechnicalCoveragePct: fullMarketTechnical.summary?.currentReadyCoveragePct ?? null,
  extendedBrowserOk: extendedBrowser.ok === true,
  releaseClassification: releaseManifest.releaseClassification,
  releaseRegressionOk: releaseRegression.ok === true,
  deployedClaimAllowed: releaseManifest.releaseClaims?.deployedClaimAllowed === true,
  persistedAcceptanceMirror: 'data/v20/regression.json#finalAcceptance',
  persistedExecutionGap: 'data/v20/regression.json#executionReadinessGap',
  persistedBacktestReadiness: 'data/v20/regression.json#backtestReadiness',
  persistedSrRemediation: 'data/v20/regression.json#supportResistanceRemediation',
  persistedFullMarketTechnical: 'data/v20/regression.json#fullMarketTechnical',
  persistedExtendedBrowser: 'data/v20/regression.json#extendedResearchBrowserAcceptance',
  persistedReleaseManifest: 'data/v20/regression.json#releaseManifest',
}, null, 2));
