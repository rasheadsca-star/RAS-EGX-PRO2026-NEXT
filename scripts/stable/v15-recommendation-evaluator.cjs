#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DECISION_PATH = path.join(ROOT, 'data/stable/v15-practical-decision.json');
const LEDGER_PATH = path.join(ROOT, 'data/stable/v15-recommendation-ledger.json');
const REPORT_PATH = path.join(ROOT, 'data/stable/v15-recommendation-evaluation.json');
const HISTORY_DIR = path.join(ROOT, 'data/history');
const DECISION_REPO_PATH = 'data/stable/v15-practical-decision.json';
const AUDIT_START_AT = process.env.EGX_RECOMMENDATION_EVAL_START || '2026-08-02T22:10:00.000Z';
const MAX_GIT_SNAPSHOTS = Math.max(20, Math.min(Number(process.env.EGX_EVAL_GIT_SNAPSHOTS || 160), 500));
const MAX_LEDGER_RECORDS = Math.max(100, Math.min(Number(process.env.EGX_EVAL_MAX_RECORDS || 2500), 10000));

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function num(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function round(value, digits = 4) {
  const parsed = num(value);
  return parsed === null ? null : Number(parsed.toFixed(digits));
}
function dateOnly(value) {
  return (String(value || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
}
function iso(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}
function warnings(row) { return Array.isArray(row?.warnings) ? row.warnings.map(String) : []; }
function trustedSession(row) {
  if (!(num(row?.close) > 0)) return false;
  if (String(row?.validationStatus || '') === 'source_conflict') return false;
  if (warnings(row).some(item => /local_price_conflict|latest_close_conflict/i.test(item))) return false;
  const confidence = num(row?.confidence?.overall);
  if (confidence !== null && confidence < 60) return false;
  return true;
}
function validDecision(decision) {
  if (!decision || decision.practicalReady !== true) return false;
  if (!dateOnly(decision.sessionDate)) return false;
  if (!Array.isArray(decision.recommendations) || decision.recommendations.length === 0) return false;
  const generatedAt = iso(decision.generatedAt);
  if (generatedAt && generatedAt < AUDIT_START_AT) return false;
  if (decision.expectedLatestSession && decision.sessionDate !== decision.expectedLatestSession) return false;
  if (decision.priceTruth?.ready !== true || decision.priceTruth?.executionGrade !== true) return false;
  return true;
}
function loadGitDecisionSnapshots() {
  const snapshots = [];
  try {
    const output = execFileSync('git', ['log', `--max-count=${MAX_GIT_SNAPSHOTS}`, '--format=%H', '--', DECISION_REPO_PATH], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024
    });
    const hashes = output.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
    for (const hash of hashes) {
      try {
        const text = execFileSync('git', ['show', `${hash}:${DECISION_REPO_PATH}`], {
          cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024
        });
        const decision = JSON.parse(text);
        if (validDecision(decision)) snapshots.push({ decision, commit: hash });
      } catch {}
    }
  } catch {}
  return snapshots;
}
function bestSnapshots() {
  const snapshots = loadGitDecisionSnapshots();
  const current = readJson(DECISION_PATH, null);
  if (validDecision(current)) snapshots.push({ decision: current, commit: 'WORKTREE' });
  const bySession = new Map();
  for (const item of snapshots) {
    const date = dateOnly(item.decision.sessionDate);
    const old = bySession.get(date);
    const currentTime = Date.parse(item.decision.generatedAt || 0) || 0;
    const oldTime = Date.parse(old?.decision?.generatedAt || 0) || 0;
    if (!old || currentTime >= oldTime) bySession.set(date, item);
  }
  return [...bySession.values()].sort((a, b) => String(a.decision.sessionDate).localeCompare(String(b.decision.sessionDate)));
}
function recordFromRecommendation(decision, recommendation, sourceCommit) {
  const recommendationDate = dateOnly(decision.sessionDate);
  const ticker = String(recommendation.ticker || '').trim().toUpperCase();
  const strategyId = String(recommendation.strategyId || 'UNKNOWN');
  if (!recommendationDate || !ticker) return null;
  const entryLow = num(recommendation.entryLow);
  const entryHigh = num(recommendation.entryHigh);
  const stopLoss = num(recommendation.stopLoss);
  const target1 = num(recommendation.target1);
  if (!(entryLow > 0 && entryHigh >= entryLow && stopLoss > 0 && stopLoss < entryLow && target1 > entryHigh)) return null;
  return {
    id: `${recommendationDate}|${ticker}|${strategyId}`,
    recommendationDate,
    sourceDecisionGeneratedAt: decision.generatedAt || null,
    sourceCommit,
    ticker,
    companyNameAr: recommendation.companyNameAr || ticker,
    rank: num(recommendation.rank, null),
    strategyId,
    strategyLabelAr: recommendation.strategyLabelAr || strategyId,
    profile: recommendation.profile || null,
    recommendationClose: round(recommendation.close),
    entryLow: round(entryLow),
    entryHigh: round(entryHigh),
    stopLoss: round(stopLoss),
    target1: round(target1),
    holdingSessions: Math.max(1, Math.min(num(recommendation.holdingSessions, 3), 10)),
    transactionCostsPct: Math.max(0, num(decision.guardrails?.transactionCostsPct, 0)),
    estimatedTargetProbabilityPct: round(recommendation.estimatedTargetProbabilityPct, 2),
    estimatedStopProbabilityPct: round(recommendation.estimatedStopProbabilityPct, 2),
    outOfSampleAverageReturnPct: round(recommendation.outOfSampleAverageReturnPct, 3),
    outOfSampleProfitFactor: round(recommendation.outOfSampleProfitFactor, 3),
    archivedAt: new Date().toISOString()
  };
}
function archiveRecommendations(existingRecords) {
  const byId = new Map(existingRecords.map(record => [record.id, record]));
  for (const snapshot of bestSnapshots()) {
    for (const recommendation of snapshot.decision.recommendations || []) {
      const fresh = recordFromRecommendation(snapshot.decision, recommendation, snapshot.commit);
      if (!fresh) continue;
      const old = byId.get(fresh.id);
      const canRefresh = !old || ['AWAITING_NEXT_SESSION', 'WAITING_ENTRY'].includes(old.evaluationStatus || '');
      byId.set(fresh.id, canRefresh ? { ...old, ...fresh, archivedAt: old?.archivedAt || fresh.archivedAt } : old);
    }
  }
  return [...byId.values()]
    .sort((a, b) => `${a.recommendationDate}|${String(a.rank || 99).padStart(3, '0')}|${a.ticker}`.localeCompare(`${b.recommendationDate}|${String(b.rank || 99).padStart(3, '0')}|${b.ticker}`))
    .slice(-MAX_LEDGER_RECORDS);
}
function historySessions(ticker) {
  const document = readJson(path.join(HISTORY_DIR, `${ticker}.json`), {});
  return (Array.isArray(document.sessions) ? document.sessions : [])
    .filter(trustedSession)
    .map(row => ({
      date: dateOnly(row.date || row.sessionDate),
      open: num(row.open, num(row.close)), high: num(row.high, num(row.close)),
      low: num(row.low, num(row.close)), close: num(row.close), volume: num(row.volume, 0)
    }))
    .filter(row => row.date && row.close > 0 && row.open > 0 && row.high >= Math.max(row.open, row.close) && row.low <= Math.min(row.open, row.close) && row.low > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}
function netReturnPct(exitPrice, entryPrice, costsPct) {
  if (!(entryPrice > 0 && exitPrice > 0)) return null;
  return round((exitPrice / entryPrice - 1) * 100 - costsPct, 3);
}
function evaluateRecord(record) {
  const sessions = historySessions(record.ticker).filter(row => row.date > record.recommendationDate);
  const next = sessions[0];
  const base = {
    ...record,
    evaluatedAt: new Date().toISOString(),
    entryDate: null, entryPrice: null, entryMode: null,
    exitDate: null, exitPrice: null, evaluationStatus: 'AWAITING_NEXT_SESSION', statusAr: 'بانتظار أول جلسة بعد التوصية',
    grossReturnPct: null, netReturnPct: null, maxFavorableExcursionPct: null, maxAdverseExcursionPct: null,
    sessionsObserved: sessions.length, evaluationWindowDates: []
  };
  if (!next) return base;

  const gapTolerance = 0.005;
  if (next.open > record.entryHigh * (1 + gapTolerance)) {
    return { ...base, evaluationStatus: 'CANCELLED_GAP_UP', statusAr: 'أُلغيت بسبب فجوة افتتاح أعلى من منطقة الدخول', exitDate: next.date, exitPrice: round(next.open) };
  }
  if (next.open < record.stopLoss) {
    return { ...base, evaluationStatus: 'CANCELLED_GAP_DOWN', statusAr: 'أُلغيت بسبب افتتاح أسفل وقف الخسارة', exitDate: next.date, exitPrice: round(next.open) };
  }
  if (next.low > record.entryHigh) {
    return { ...base, evaluationStatus: 'NOT_ENTERED_ABOVE_ZONE', statusAr: 'لم تدخل — السعر ظل أعلى من المنطقة', exitDate: next.date, exitPrice: round(next.close) };
  }
  if (next.high < record.entryLow) {
    return { ...base, evaluationStatus: 'NOT_ENTERED_BELOW_ZONE', statusAr: 'لم تدخل — السعر ظل أسفل المنطقة', exitDate: next.date, exitPrice: round(next.close) };
  }

  const openInZone = next.open >= record.entryLow && next.open <= record.entryHigh;
  const entryPrice = openInZone ? Math.max(next.open, record.entryLow) : record.entryHigh;
  const entryMode = openInZone ? 'OPEN_IN_ZONE' : 'INTRADAY_ZONE_TOUCH_CONSERVATIVE';
  const startIndex = openInZone ? 0 : 1;
  const evaluationSessions = sessions.slice(startIndex, startIndex + record.holdingSessions);
  let mfe = -Infinity;
  let mae = Infinity;
  let resolved = null;

  for (const session of evaluationSessions) {
    const favorable = (session.high / entryPrice - 1) * 100;
    const adverse = (session.low / entryPrice - 1) * 100;
    mfe = Math.max(mfe, favorable);
    mae = Math.min(mae, adverse);
    const targetTouched = session.high >= record.target1;
    const stopTouched = session.low <= record.stopLoss;
    if (targetTouched && stopTouched) {
      resolved = { status: 'STOP_HIT_AMBIGUOUS_CONSERVATIVE', statusAr: 'الهدف والوقف لُمسا في نفس الجلسة — حُسبت وقفًا تحفظيًا', session, exitPrice: record.stopLoss };
      break;
    }
    if (stopTouched) {
      resolved = { status: 'STOP_HIT', statusAr: 'تم ضرب وقف الخسارة', session, exitPrice: record.stopLoss };
      break;
    }
    if (targetTouched) {
      resolved = { status: 'TARGET_HIT', statusAr: 'تم تحقيق الهدف الأول', session, exitPrice: record.target1 };
      break;
    }
  }

  const common = {
    ...base,
    entryDate: next.date,
    entryPrice: round(entryPrice),
    entryMode,
    evaluationWindowDates: evaluationSessions.map(item => item.date),
    sessionsObserved: evaluationSessions.length,
    maxFavorableExcursionPct: Number.isFinite(mfe) ? round(mfe, 3) : null,
    maxAdverseExcursionPct: Number.isFinite(mae) ? round(mae, 3) : null
  };
  if (resolved) {
    const gross = (resolved.exitPrice / entryPrice - 1) * 100;
    return {
      ...common,
      evaluationStatus: resolved.status,
      statusAr: resolved.statusAr,
      exitDate: resolved.session.date,
      exitPrice: round(resolved.exitPrice),
      grossReturnPct: round(gross, 3),
      netReturnPct: netReturnPct(resolved.exitPrice, entryPrice, record.transactionCostsPct)
    };
  }

  const last = evaluationSessions.at(-1) || next;
  if (evaluationSessions.length < record.holdingSessions) {
    const gross = (last.close / entryPrice - 1) * 100;
    return {
      ...common,
      evaluationStatus: 'OPEN', statusAr: 'الصفقة ما زالت مفتوحة داخل مدة الخطة',
      exitDate: last.date, exitPrice: round(last.close), grossReturnPct: round(gross, 3),
      netReturnPct: netReturnPct(last.close, entryPrice, record.transactionCostsPct)
    };
  }
  const gross = (last.close / entryPrice - 1) * 100;
  const net = netReturnPct(last.close, entryPrice, record.transactionCostsPct);
  const positive = net > 0.05;
  const negative = net < -0.05;
  return {
    ...common,
    evaluationStatus: positive ? 'EXPIRED_POSITIVE' : negative ? 'EXPIRED_NEGATIVE' : 'EXPIRED_FLAT',
    statusAr: positive ? 'انتهت المدة على ربح دون بلوغ الهدف' : negative ? 'انتهت المدة على خسارة دون ضرب الوقف' : 'انتهت المدة قرب نقطة التعادل',
    exitDate: last.date, exitPrice: round(last.close), grossReturnPct: round(gross, 3), netReturnPct: net
  };
}
function isEntered(record) { return !!record.entryDate; }
function isResolvedTrade(record) { return ['TARGET_HIT', 'STOP_HIT', 'STOP_HIT_AMBIGUOUS_CONSERVATIVE', 'EXPIRED_POSITIVE', 'EXPIRED_NEGATIVE', 'EXPIRED_FLAT'].includes(record.evaluationStatus); }
function isPositive(record) { return ['TARGET_HIT', 'EXPIRED_POSITIVE'].includes(record.evaluationStatus); }
function summarize(records) {
  const entered = records.filter(isEntered);
  const resolved = records.filter(isResolvedTrade);
  const returns = resolved.map(item => num(item.netReturnPct)).filter(value => value !== null);
  const positiveReturns = returns.filter(value => value > 0);
  const negativeReturns = returns.filter(value => value < 0);
  const targetHits = records.filter(item => item.evaluationStatus === 'TARGET_HIT').length;
  const stopHits = records.filter(item => ['STOP_HIT', 'STOP_HIT_AMBIGUOUS_CONSERVATIVE'].includes(item.evaluationStatus)).length;
  const positives = resolved.filter(isPositive).length;
  const sum = values => values.reduce((total, value) => total + value, 0);
  return {
    archivedRecommendations: records.length,
    enteredTrades: entered.length,
    resolvedTrades: resolved.length,
    openTrades: records.filter(item => item.evaluationStatus === 'OPEN').length,
    awaitingNextSession: records.filter(item => item.evaluationStatus === 'AWAITING_NEXT_SESSION').length,
    notEnteredOrCancelled: records.filter(item => /^(NOT_ENTERED|CANCELLED)/.test(item.evaluationStatus)).length,
    targetHits,
    stopHits,
    expiredPositive: records.filter(item => item.evaluationStatus === 'EXPIRED_POSITIVE').length,
    expiredNegative: records.filter(item => item.evaluationStatus === 'EXPIRED_NEGATIVE').length,
    expiredFlat: records.filter(item => item.evaluationStatus === 'EXPIRED_FLAT').length,
    profitableResolvedTrades: positives,
    losingResolvedTrades: resolved.length - positives,
    successRatePct: resolved.length ? round(positives / resolved.length * 100, 2) : null,
    targetVsStopRatePct: targetHits + stopHits ? round(targetHits / (targetHits + stopHits) * 100, 2) : null,
    averageNetReturnPct: returns.length ? round(sum(returns) / returns.length, 3) : null,
    cumulativeNetReturnPct: returns.length ? round(sum(returns), 3) : null,
    profitFactor: negativeReturns.length ? round(sum(positiveReturns) / Math.abs(sum(negativeReturns)), 3) : positiveReturns.length ? 99 : null
  };
}
function byStrategy(records) {
  const groups = new Map();
  for (const record of records) {
    const list = groups.get(record.strategyId) || [];
    list.push(record); groups.set(record.strategyId, list);
  }
  return [...groups.entries()].map(([strategyId, list]) => ({
    strategyId,
    strategyLabelAr: list[0]?.strategyLabelAr || strategyId,
    ...summarize(list)
  })).sort((a, b) => (b.resolvedTrades - a.resolvedTrades) || String(a.strategyId).localeCompare(String(b.strategyId)));
}
function main() {
  const existing = readJson(LEDGER_PATH, { records: [] });
  const archived = archiveRecommendations(Array.isArray(existing.records) ? existing.records : []);
  const evaluated = archived.map(evaluateRecord);
  const generatedAt = new Date().toISOString();
  const ledger = {
    schemaVersion: '15.0.0', generatedAt, auditStartAt: AUDIT_START_AT,
    methodologyVersion: 'V15_CONSERVATIVE_DAILY_OHLC_1.0', records: evaluated
  };
  const recent = [...evaluated].sort((a, b) => `${b.recommendationDate}|${String(b.rank || 99).padStart(3, '0')}`.localeCompare(`${a.recommendationDate}|${String(a.rank || 99).padStart(3, '0')}`));
  const report = {
    schemaVersion: '15.0.0', generatedAt, auditStartAt: AUDIT_START_AT,
    titleAr: 'تقييم التوصيات السابقة',
    methodology: {
      version: 'V15_CONSERVATIVE_DAILY_OHLC_1.0',
      entryRuleAr: 'التوصية صالحة لأول جلسة تالية فقط. لا يُحتسب دخول عند فجوة أعلى من المنطقة أو افتتاح أسفل الوقف.',
      intradayRuleAr: 'عند لمس منطقة الدخول أثناء الجلسة يُستخدم الحد الأعلى كسعر دخول تحفظي، ويبدأ فحص الهدف والوقف من الجلسة التالية لعدم معرفة ترتيب الحركة داخل اليوم.',
      ambiguityRuleAr: 'إذا لمس الهدف والوقف في الجلسة نفسها تُحسب النتيجة وقف خسارة تحفظيًا.',
      costsRuleAr: 'العائد الصافي يخصم تكاليف التداول المستخدمة في اختبار النموذج.',
      trustedHistoryOnly: true
    },
    summary: summarize(evaluated),
    byStrategy: byStrategy(evaluated),
    records: recent
  };
  writeJson(LEDGER_PATH, ledger);
  writeJson(REPORT_PATH, report);
  console.log(JSON.stringify({ summary: report.summary, currentArchived: recent.slice(0, 5).map(item => ({ id: item.id, status: item.evaluationStatus })) }, null, 2));
}

main();
