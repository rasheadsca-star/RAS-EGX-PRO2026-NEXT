'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const WRITE = process.argv.includes('--write');
const SOURCE_HEAD = process.env.G14_SOURCE_HEAD || '';
const WORKFLOW_RUN_ID = Number(process.env.G14_WORKFLOW_RUN_ID || 0);

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}
function writeJson(rel, value) {
  fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(value, null, 2) + '\n');
}
function statuses(gates) {
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
const evidence = readJson('docs/astra/G14_TEST_EVIDENCE.json');
const g13 = readJson('docs/astra/G13_CERTIFICATION.json');
const map = statuses(gates);

const priorGreen = Array.from({ length: 13 }, (_, i) => 'G' + String(i + 1).padStart(2, '0'))
  .every(id => map.get(id) === 'GREEN');

const checks = {
  sourceHeadProvided: Boolean(SOURCE_HEAD),
  evidenceMatchesSourceHead: evidence.sourceHead === SOURCE_HEAD,
  workflowRunMatches: !WORKFLOW_RUN_ID || evidence.workflowRunId === WORKFLOW_RUN_ID,
  g01ThroughG13Green: priorGreen,
  g14PendingBeforePromotion: map.get('G14') === 'PENDING',
  g15Pending: map.get('G15') === 'PENDING',
  evidencePassed: evidence.suiteStatus === 'PASS' && Array.isArray(evidence.failedChecks) && evidence.failedChecks.length === 0,
  zeroFailures: evidence.totals?.fail === 0 && evidence.totals?.cancelled === 0 && evidence.totals?.todo === 0,
  testFloorPreserved: Number(evidence.totals?.tests || 0) >= 183,
  noUnexpectedSkips: Array.isArray(evidence.skipPolicy?.unexpectedSkipFiles) && evidence.skipPolicy.unexpectedSkipFiles.length === 0,
  architectureSyntaxCovered: Number(evidence.inventory?.dedicatedArchitectureFilesSyntaxChecked || 0) >= 30,
  strictZeroLegacy: evidence.strictLegacyScan?.clean === true && evidence.strictLegacyScan?.runtimeLegacyDependencyCount === 0,
  g13StillZeroFindingGreen: g13.status === 'GREEN' && g13.architecture?.findingsTotal === 0 && g13.architecture?.dedicatedModules === 30,
  productionCutoverDisabled: evidence.productionCutover === false && g13.productionCutover === false,
  stateAlignedBeforePromotion:
    primary.current_gate === 'G14' && primary.last_green_gate === 'G13' && primary.current_phase === 'G14_PENDING' &&
    docsState.current_gate === 'G14' && docsState.last_green_gate === 'G13' && docsState.current_phase === 'G14_PENDING'
};

const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
if (failedChecks.length) {
  console.error(JSON.stringify({ status: 'FAIL', failedChecks }, null, 2));
  process.exit(1);
}

const now = new Date().toISOString();
const certification = {
  schemaVersion: 'astra-g14-certification-1',
  generatedAt: now,
  status: 'GREEN',
  sourceHead: SOURCE_HEAD,
  workflowRunId: WORKFLOW_RUN_ID || evidence.workflowRunId || null,
  checks,
  failedChecks: [],
  suite: {
    astraTestFiles: evidence.inventory.astraTestFiles,
    integrationTestFiles: evidence.inventory.integrationTestFiles,
    tests: evidence.totals.tests,
    pass: evidence.totals.pass,
    fail: evidence.totals.fail,
    cancelled: evidence.totals.cancelled,
    skipped: evidence.totals.skipped,
    todo: evidence.totals.todo,
    unexpectedSkipFiles: evidence.skipPolicy.unexpectedSkipFiles
  },
  architecture: {
    dedicatedFilesSyntaxChecked: evidence.inventory.dedicatedArchitectureFilesSyntaxChecked,
    g13FindingsTotal: g13.architecture.findingsTotal,
    logicalModules: g13.architecture.logicalModules,
    dedicatedModules: g13.architecture.dedicatedModules
  },
  runtimeLegacyDependencyCount: evidence.strictLegacyScan.runtimeLegacyDependencyCount,
  regressionBoundary: 'G01-G13 GREEN PRESERVED',
  productionCutover: false,
  nextGate: 'G15',
  nextGateStatus: 'PENDING'
};

if (WRITE) {
  writeJson('docs/astra/G14_CERTIFICATION.json', certification);

  updateGate(gates, 'G14', {
    status: 'GREEN',
    evidence: [
      'docs/astra/G14_CERTIFICATION.json',
      'docs/astra/G14_TEST_EVIDENCE.json',
      'docs/astra/G14_TEST_REPORT.md',
      'astra/certification/g14-suite.cjs',
      'astra/certification/g14-certify.cjs',
      '.github/workflows/astra-g14-test-suite.yml'
    ]
  });
  gates.updated_at = now;
  writeJson('04_ACCEPTANCE_GATES.json', gates);

  for (const state of [primary, docsState]) {
    state.current_phase = 'G15_PENDING';
    state.current_gate = 'G15';
    state.last_green_gate = 'G14';
    state.blocking_issues = [];
    state.blocked_gates = Array.isArray(state.blocked_gates) ? state.blocked_gates.filter(x => x !== 'G14') : [];
    state.failed_gates = Array.isArray(state.failed_gates) ? state.failed_gates.filter(x => x !== 'G14') : [];
    state.completed_gates = Array.from(new Set([...(state.completed_gates || []), 'G14']));
    state.clean_review_streak = 0;
    state.next_action = 'Begin G15 Chromium browser smoke. Keep production cutover disabled.';
    state.last_updated = now;
    state.g14_certification = {
      status: 'GREEN',
      workflowRunId: certification.workflowRunId,
      sourceCommit: SOURCE_HEAD,
      astraTestFiles: certification.suite.astraTestFiles,
      integrationTestFiles: certification.suite.integrationTestFiles,
      tests: certification.suite.tests,
      passed: certification.suite.pass,
      failed: certification.suite.fail,
      skipped: certification.suite.skipped,
      unexpectedSkipFiles: certification.suite.unexpectedSkipFiles.length,
      dedicatedFilesSyntaxChecked: certification.architecture.dedicatedFilesSyntaxChecked,
      runtimeLegacyDependencyCount: certification.runtimeLegacyDependencyCount,
      g01ThroughG13Regression: 'PASS',
      productionCutover: false
    };
    const finding = 'G14 GREEN: complete Astra unit/integration/regression suite passed with zero failed/cancelled/todo tests, no unexpected skips, all dedicated architecture files syntax-clean, and zero legacy runtime dependencies.';
    state.material_findings = Array.isArray(state.material_findings) ? state.material_findings : [];
    if (!state.material_findings.includes(finding)) state.material_findings.push(finding);
  }
  writeJson('05_WORK_STATE.json', primary);
  writeJson('docs/astra/WORK_STATE.json', docsState);
}

console.log(JSON.stringify(certification, null, 2));
