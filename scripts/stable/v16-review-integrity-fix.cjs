#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const REPORT_PATH = path.join(ROOT, 'data/review/v16-consulting-review.json');
const MD_PATH = path.join(ROOT, 'data/review/v16-consulting-review.md');
const severityRank = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
const readText = rel => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; } };
const readJson = rel => { try { return JSON.parse(readText(rel)); } catch { return {}; } };
const num = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;

const report = readJson('data/review/v16-consulting-review.json');
const html = readText('preview-v16/app/index.html');
const app = readText('preview-v16/app/app.js');
const decision = readJson('data/stable/v15-practical-decision.json');
if (!Array.isArray(report.cycles) || report.cycles.length !== 20) throw new Error('Integrity review requires exactly 20 cycles');

const regressionCycle = report.cycles.find(cycle => cycle.role === 'مراجع الانحدار والتكامل');
const check = regressionCycle?.checks?.find(item => item.id === 'APPX_REG_01');
if (!check) throw new Error('APPX_REG_01 not found');
const requiredIds = ['marketSearch', 'recommendationGrid', 'portfolioRows', 'fundamentalDetail', 'evaluationRows'];
const missingIds = requiredIds.filter(id => !html.includes(`id="${id}"`) && !html.includes(`id='${id}'`));
const recommendations = Array.isArray(decision.recommendations) ? decision.recommendations : [];
const validPlans = recommendations.filter(row => num(row.entryLow) > 0 && num(row.entryHigh) >= num(row.entryLow) && num(row.stopLoss) < num(row.entryLow) && num(row.target1) > num(row.entryHigh)).length;
const appBindings = ['marketSearch', 'recommendationGrid', 'portfolioRows'].every(marker => app.includes(marker));
const passed = missingIds.length === 0 && validPlans === recommendations.length && appBindings;
check.status = passed ? 'CLOSED' : 'OPEN';
check.evidence = `requiredIds=${requiredIds.join(',')}; missing=${missingIds.join(',') || 'none'}; appBindings=${appBindings}; validPlans=${validPlans}/${recommendations.length}`;
check.remediation = passed ? null : 'إصلاح معرفات عناصر الواجهة أو ربطها أو إعادة بناء الخطط الفنية.';

for (const [index, cycle] of report.cycles.entries()) {
  cycle.cycle = index + 1;
  const open = (cycle.checks || []).filter(item => item.status === 'OPEN');
  cycle.summary = { total: (cycle.checks || []).length, closed: (cycle.checks || []).length - open.length, open: open.length, blocking: open.filter(item => severityRank[item.severity] >= severityRank.HIGH).length };
}
const allChecks = report.cycles.flatMap(cycle => (cycle.checks || []).map(item => ({ cycle: cycle.cycle, role: cycle.role, ...item })));
const open = allChecks.filter(item => item.status === 'OPEN');
const blocking = open.filter(item => severityRank[item.severity] >= severityRank.HIGH);
const severity = ['CRITICAL','HIGH','MEDIUM','LOW'].reduce((out, level) => {
  const rows = allChecks.filter(item => item.severity === level);
  out[level] = { total: rows.length, open: rows.filter(item => item.status === 'OPEN').length, closed: rows.filter(item => item.status === 'CLOSED').length };
  return out;
}, {});
report.generatedAt = new Date().toISOString();
report.reviewIntegrity = { version: 'V16_REVIEW_INTEGRITY_1.0', correctedCheck: 'APPX_REG_01', requiredIds, appBindings, validPlans, recommendationCount: recommendations.length };
report.acceptanceCriteria = { ...(report.acceptanceCriteria || {}), zeroCritical: severity.CRITICAL.open === 0, zeroHigh: severity.HIGH.open === 0, noBlockingErrors: blocking.length === 0, allTwentyCyclesExecuted: true, wholeApplicationScope: report.scope?.type === 'WHOLE_APPLICATION' };
report.acceptance = blocking.length ? 'REJECTED_BLOCKING_FINDINGS' : open.length ? 'ACCEPTED_WITH_NON_BLOCKING_FINDINGS' : 'ACCEPTED_ZERO_FINDINGS';
report.summary = { ...(report.summary || {}), totalChecks: allChecks.length, closedChecks: allChecks.length - open.length, openChecks: open.length, blockingFindings: blocking.length, severity };
report.openFindings = open;
report.blockingFindings = blocking;
fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');

const md = [];
md.push('# تقرير المراجعة الاستشارية الشاملة — EGX Pro V16.1','', '- النطاق: **التطبيق بالكامل**', `- تاريخ التوليد: ${report.generatedAt}`, '- الدورات المنفذة: 20/20', `- الحكم: **${report.acceptance}**`, `- الفحوص: ${report.summary.closedChecks}/${report.summary.totalChecks} مغلق`, `- الملاحظات الحرجة المفتوحة: ${severity.CRITICAL.open}`, `- الملاحظات العالية المفتوحة: ${severity.HIGH.open}`, '', '| الدورة | دور المراجع | الفحوص | المغلق | المفتوح | الحاجب |', '|---:|---|---:|---:|---:|---:|');
for (const cycle of report.cycles) md.push(`| ${cycle.cycle} | ${cycle.role} | ${cycle.summary.total} | ${cycle.summary.closed} | ${cycle.summary.open} | ${cycle.summary.blocking} |`);
md.push('', '## الملاحظات المفتوحة', '');
if (!open.length) md.push('لا توجد ملاحظات مفتوحة ضمن نطاق التطبيق الكامل والفحوص المنفذة.');
else {
  md.push('| الدورة | الخطورة | الملاحظة | الدليل | الإجراء المطلوب |','|---:|---|---|---|---|');
  for (const item of open) md.push(`| ${item.cycle} | ${item.severity} | ${item.title} | ${String(item.evidence).replace(/\|/g,'\\|')} | ${String(item.remediation || '').replace(/\|/g,'\\|')} |`);
}
md.push('', '## قرار الاستلام', '', blocking.length ? 'لم يتم الاستلام النهائي: توجد ملاحظات حرجة أو عالية في التطبيق.' : 'تم اجتياز شرط صفر ملاحظات حرجة وعالية على التطبيق بالكامل.');
fs.writeFileSync(MD_PATH, md.join('\n') + '\n');
console.log(JSON.stringify({ acceptance: report.acceptance, checks: allChecks.length, open: open.length, blocking: blocking.length, corrected: check }, null, 2));
if (blocking.length) process.exitCode = 1;
