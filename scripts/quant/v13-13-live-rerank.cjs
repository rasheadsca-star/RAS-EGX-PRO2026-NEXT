#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const DATA = path.join(ROOT, 'data');
const Q = path.join(DATA, 'quant');
const FILES = {
  policy: path.join(DATA, 'v13-13-daily-pipeline-policy.json'),
  daily: path.join(Q, 'daily-decision-workspace-v13-11.json'),
  intraday: path.join(DATA, 'intraday', 'latest.json'),
  previous: path.join(Q, 'live-reranked-decision-v13-13.json'),
  output: path.join(Q, 'live-reranked-decision-v13-13.json'),
  alerts: path.join(DATA, 'intraday', 'live-ranking-alerts-v13-13.json')
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
function n(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function round(value, digits = 2) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}
function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, n(value)));
}
function safeTicker(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
}
function cairoDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(value).reduce((acc, part) => (acc[part.type] = part.value, acc), {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function stateAdjustment(state, policy) {
  return n(policy.liveRanking.stateAdjustments?.[state], 0);
}
function momentumAdjustment(changePct, policy) {
  const max = n(policy.liveRanking.maximumMomentumAdjustment, 8);
  return Math.max(-max, Math.min(max, n(changePct) * 1.5));
}
function turnoverAdjustment(pace, policy) {
  const max = n(policy.liveRanking.maximumTurnoverPaceAdjustment, 8);
  if (!(n(pace) > 0)) return 0;
  return Math.max(-2, Math.min(max, (n(pace) - 1) * 5));
}
function tierWeight(tier, policy) {
  return n(policy.liveRanking.tierWeights?.[tier], 0);
}
function liveReason(row, candidate) {
  if (!row) return 'لا توجد لقطة جلسة حديثة لهذا السهم؛ تم خفض ترتيبه الحي.';
  const state = row.stateLabelAr || row.state || 'مراقبة';
  const parts = [`الحالة الحالية: ${state}`];
  if (Number.isFinite(Number(row.changePct))) parts.push(`تغير الجلسة ${round(row.changePct, 2)}%`);
  if (Number.isFinite(Number(row.turnoverPaceRatio))) parts.push(`سرعة التداول ${round(row.turnoverPaceRatio, 2)}×`);
  if (row.stale) parts.push('البيانات قديمة');
  if (candidate.tier === 'TIER_B_PRIORITY_WATCH') parts.push('الطبقة B تظل مراقبة فقط');
  return parts.join(' — ');
}
function main() {
  const generatedAt = new Date().toISOString();
  const policy = readJson(FILES.policy);
  const daily = readJson(FILES.daily);
  const intraday = readJson(FILES.intraday, { rows: [] });
  const previous = readJson(FILES.previous, { candidates: [] });
  if (!policy || !daily) throw new Error('Missing V13.13 policy or V13.11 daily decision output');

  const intradayMap = new Map(A(intraday.rows).map(row => [safeTicker(row.ticker), row]));
  const previousMap = new Map(A(previous.candidates).map(row => [safeTicker(row.ticker), row]));
  const today = cairoDate();
  const marketDate = intraday.cairoDate || null;
  const marketCurrent = marketDate === today;

  const candidates = A(daily.candidates).map(candidate => {
    const ticker = safeTicker(candidate.ticker);
    const row = intradayMap.get(ticker) || null;
    const baselineScore = n(candidate.decisionScore, n(candidate.recommendationScore, 0));
    const base = baselineScore * n(policy.liveRanking.baselineDecisionScoreWeight, 0.7);
    const stateAdj = row ? stateAdjustment(row.state, policy) : 0;
    const momentumAdj = row ? momentumAdjustment(row.changePct, policy) : 0;
    const paceAdj = row ? turnoverAdjustment(row.turnoverPaceRatio, policy) : 0;
    const freshnessPenalty = !row
      ? n(policy.liveRanking.missingIntradayPenalty, 18)
      : row.stale || !marketCurrent
        ? n(policy.liveRanking.stalePenalty, 30)
        : 0;
    const liveScore = clamp(
      tierWeight(candidate.tier, policy) + base + stateAdj + momentumAdj + paceAdj - freshnessPenalty
    );
    return {
      ticker,
      companyNameAr: candidate.companyNameAr || row?.companyNameAr || '',
      companyNameEn: candidate.companyNameEn || row?.companyNameEn || '',
      sector: candidate.sector || row?.sector || 'غير مصنف',
      baselineRank: n(candidate.rank, 999),
      baselineTier: candidate.tier,
      baselineTierLabelAr: candidate.tierLabelAr,
      baselineActionCode: candidate.actionCode,
      actionablePaper: candidate.actionablePaper === true,
      recommendationScore: candidate.recommendationScore,
      baselineDecisionScore: candidate.decisionScore,
      liveDecisionScore: round(liveScore, 1),
      state: row?.state || 'NO_INTRADAY_DATA',
      stateLabelAr: row?.stateLabelAr || 'لا توجد بيانات جلسة',
      price: row?.price ?? candidate.stock?.price ?? null,
      changePct: row?.changePct ?? null,
      moveSincePreviousSnapshotPct: row?.priceMoveSincePreviousSnapshotPct ?? null,
      turnover: row?.turnover ?? null,
      turnoverPaceRatio: row?.turnoverPaceRatio ?? null,
      dataAgeMinutes: row?.dataAgeMinutes ?? null,
      stale: !row || row.stale === true || !marketCurrent,
      source: row?.source || null,
      fetchedAt: row?.fetchedAt || null,
      plan: candidate.plan || null,
      hardFailureCount: candidate.hardFailureCount,
      softFailureCount: candidate.softFailureCount,
      softFailures: candidate.softFailures || [],
      liveAdjustments: {
        tierWeight: tierWeight(candidate.tier, policy),
        baselineComponent: round(base, 1),
        stateAdjustment: round(stateAdj, 1),
        momentumAdjustment: round(momentumAdj, 1),
        turnoverPaceAdjustment: round(paceAdj, 1),
        freshnessPenalty: round(freshnessPenalty, 1)
      },
      reasonAr: liveReason(row, candidate),
      tierChangedIntraday: false,
      liveExecutionEnabled: false
    };
  }).sort((a, b) =>
    n(b.liveDecisionScore) - n(a.liveDecisionScore) ||
    n(a.baselineRank, 999) - n(b.baselineRank, 999) ||
    a.ticker.localeCompare(b.ticker)
  ).map((item, index) => ({
    ...item,
    liveRank: index + 1,
    rankChange: item.baselineRank - (index + 1)
  }));

  const rankingAlerts = [];
  for (const item of candidates) {
    const old = previousMap.get(item.ticker);
    if (!old || previous.marketSnapshotGeneratedAt === intraday.generatedAt) continue;
    const change = n(old.liveRank, item.liveRank) - item.liveRank;
    if (Math.abs(change) >= 3) {
      rankingAlerts.push({
        id: `${marketDate || today}:${item.ticker}:rank:${item.liveRank}`,
        generatedAt,
        level: change > 0 ? 'opportunity' : 'warning',
        ticker: item.ticker,
        titleAr: change > 0
          ? `${item.ticker}: تحسن ${Math.abs(change)} مراكز في الترتيب الحي`
          : `${item.ticker}: تراجع ${Math.abs(change)} مراكز في الترتيب الحي`,
        detailAr: `الترتيب السابق ${old.liveRank} والحالي ${item.liveRank}.`,
        actionAr: 'راجع السعر والحجم والخطة؛ الترتيب الحي لا يغير طبقة التوصية اليومية.',
        previousRank: old.liveRank,
        currentRank: item.liveRank
      });
    }
  }

  const output = {
    schemaVersion: '13.13.0',
    generatedAt,
    analysisSessionId: daily.sessionId || null,
    marketSnapshotDate: marketDate,
    marketSnapshotGeneratedAt: intraday.generatedAt || null,
    marketSnapshotCurrent: marketCurrent,
    marketSessionState: intraday.marketSessionState || null,
    publicDelayedData: true,
    liveExecutionEnabled: false,
    intradayTierPromotionEnabled: false,
    status: candidates.length
      ? marketCurrent ? 'LIVE_RERANK_AVAILABLE' : 'BASELINE_WITH_STALE_INTRADAY'
      : 'NO_CANDIDATES',
    counts: {
      candidates: candidates.length,
      actionablePaper: candidates.filter(x => x.actionablePaper).length,
      stale: candidates.filter(x => x.stale).length,
      entryZone: candidates.filter(x => x.state === 'ENTRY_ZONE').length,
      riskStates: candidates.filter(x => ['STOP_BREACHED', 'SUPPORT_BROKEN'].includes(x.state)).length
    },
    topCandidates: candidates.slice(0, n(policy.liveRanking.maximumDisplayedCandidates, 10)),
    candidates,
    warningAr: 'الترتيب الحي يعيد ترتيب مرشحي التحليل اليومي بالسعر والحجم الحاليين، لكنه لا يرفع طبقة B إلى شراء ولا يرسل أوامر.'
  };
  const alertDoc = {
    schemaVersion: '13.13.0',
    generatedAt,
    newAlertCount: rankingAlerts.length,
    alerts: rankingAlerts
  };

  writeJson(FILES.output, output);
  writeJson(FILES.alerts, alertDoc);
  console.log(`V13.13 live rerank: status=${output.status}, analysis=${output.analysisSessionId}, market=${marketDate}, candidates=${candidates.length}`);
}

try { main(); }
catch (error) {
  console.error(`V13.13 live rerank failed: ${error.stack || error.message}`);
  process.exit(1);
}
