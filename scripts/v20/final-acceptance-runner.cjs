#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);

// final-acceptance.cjs is intentionally executable on require: it reads the current
// run evidence, writes the detailed sidecar, and sets a non-zero exit code if the
// research-platform acceptance contract fails or execution readiness is overstated.
require('./final-acceptance.cjs');

const finalAcceptance = JSON.parse(fs.readFileSync(P('data/v20/final-acceptance.json'), 'utf8'));
let regression = JSON.parse(fs.readFileSync(P('data/v20/regression.json'), 'utf8'));
regression.finalAcceptance = finalAcceptance;
regression.finalAcceptanceMirror = {
  authoritativeRuntimeSource: 'scripts/v20/final-acceptance.cjs',
  detailedSidecar: 'data/v20/final-acceptance.json',
  persistedInMainEvidence: 'data/v20/regression.json#finalAcceptance',
  generatedInSameMainRun: true,
};
fs.writeFileSync(P('data/v20/regression.json'), `${JSON.stringify(regression, null, 2)}\n`, 'utf8');

// Execution readiness gap is derived read-only from the authoritative V17 gate and
// internal S/R evidence. It is a necessary-gap diagnostic, never an execution grant.
require('./execution-gap-regression.cjs');
const executionGap = JSON.parse(fs.readFileSync(P('data/v20/execution-gap-regression.json'), 'utf8'));
if (executionGap.ok !== true) process.exitCode = 1;
regression = JSON.parse(fs.readFileSync(P('data/v20/regression.json'), 'utf8'));
regression.executionReadinessGap = executionGap;
regression.executionReadinessGapMirror = {
  authoritativeRuntimeSource: 'scripts/v20/execution-gap-regression.cjs',
  transientDetailedSidecar: 'data/v20/execution-gap-regression.json',
  persistedInMainEvidence: 'data/v20/regression.json#executionReadinessGap',
  generatedInSameMainRun: true,
  guaranteesExecutionGrade: false,
};
fs.writeFileSync(P('data/v20/regression.json'), `${JSON.stringify(regression, null, 2)}\n`, 'utf8');

// The release manifest is generated only after the independent critic and the
// execution-gap diagnostic are persisted into main regression evidence.
require('./build-release-manifest.cjs');
require('./release-manifest-regression.cjs');

const releaseManifest = JSON.parse(fs.readFileSync(P('data/v20/release-manifest.json'), 'utf8'));
const releaseRegression = JSON.parse(fs.readFileSync(P('data/v20/release-manifest-regression.json'), 'utf8'));
regression = JSON.parse(fs.readFileSync(P('data/v20/regression.json'), 'utf8'));
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
fs.writeFileSync(P('data/v20/regression.json'), `${JSON.stringify(regression, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  finalStatus: finalAcceptance.finalStatus,
  researchPlatformReady: finalAcceptance.researchPlatformReady,
  executionReady: finalAcceptance.executionReady,
  productionBlockerCount: finalAcceptance.criticSummary?.productionBlockerCount ?? null,
  criticalFindingCount: finalAcceptance.criticSummary?.criticalFindingCount ?? null,
  executionGap: executionGap.gaps,
  executionGapGuaranteesExecutionGrade: executionGap.interpretation?.guaranteesExecutionGrade === true,
  releaseClassification: releaseManifest.releaseClassification,
  releaseRegressionOk: releaseRegression.ok === true,
  deployedClaimAllowed: releaseManifest.releaseClaims?.deployedClaimAllowed === true,
  persistedAcceptanceMirror: 'data/v20/regression.json#finalAcceptance',
  persistedExecutionGap: 'data/v20/regression.json#executionReadinessGap',
  persistedReleaseManifest: 'data/v20/regression.json#releaseManifest',
  persistedReleaseRegression: 'data/v20/regression.json#releaseManifestRegression',
}, null, 2));
