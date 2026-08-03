#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const P = file => path.join(ROOT, file);
const JSON_PATH = P('data/review/v16-3-whole-app-review.json');
const MD_PATH = P('data/review/v16-3-whole-app-review.md');
const rank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const readJson = (file, fallback = {}) => { try { return JSON.parse(fs.readFileSync(P(file), 'utf8')); } catch { return fallback; } };
const readText = file => { try { return fs.readFileSync(P(file), 'utf8'); } catch { return ''; } };

const report = readJson('data/review/v16-3-whole-app-review.json');
if (!Array.isArray(report.cycles) || report.cycles.length !== 20) throw new Error('V16.3 review finalizer requires exactly 20 cycles');

const live = readJson('data/stable/v16-live-evidence.json');
const browser = readJson('data/stable/v16-browser-test-status.json');
const regime = readJson('data/stable/v16-market-regime.json');
const correlation = readJson('data/stable/v16-correlation-risk.json');
const alerts = readJson('data/stable/v16-alerts.json');
const fundamental = readJson('data/stable/v16-fundamental-analysis.json');
const official = readJson('data/stable/v16-official-disclosures.json');
const heartbeat = readJson('data/stable/v15-update-status.json');
const upgrade = readText('preview-v16/app/v16-3.js');
const workflow = readText('.github/workflows/v15-practical-deploy.yml');

function findCheck(id) {
  for (const cycle of report.cycles) {
    const item = (cycle.checks || []).find(row => row.id === id);
    if (item) return item;
  }
  return null;
}
function close(id, evidence) {
  const item = findCheck(id);
  if (!item) throw new Error(`Missing V16.3 review check: ${id}`);
  item.status = 'CLOSED';
  item.evidence = evidence;
  item.remediation = null;
}
function keepOpen(id, evidence, remediation) {
  const item = findCheck(id);
  if (!item) throw new Error(`Missing V16.3 review check: ${id}`);
  item.status = 'OPEN';
  item.evidence = evidence;
  item.remediation = remediation;
}

const maturityDisclosure = String(live.professionalGate?.disclosureAr || '');
const maturityIsVisible = maturityDisclosure.length >= 20 && upgrade.includes('professionalGate?.disclosureAr');
if (maturityIsVisible) close('C12-2', `dynamicDisclosure=${maturityDisclosure}`);
else keepOpen('C12-2', 'Live maturity disclosure is not rendered by the V16.3 UI', 'ربط professionalGate.disclosureAr بالواجهة وإظهار مرحلة Professional Pilot.');

const requiredOutputs = [
  ['financial', fundamental.generatedAt],
  ['official', official.generatedAt],
  ['regime', regime.generatedAt],
  ['live', live.generatedAt],
  ['correlation', correlation.generatedAt],
  ['alerts', alerts.generatedAt],
  ['browser', browser.generatedAt]
];
const missingOutputs = requiredOutputs.filter(([, value]) => !value).map(([name]) => name);
const workflowReady = [
  'v16-3-whole-app-review.cjs',
  'v16-3-release-gate.cjs',
  'Run real browser acceptance tests',
  'Deploy Pages'
].every(marker => workflow.includes(marker));
if (!missingOutputs.length && browser.status === 'PASSED' && workflowReady) {
  close('C20-2', `outputs=${requiredOutputs.map(([name]) => name).join(',')}; browser=PASSED; releaseWorkflow=ready`);
} else {
  keepOpen('C20-2', `missing=${missingOutputs.join(',') || 'none'}; browser=${browser.status}; workflowReady=${workflowReady}`, 'استكمال مخرجات الإصدار واختبارات المتصفح قبل الاستلام.');
}

for (const cycle of report.cycles) {
  const checks = Array.isArray(cycle.checks) ? cycle.checks : [];
  cycle.summary = {
    total: checks.length,
    closed: checks.filter(row => row.status === 'CLOSED').length,
    open: checks.filter(row => row.status === 'OPEN').length,
    blocking: checks.filter(row => row.status === 'OPEN' && rank[row.severity] >= 3).length
  };
}
const all = report.cycles.flatMap(cycle => (cycle.checks || []).map(item => ({ ...item, cycle: cycle.cycle, role: cycle.role })));
const open = all.filter(item => item.status === 'OPEN');
const blocking = open.filter(item => rank[item.severity] >= 3);
const severity = {};
for (const level of Object.keys(rank)) {
  severity[level] = {
    total: all.filter(item => item.severity === level).length,
    open: open.filter(item => item.severity === level).length,
    closed: all.filter(item => item.severity === level && item.status === 'CLOSED').length
  };
}
report.finalizedAt = new Date().toISOString();
report.finalizer = 'V16_3_EVIDENCE_BASED_REVIEW_FINALIZER_1.0';
report.acceptance = blocking.length ? 'REJECTED_BLOCKING_FINDINGS' : 'ACCEPTED_ZERO_BLOCKING_FINDINGS';
report.acceptanceCriteria = {
  ...report.acceptanceCriteria,
  zeroCritical: !open.some(item => item.severity === 'CRITICAL'),
  zeroHigh: !open.some(item => item.severity === 'HIGH'),
  allTwentyCyclesExecuted: report.cycles.length === 20,
  wholeApplicationScope: report.scope?.type === 'WHOLE_APPLICATION'
};
report.summary = {
  totalChecks: all.length,
  closedChecks: all.length - open.length,
  openChecks: open.length,
  blockingFindings: blocking.length,
  severity
};
report.openFindings = open;
report.blockingFindings = blocking;

const lines = [
  '# تقرير مراجعة V16.3 الشاملة — 20 دورة', '',
  `- تاريخ المراجعة: ${report.generatedAt}`,
  `- تاريخ الإقفال: ${report.finalizedAt}`,
  '- النطاق: **التطبيق بالكامل**',
  `- الدورات: ${report.cycles.length}/20`,
  `- الحكم: **${report.acceptance}**`,
  `- الفحوص: ${report.summary.closedChecks}/${report.summary.totalChecks} مغلق`,
  `- الحرجة المفتوحة: ${severity.CRITICAL.open}`,
  `- العالية المفتوحة: ${severity.HIGH.open}`, '',
  '| الدورة | الدور | الفحوص | المغلق | المفتوح | الحاجب |',
  '|---:|---|---:|---:|---:|---:|',
  ...report.cycles.map(cycle => `| ${cycle.cycle} | ${cycle.role} | ${cycle.summary.total} | ${cycle.summary.closed} | ${cycle.summary.open} | ${cycle.summary.blocking} |`), '',
  '## الملاحظات المفتوحة', '',
  ...(open.length ? [
    '| الدورة | الخطورة | الملاحظة | الدليل | الإجراء |',
    '|---:|---|---|---|---|',
    ...open.map(item => `| ${item.cycle} | ${item.severity} | ${String(item.title).replace(/\|/g, '/')} | ${String(item.evidence).replace(/\|/g, '/')} | ${String(item.remediation || '—').replace(/\|/g, '/')} |`)
  ] : ['لا توجد ملاحظات مفتوحة.']), '',
  '## قرار الاستلام', '',
  blocking.length ? 'مرفوض حتى إغلاق الملاحظات الحرجة والعالية.' : 'مقبول من ناحية جودة التطبيق ضمن نطاق الاختبارات. يظل تصنيف الأداء الاستثماري تابعًا للسجل الحي ولا يتحول إلى مثبت تلقائيًا.'
];

fs.mkdirSync(path.dirname(JSON_PATH), { recursive: true });
fs.writeFileSync(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
fs.writeFileSync(MD_PATH, `${lines.join('\n')}\n`, 'utf8');
console.log({ acceptance: report.acceptance, summary: report.summary });
if (blocking.length) process.exitCode = 1;
