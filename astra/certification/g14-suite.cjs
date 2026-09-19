'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const WRITE = process.argv.includes('--write');
const SOURCE_HEAD = process.env.G14_SOURCE_HEAD || 'LOCAL';
const WORKFLOW_RUN_ID = Number(process.env.G14_WORKFLOW_RUN_ID || 0);

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function run(cmd, args, options = {}) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    env: { ...process.env, G14_SUITE: '1' },
    ...options
  });
}

function parseTap(text) {
  const summary = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  for (const line of String(text || '').split(/\r?\n/)) {
    const match = line.match(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\s*$/);
    if (match) summary[match[1]] = Number(match[2]);
  }
  return summary;
}

function testOne(rel) {
  const result = run(process.execPath, ['--test', '--test-reporter=tap', rel]);
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  return {
    file: rel,
    exitCode: result.status == null ? 1 : result.status,
    summary: parseTap(output),
    outputTail: output.split(/\r?\n/).slice(-30).join('\n')
  };
}

function syntaxOne(rel) {
  const result = run(process.execPath, ['--check', rel]);
  return {
    file: rel,
    exitCode: result.status == null ? 1 : result.status,
    stderr: String(result.stderr || '').trim()
  };
}

function gateMap(gates) {
  return new Map((gates.gates || []).map(g => [g.id, g.status]));
}

function aggregate(runs) {
  const out = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  for (const item of runs) {
    for (const key of Object.keys(out)) out[key] += Number(item.summary[key] || 0);
  }
  return out;
}

function gitDirtyPaths() {
  const result = run('git', ['status', '--porcelain']);
  if (result.status !== 0) throw new Error('Unable to inspect git working tree');
  return String(result.stdout || '').split(/\r?\n/).filter(Boolean);
}

const gates = readJson('04_ACCEPTANCE_GATES.json');
const work = readJson('docs/astra/WORK_STATE.json');
const g12 = readJson('docs/astra/G12_CERTIFICATION.json');
const g13 = readJson('docs/astra/G13_CERTIFICATION.json');
const statuses = gateMap(gates);

const priorGreen = Array.from({ length: 13 }, (_, i) => 'G' + String(i + 1).padStart(2, '0'))
  .every(id => statuses.get(id) === 'GREEN');

const testDir = path.join(ROOT, 'tests/astra');
const astraTests = fs.readdirSync(testDir)
  .filter(name => name.endsWith('.test.cjs'))
  .sort()
  .map(name => 'tests/astra/' + name);

const testRuns = astraTests.map(testOne);
const integrationRuns = ['deploy/rc2-safe-shell/test/local-api.test.js'].map(testOne);
const allRuns = [...testRuns, ...integrationRuns];
const totals = aggregate(allRuns);

const skipViolations = allRuns
  .filter(item => item.summary.skipped > 0 && item.file !== 'tests/astra/g07-migration.test.cjs')
  .map(item => ({ file: item.file, skipped: item.summary.skipped }));

const zeroTestFiles = allRuns.filter(item => item.summary.tests === 0).map(item => item.file);
const processFailures = allRuns.filter(item => item.exitCode !== 0).map(item => ({
  file: item.file,
  exitCode: item.exitCode,
  outputTail: item.outputTail
}));

const dedicatedFiles = [...new Set(
  (g13.architecture?.allModules || []).flatMap(m => Array.isArray(m.dedicatedFiles) ? m.dedicatedFiles : [])
)].sort();

const syntaxRuns = dedicatedFiles.map(syntaxOne);
const syntaxFailures = syntaxRuns.filter(x => x.exitCode !== 0);

const legacyScanRun = run(process.execPath, ['astra/certification/legacy-isolation.cjs', '.', '--full']);
let legacyScan = null;
try {
  legacyScan = JSON.parse(String(legacyScanRun.stdout || '').trim());
} catch {
  legacyScan = { parseError: true, raw: String(legacyScanRun.stdout || '').slice(0, 2000) };
}

const dirtyAfterTests = gitDirtyPaths();

const checks = {
  g01ThroughG13Green: priorGreen,
  g14PendingBeforeCertification: statuses.get('G14') === 'PENDING',
  g15Pending: statuses.get('G15') === 'PENDING',
  workStateAligned: work.current_gate === 'G14' && work.last_green_gate === 'G13' && work.current_phase === 'G14_PENDING',
  g13CertifiedGreen: g13.status === 'GREEN' && g13.architecture?.findingsTotal === 0 && g13.architecture?.dedicatedModules === 30,
  g12ZeroLegacy: g12.status === 'GREEN' && g12.runtimeLegacyDependencyCount === 0,
  productionCutoverDisabled: g13.productionCutover === false && g12.productionCutover === false,
  astraTestInventoryPresent: astraTests.length >= 35,
  totalTestFloorPreserved: totals.tests >= 183,
  noTestProcessFailures: processFailures.length === 0,
  noFailedTests: totals.fail === 0,
  noCancelledTests: totals.cancelled === 0,
  noTodoTests: totals.todo === 0,
  noUnexpectedSkips: skipViolations.length === 0,
  noZeroTestFiles: zeroTestFiles.length === 0,
  allDedicatedFilesSyntaxClean: dedicatedFiles.length >= 30 && syntaxFailures.length === 0,
  strictLegacyScanClean: legacyScanRun.status === 0 &&
    legacyScan?.runtimeLegacyDependencyCount === 0 &&
    legacyScan?.clean === true &&
    Array.isArray(legacyScan?.matches) &&
    legacyScan.matches.length === 0,
  workingTreeCleanAfterTests: dirtyAfterTests.length === 0
};

const failedChecks = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);

const evidence = {
  schemaVersion: 'astra-g14-test-evidence-1',
  remediationRound: 3,
  generatedAt: new Date().toISOString(),
  sourceHead: SOURCE_HEAD,
  workflowRunId: WORKFLOW_RUN_ID || null,
  gateStatusBeforeCertification: statuses.get('G14'),
  suiteStatus: failedChecks.length ? 'FAIL' : 'PASS',
  checks,
  failedChecks,
  inventory: {
    astraTestFiles: astraTests.length,
    integrationTestFiles: integrationRuns.length,
    dedicatedArchitectureFilesSyntaxChecked: dedicatedFiles.length
  },
  totals,
  skipPolicy: {
    allowedSkipFile: 'tests/astra/g07-migration.test.cjs',
    unexpectedSkipFiles: skipViolations,
    note: 'G07 real-migration rerun skips are historical intentional skips; no other skip is accepted.'
  },
  processFailures,
  zeroTestFiles,
  syntaxFailures,
  strictLegacyScan: {
    exitCode: legacyScanRun.status,
    clean: legacyScan?.clean === true,
    runtimeLegacyDependencyCount: legacyScan?.runtimeLegacyDependencyCount,
    matches: Array.isArray(legacyScan?.matches) ? legacyScan.matches.length : null
  },
  g13Boundary: {
    status: g13.status,
    findingsTotal: g13.architecture?.findingsTotal,
    logicalModules: g13.architecture?.logicalModules,
    dedicatedModules: g13.architecture?.dedicatedModules
  },
  productionCutover: false,
  runs: allRuns.map(item => ({
    file: item.file,
    exitCode: item.exitCode,
    summary: item.summary
  }))
};

if (WRITE && failedChecks.length === 0) {
  fs.writeFileSync(path.join(ROOT, 'docs/astra/G14_TEST_EVIDENCE.json'), JSON.stringify(evidence, null, 2) + '\n');
  const report = [
    '# G14 Unit / Integration / Regression Suite',
    '',
    '- Status: **PASS**',
    '- Source HEAD: `' + SOURCE_HEAD + '`',
    '- Astra test files: **' + astraTests.length + '**',
    '- Integration test files: **' + integrationRuns.length + '**',
    '- Tests: **' + totals.tests + '**',
    '- Passed: **' + totals.pass + '**',
    '- Failed: **' + totals.fail + '**',
    '- Cancelled: **' + totals.cancelled + '**',
    '- Skipped: **' + totals.skipped + '** (allowed only in G07 migration rerun)',
    '- Todo: **' + totals.todo + '**',
    '- Dedicated architecture files syntax-checked: **' + dedicatedFiles.length + '**',
    '- Strict legacy runtime dependency count: **' + (legacyScan?.runtimeLegacyDependencyCount ?? 'unknown') + '**',
    '- Production cutover: **false**',
    '',
    '## Certification boundary',
    '',
    'G14 may be promoted only by the dedicated certifier after this evidence is revalidated against the same source HEAD.'
  ].join('\n') + '\n';
  fs.writeFileSync(path.join(ROOT, 'docs/astra/G14_TEST_REPORT.md'), report);
}

console.log(JSON.stringify(evidence, null, 2));

if (failedChecks.length) process.exit(1);
