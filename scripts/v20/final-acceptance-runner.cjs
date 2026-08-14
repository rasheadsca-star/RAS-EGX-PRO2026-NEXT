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

// The release manifest is generated only after the independent critic has produced
// and persisted its verdict into main regression evidence. The manifest regression
// prevents research readiness from being mislabeled execution-ready or deployed.
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
  releaseClassification: releaseManifest.releaseClassification,
  releaseRegressionOk: releaseRegression.ok === true,
  deployedClaimAllowed: releaseManifest.releaseClaims?.deployedClaimAllowed === true,
  persistedAcceptanceMirror: 'data/v20/regression.json#finalAcceptance',
  persistedReleaseManifest: 'data/v20/regression.json#releaseManifest',
  persistedReleaseRegression: 'data/v20/regression.json#releaseManifestRegression',
}, null, 2));
