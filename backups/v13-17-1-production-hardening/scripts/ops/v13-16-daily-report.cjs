#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const FILES = {
  policy: path.join(ROOT, 'data', 'v13-16-operational-policy.json'),
  center: path.join(ROOT, 'data', 'quant', 'unified-autonomous-center-v13-14.json'),
  ledger: path.join(ROOT, 'data', 'evidence', 'paper-signals-v13-15.json'),
  health: path.join(ROOT, 'data', 'quant', 'strategy-health-v13-15.json'),
  ops: path.join(ROOT, 'data', 'ops', 'operational-health-v13-16.json'),
  reportDir: path.join(ROOT, 'data', 'reports', 'daily'),
  revisionDir: path.join(ROOT, 'data', 'reports', 'revisions'),
  index: path.join(ROOT, 'data', 'reports', 'index-v13-16.json')
};

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, file);
}
function A(value) { return Array.isArray(value) ? value : []; }
function n(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function dateOnly(value) {
  const match = String(value || '').match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      if (key !== 'reportHash') acc[key] = stable(value[key]);
      return acc;
    }, {});
  }
  return value;
}
function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
function statusCounts(signals) {
  return signals.reduce((acc, signal) => {
    acc[signal.status] = (acc[signal.status] || 0) + 1;
    return acc;
  }, {});
}
function markdown(report) {
  const lines = [
    `# تقرير جلسة ${report.sessionDate}`,
    '',
    `- حالة التشغيل: **${report.operationalStateLabelAr}**`,
    `- الأول فنيًا: **${report.ranking.technicalLeader?.ticker || '—'}**`,
    `- أول B للمراقبة: **${report.ranking.tierBLeader?.ticker || '—'}**`,
    `- الجاهز ورقيًا: **${report.ranking.readyCandidate?.ticker || 'لا يوجد'}**`,
    `- إشارات جديدة: **${report.activity.newSignals}**`,
    `- دخول جديد: **${report.activity.enteredToday}**`,
    `- صفقات مغلقة: **${report.activity.closedToday}**`,
    `- منتهية دون دخول: **${report.activity.expiredToday}**`,
    '',
    '## حالة الاستراتيجيات',
    ''
  ];
  for (const item of report.strategies) {
    lines.push(`- ${item.strategyId}: ${item.status} — صفقات مغلقة ${item.closedTrades}, PF ${item.profitFactor}, Average R ${item.averageR}`);
  }
  lines.push('', '## ملاحظات التشغيل', '');
  for (const warning of report.operationalWarnings) lines.push(`- تحذير: ${warning}`);
  if (!report.operationalWarnings.length) lines.push('- لا توجد تحذيرات تشغيلية.');
  lines.push('', `بصمة التقرير: \`${report.reportHash}\``);
  return lines.join('\n') + '\n';
}

const policy = readJson(FILES.policy);
const center = readJson(FILES.center);
const ledger = readJson(FILES.ledger, { signals: [] });
const health = readJson(FILES.health, { strategies: [], summary: {} });
const ops = readJson(FILES.ops, { state: 'UNKNOWN', warnings: [], critical: [] });
if (!policy || !center) throw new Error('Missing operational policy or unified center');

const sessionDate = dateOnly(center.analysisSession) || dateOnly(center.marketDate);
if (!sessionDate) throw new Error('Cannot resolve report session date');
const signals = A(ledger.signals);
const newSignals = signals.filter(signal => signal.signalDate === sessionDate);
const entered = signals.filter(signal => signal.entryDate === sessionDate);
const closed = signals.filter(signal => signal.exitDate === sessionDate && String(signal.status).startsWith('CLOSED'));
const expired = signals.filter(signal =>
  signal.status === 'EXPIRED_NO_ENTRY' &&
  (signal.evaluatedThrough === sessionDate || signal.exitDate === sessionDate)
);
const maxRanking = n(policy.dailyReport.maximumRankingRows, 15);
const maxClosed = n(policy.dailyReport.maximumClosedRows, 30);

const report = {
  schemaVersion: '13.17.0',
  generatedAt: new Date().toISOString(),
  sessionDate,
  analysisSession: center.analysisSession || null,
  marketDate: center.marketDate || null,
  operationalState: ops.state || 'UNKNOWN',
  operationalStateLabelAr: ops.stateLabelAr || 'غير متاح',
  immutablePaperEvidence: ledger.immutableRegistration === true,
  activity: {
    newSignals: newSignals.length,
    enteredToday: entered.length,
    closedToday: closed.length,
    expiredToday: expired.length,
    totalRegistered: signals.length,
    totalClosed: n(health?.summary?.closedTrades, 0),
    statusCounts: statusCounts(signals)
  },
  ranking: {
    technicalLeader: center.technicalLeader ? {
      ticker: center.technicalLeader.ticker,
      companyNameAr: center.technicalLeader.companyNameAr,
      tier: center.technicalLeader.tier,
      technicalRank: center.technicalLeader.technicalRank,
      decision: center.technicalLeader.finalDecision?.code,
      decisionLabelAr: center.technicalLeader.finalDecision?.labelAr
    } : null,
    tierBLeader: center.tierBLeader ? {
      ticker: center.tierBLeader.ticker,
      companyNameAr: center.tierBLeader.companyNameAr,
      technicalRank: center.tierBLeader.technicalRank,
      decision: center.tierBLeader.finalDecision?.code,
      decisionLabelAr: center.tierBLeader.finalDecision?.labelAr
    } : null,
    readyCandidate: center.readyCandidate ? {
      ticker: center.readyCandidate.ticker,
      companyNameAr: center.readyCandidate.companyNameAr,
      technicalRank: center.readyCandidate.technicalRank,
      decision: center.readyCandidate.finalDecision?.code
    } : null,
    top: A(center.candidates).slice(0, maxRanking).map(item => ({
      technicalRank: item.technicalRank,
      ticker: item.ticker,
      companyNameAr: item.companyNameAr,
      tier: item.tier,
      recommendationScore: item.recommendationScore,
      decision: item.finalDecision?.code,
      decisionLabelAr: item.finalDecision?.labelAr,
      strategyId: item.strategyId,
      strategyStatus: item.strategyValidationStatus
    }))
  },
  sessionSignals: newSignals.map(signal => ({
    id: signal.id,
    ticker: signal.ticker,
    strategyId: signal.strategyId,
    tier: signal.tier,
    entryLow: signal.entryLow,
    entryHigh: signal.entryHigh,
    stopLoss: signal.stopLoss,
    target1: signal.target1,
    status: signal.status
  })),
  closedToday: closed.slice(0, maxClosed).map(signal => ({
    id: signal.id,
    ticker: signal.ticker,
    strategyId: signal.strategyId,
    outcome: signal.outcome,
    netR: signal.netR,
    entryDate: signal.entryDate,
    exitDate: signal.exitDate
  })),
  strategies: A(health.strategies).map(item => ({
    strategyId: item.strategyId,
    strategyNameAr: item.strategyNameAr || item.strategyId,
    status: item.status,
    registeredSignals: n(item.metrics?.registeredSignals, 0),
    closedTrades: n(item.metrics?.closedTrades, 0),
    profitFactor: n(item.metrics?.profitFactor, 0),
    averageR: n(item.metrics?.averageR, 0),
    medianR: n(item.metrics?.medianR, 0),
    maxDrawdownPct: n(item.metrics?.maxDrawdownPct, 0),
    forwardSessions: n(item.metrics?.forwardSessions, 0)
  })),
  operationalWarnings: [...A(ops.critical), ...A(ops.warnings)],
  strategyRulesChanged: false,
  rankingRulesChanged: false,
  productionDecisionRulesChanged: false
};
report.reportHash = hash(report);

fs.mkdirSync(FILES.reportDir, { recursive: true });
const sessionFile = path.join(FILES.reportDir, `${sessionDate}.json`);
const previous = readJson(sessionFile);
if (previous && previous.reportHash !== report.reportHash && policy.dailyReport.archivePreviousRevision === true) {
  const stamp = String(previous.generatedAt || new Date().toISOString()).replace(/[:.]/g, '-');
  const revisionFile = path.join(FILES.revisionDir, sessionDate, `${stamp}.json`);
  writeJson(revisionFile, previous);
}
writeJson(sessionFile, report);
writeJson(path.join(FILES.reportDir, 'latest.json'), report);
fs.writeFileSync(path.join(FILES.reportDir, 'latest.md'), markdown(report), 'utf8');

const files = fs.readdirSync(FILES.reportDir)
  .filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
  .sort();
const entries = files.map(name => {
  const item = readJson(path.join(FILES.reportDir, name), {});
  return {
    sessionDate: item.sessionDate || name.replace('.json', ''),
    generatedAt: item.generatedAt || null,
    reportHash: item.reportHash || null,
    operationalState: item.operationalState || null,
    newSignals: n(item.activity?.newSignals, 0),
    closedToday: n(item.activity?.closedToday, 0)
  };
});
writeJson(FILES.index, {
  schemaVersion: '13.17.0',
  generatedAt: new Date().toISOString(),
  totalReports: entries.length,
  latestSession: entries.at(-1)?.sessionDate || null,
  reports: entries
});
console.log(`V13.17 daily report: session=${sessionDate}, new=${newSignals.length}, entered=${entered.length}, closed=${closed.length}.`);
