'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const WRITE = process.argv.includes('--write');
const SOURCE_HEAD = process.env.G16_SOURCE_HEAD || '';
const WORKFLOW_RUN_ID = Number(process.env.G16_WORKFLOW_RUN_ID || 0);

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}
function writeJson(rel, value) {
  fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(value, null, 2) + '\n');
}
function statusMap(gates) {
  return new Map((gates.gates || []).map(g => [g.id, g.status]));
}
function updateGate(gates, id, patch) {
  const gate = (gates.gates || []).find(g => g.id === id);
  if (!gate) throw new Error('Missing gate ' + id);
  Object.assign(gate, patch);
}

const gates = readJson('04_ACCEPTANCE_GATES.json');
const primary = readJson('05_WORK_STATE.json');
const docsState = readJson('docs/astra/WORK_STATE.json');
const evidence = readJson('docs/astra/G16_DEPLOYMENT_EVIDENCE.json');
const g15 = readJson('docs/astra/G15_CERTIFICATION.json');
const map = statusMap(gates);

const priorGreen = Array.from({ length: 15 }, (_, i) => 'G' + String(i + 1).padStart(2, '0'))
  .every(id => map.get(id) === 'GREEN');

const requiredArtifacts = [
  'astra/runtime/v18/index.html',
  'astra/runtime/v18/resource-client.js',
  'astra/runtime/v18/app.js',
  'v18-live/index.html',
  'v18-live/bootstrap.js',
  'docs/astra/G11_CURRENT_PIPELINE_RUN.json',
  'docs/astra/G11_DATA_HEALTH_METRICS.json',
  'docs/astra/G11_DATA_HEALTH_ISSUES.json',
  'docs/astra/G11_GUARD37_EVIDENCE.json'
];

const checks = {
  sourceHeadProvided: Boolean(SOURCE_HEAD),
  evidenceMatchesSourceHead: evidence.sourceHead === SOURCE_HEAD,
  workflowRunMatches: !WORKFLOW_RUN_ID || evidence.workflowRunId === WORKFLOW_RUN_ID,
  g01ThroughG15Green: priorGreen,
  g16PendingBeforePromotion: map.get('G16') === 'PENDING',
  g17Pending: map.get('G17') === 'PENDING',
  stateAlignedBeforePromotion:
    primary.current_gate === 'G16' && primary.last_green_gate === 'G15' && primary.current_phase === 'G16_PENDING' &&
    docsState.current_gate === 'G16' && docsState.last_green_gate === 'G15' && docsState.current_phase === 'G16_PENDING',
  g15CertifiedGreen:
    g15.status === 'GREEN' &&
    g15.productionCutover === false &&
    g15.runtimeLegacyDependencyCount === 0,
  deploymentPassed: evidence.status === 'PASS' && Array.isArray(evidence.failedChecks) && evidence.failedChecks.length === 0,
  productionTargetReady:
    evidence.deployment?.state === 'READY' &&
    evidence.deployment?.target === 'production' &&
    evidence.deployment?.projectName === 'egx-pro-astra-production',
  isolatedProductionProject: evidence.deployment?.isolatedProject === true,
  productionAliasReachable: evidence.http?.productionAlias?.ok === true,
  immutableDeploymentReachable: evidence.http?.immutableDeployment?.ok === true,
  bootstrapReachable: evidence.http?.bootstrap?.ok === true,
  runtimeReachable: evidence.http?.runtime?.ok === true,
  persistedTruthByteExact: evidence.persistedTruth?.allHashesMatch === true,
  requiredArtifactCoverage:
    Array.isArray(evidence.bundle?.files) &&
    requiredArtifacts.every(file => evidence.bundle.files.includes(file)),
  noLegacyRuntimeDependencies: evidence.runtimeLegacyDependencyCount === 0,
  noExternalRuntimeReferences: evidence.runtimeExternalReferences === 0,
  productionCutoverDisabled: evidence.productionCutover === false
};

const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
if (failedChecks.length) {
  console.error(JSON.stringify({ status: 'FAIL', failedChecks }, null, 2));
  process.exit(1);
}

const now = new Date().toISOString();
const certification = {
  schemaVersion: 'astra-g16-certification-1',
  generatedAt: now,
  status: 'GREEN',
  sourceHead: SOURCE_HEAD,
  workflowRunId: WORKFLOW_RUN_ID || evidence.workflowRunId || null,
  checks,
  failedChecks: [],
  deployment: {
    projectName: evidence.deployment.projectName,
    deploymentUrl: evidence.deployment.deploymentUrl,
    productionUrl: evidence.deployment.productionUrl,
    state: evidence.deployment.state,
    target: evidence.deployment.target,
    isolatedProject: true
  },
  bundle: {
    artifactCount: evidence.bundle.files.length,
    persistedTruthFiles: evidence.persistedTruth.files.length,
    allPersistedTruthHashesMatch: evidence.persistedTruth.allHashesMatch
  },
  runtimeLegacyDependencyCount: 0,
  runtimeExternalReferences: 0,
  regressionBoundary: 'G01-G15 GREEN PRESERVED',
  productionCutover: false,
  nextGate: 'G17',
  nextGateStatus: 'PENDING'
};

if (WRITE) {
  writeJson('docs/astra/G16_CERTIFICATION.json', certification);

  updateGate(gates, 'G16', {
    status: 'GREEN',
    evidence: [
      'docs/astra/G16_CERTIFICATION.json',
      'docs/astra/G16_DEPLOYMENT_EVIDENCE.json',
      'docs/astra/G16_DEPLOYMENT_REPORT.md',
      'astra/certification/g16-certify.cjs',
      '.github/workflows/astra-g16-production-deployment.yml'
    ]
  });
  gates.updated_at = now;
  writeJson('04_ACCEPTANCE_GATES.json', gates);

  for (const state of [primary, docsState]) {
    state.current_phase = 'G17_PENDING';
    state.current_gate = 'G17';
    state.last_green_gate = 'G16';
    state.blocking_issues = [];
    state.blocked_gates = Array.isArray(state.blocked_gates) ? state.blocked_gates.filter(x => x !== 'G16') : [];
    state.failed_gates = Array.isArray(state.failed_gates) ? state.failed_gates.filter(x => x !== 'G16') : [];
    state.completed_gates = Array.from(new Set([...(state.completed_gates || []), 'G16']));
    state.clean_review_streak = 0;
    state.next_action = 'Begin G17 live production verification against the isolated Astra production deployment. Do not perform legacy/public cutover.';
    state.last_updated = now;
    state.g16_certification = {
      status: 'GREEN',
      workflowRunId: certification.workflowRunId,
      sourceCommit: SOURCE_HEAD,
      projectName: certification.deployment.projectName,
      deploymentUrl: certification.deployment.deploymentUrl,
      productionUrl: certification.deployment.productionUrl,
      target: 'production',
      isolatedProject: true,
      persistedTruthByteExact: true,
      runtimeLegacyDependencyCount: 0,
      runtimeExternalReferences: 0,
      g01ThroughG15Regression: 'PASS',
      productionCutover: false
    };
    const finding = 'G16 GREEN: standalone Astra production artifact deployed to an isolated Vercel project; required runtime and persisted decision-truth artifacts were verified byte-exact, with zero legacy runtime dependencies and no public/legacy cutover.';
    state.material_findings = Array.isArray(state.material_findings) ? state.material_findings : [];
    if (!state.material_findings.includes(finding)) state.material_findings.push(finding);
  }
  writeJson('05_WORK_STATE.json', primary);
  writeJson('docs/astra/WORK_STATE.json', docsState);
}

console.log(JSON.stringify(certification, null, 2));
