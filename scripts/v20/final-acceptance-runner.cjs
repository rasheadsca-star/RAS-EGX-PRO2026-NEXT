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
const regression = JSON.parse(fs.readFileSync(P('data/v20/regression.json'), 'utf8'));
regression.finalAcceptance = finalAcceptance;
regression.finalAcceptanceMirror = {
  authoritativeRuntimeSource: 'scripts/v20/final-acceptance.cjs',
  detailedSidecar: 'data/v20/final-acceptance.json',
  persistedInMainEvidence: 'data/v20/regression.json#finalAcceptance',
  generatedInSameMainRun: true,
};
fs.writeFileSync(P('data/v20/regression.json'), `${JSON.stringify(regression, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  finalStatus: finalAcceptance.finalStatus,
  researchPlatformReady: finalAcceptance.researchPlatformReady,
  executionReady: finalAcceptance.executionReady,
  productionBlockerCount: finalAcceptance.criticSummary?.productionBlockerCount ?? null,
  criticalFindingCount: finalAcceptance.criticSummary?.criticalFindingCount ?? null,
  persistedMirror: 'data/v20/regression.json#finalAcceptance',
}, null, 2));
