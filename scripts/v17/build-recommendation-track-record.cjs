#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = relative => path.join(root, relative);
const files = {
  current: P('data/v17/current.json'),
  nativeLedger: P('data/v17/ledger.json'),
  resilient: P('data/v17/resilient-session-status.json'),
  legacyEvaluation: P('data/stable/v15-recommendation-evaluation.json'),
  exactMethodLive: P('data/stable/v16-v169-live-evaluation.json'),
  research: P('data/research/v16-v169-basket-engine.json'),
  history: P('data/history.json'),
  output: P('data/v17/recommendation-track-record.json'),
};

function readJson(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, filePath);
}

function finite(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 4) {
  if (!Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function mean(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}

function profitFactor(values) {
  const clean = values.map(Number).filter(Number.isFinite);
  const gains = clean.filter(value => value > 0).reduce((sum, value) => sum + value, 0);
  const losses = Math.abs(clean.filter(value => value < 0).reduce((sum, value) => sum + value, 0));
  if (!losses) return gains > 0 ? null : 0;
  return gains / losses;
}

function maxDrawdown(values) {
  let equity = 1;
  let peak = 1;
  let worst = 0;
  for (const value of values.map(Number).filter(Number.isFinite)) {
    equity *= 1 + value / 100;
    peak = Math.max(peak, equity);
    worst = Math.min(worst, (equity / peak - 1) * 100);
  }
  return worst;
}

const current = readJson(files.current);
const ledger = readJson(files.nativeLedger, { entries: [] });
const resilient = readJson(files.resilient);
const legacyEvaluation = readJson(files.legacyEvaluation, { records: [] });
const exactLive = readJson(files.exactMethodLive, { sessions: [] });
const research = readJson(files.research);
const history = readJson(files.history, { sessionsBySymbol: {} });
const sessionsBySymbol = history.sessionsBySymbol || {};
const COST_PCT = 0.6;
const TRUSTED_HISTORY_QUALITIES = new Set([
  'recovered_from_repository_snapshot_using_git_commit_date',
  'public_automated_historical_backfill',
  'daily_public_snapshot',
  'trusted_public_ohlc',
  'direct_verified_ohlc',
]);

function trustedSessions(ticker, afterDate = null) {
  const rows = Array.isArray(sessionsBySymbol[String(ticker || '').toUpperCase()])
    ? sessionsBySymbol[String(ticker || '').toUpperCase()]
    : [];
  return rows
    .filter(row => !afterDate || String(row.date || '') > String(afterDate))
    .filter(row => [row.open, row.high, row.low, row.close].every(value => finite(value) !== null))
    .filter(row => TRUSTED_HISTORY_QUALITIES.has(String(row.sourceQuality || '')))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function conservativeBackfill(record) {
  const recommendationDate = record.recommendationDate || record.signalDate;
  const ticker = String(record.ticker || '').toUpperCase();
  const entryLow = finite(record.entryLow);
  const entryHigh = finite(record.entryHigh);
  const stop = finite(record.stopLoss ?? record.stop);
  const target = finite(record.target1 ?? record.target);
  const holdingSessions = Math.max(1, Math.trunc(finite(record.holdingSessions, 1)));
  if (!ticker || !recommendationDate || ![entryLow, entryHigh, stop, target].every(Number.isFinite)) {
    return { status: 'INSUFFICIENT_SIGNAL_FIELDS', resolved: false, evidenceQuality: 'UNUSABLE' };
  }

  const rows = trustedSessions(ticker, recommendationDate);
  if (!rows.length) {
    return { status: 'PENDING_TRUSTED_HISTORY', resolved: false, evidenceQuality: 'NO_TRUSTED_NEXT_SESSION' };
  }

  const first = rows[0];
  const open = finite(first.open);
  const high = finite(first.high);
  const low = finite(first.low);
  if (open > entryHigh) {
    return {
      status: 'NOT_ENTERED_GAP_ABOVE_RANGE', resolved: true, entered: false,
      outcomeDate: first.date, netReturnPct: 0, evidenceQuality: 'TRUSTED_OHLC',
    };
  }
  if (open < stop) {
    return {
      status: 'NOT_ENTERED_OPEN_BELOW_STOP', resolved: true, entered: false,
      outcomeDate: first.date, netReturnPct: 0, evidenceQuality: 'TRUSTED_OHLC',
    };
  }

  let entryPrice = null;
  let entryDate = null;
  let scanStartIndex = 0;
  let entryMode = null;
  if (open >= entryLow && open <= entryHigh) {
    entryPrice = open;
    entryDate = first.date;
    entryMode = 'OPEN_INSIDE_RANGE';
  } else if (open < entryLow && high >= entryLow) {
    entryPrice = high >= entryHigh ? entryHigh : Math.max(entryLow, Math.min(entryHigh, high));
    entryDate = first.date;
    entryMode = 'INTRADAY_RANGE_TOUCH_CONSERVATIVE';
    scanStartIndex = 1;
  } else {
    return {
      status: 'NOT_ENTERED_RANGE_NOT_TOUCHED', resolved: true, entered: false,
      outcomeDate: first.date, netReturnPct: 0, evidenceQuality: 'TRUSTED_OHLC',
    };
  }

  const scanRows = rows.slice(scanStartIndex, scanStartIndex + holdingSessions);
  if (!scanRows.length) {
    return {
      status: 'ENTERED_AWAITING_TRUSTED_OUTCOME', resolved: false, entered: true,
      entryDate, entryPrice: round(entryPrice), entryMode, evidenceQuality: 'TRUSTED_OHLC',
    };
  }

  for (let i = 0; i < scanRows.length; i += 1) {
    const row = scanRows[i];
    const targetTouched = finite(row.high) >= target;
    const stopTouched = finite(row.low) <= stop;
    if (targetTouched || stopTouched) {
      const ambiguous = targetTouched && stopTouched;
      const exitPrice = ambiguous || stopTouched ? stop : target;
      const grossReturnPct = (exitPrice / entryPrice - 1) * 100;
      return {
        status: ambiguous ? 'AMBIGUOUS_TREATED_AS_STOP' : stopTouched ? 'STOP_TOUCHED' : 'TARGET_TOUCHED',
        resolved: true,
        entered: true,
        entryDate,
        entryPrice: round(entryPrice),
        entryMode,
        outcomeDate: row.date,
        exitPrice: round(exitPrice),
        targetTouched,
        stopTouched,
        ambiguousSameSession: ambiguous,
        grossReturnPct: round(grossReturnPct),
        netReturnPct: round(grossReturnPct - COST_PCT),
        evidenceQuality: 'TRUSTED_OHLC',
      };
    }
  }

  if (scanRows.length < holdingSessions) {
    return {
      status: 'ENTERED_AWAITING_FULL_HOLDING_WINDOW', resolved: false, entered: true,
      entryDate, entryPrice: round(entryPrice), entryMode,
      sessionsObserved: scanRows.length, evidenceQuality: 'TRUSTED_OHLC',
    };
  }

  const last = scanRows.at(-1);
  const exitPrice = finite(last.close);
  const grossReturnPct = (exitPrice / entryPrice - 1) * 100;
  return {
    status: 'TIME_EXIT', resolved: true, entered: true,
    entryDate, entryPrice: round(entryPrice), entryMode,
    outcomeDate: last.date, exitPrice: round(exitPrice),
    grossReturnPct: round(grossReturnPct),
    netReturnPct: round(grossReturnPct - COST_PCT),
    evidenceQuality: 'TRUSTED_OHLC',
  };
}

function compactLegacyRecord(record) {
  const storedResolved = finite(record.netReturnPct) !== null;
  const backfill = storedResolved ? null : conservativeBackfill(record);
  const status = storedResolved ? record.evaluationStatus : backfill.status;
  const netReturnPct = storedResolved ? finite(record.netReturnPct) : finite(backfill.netReturnPct);
  return {
    id: record.id || `${record.recommendationDate}|${record.ticker}|${record.strategyId}`,
    recommendationDate: record.recommendationDate || null,
    ticker: record.ticker || null,
    companyNameAr: record.companyNameAr || null,
    rank: finite(record.rank),
    strategyId: record.strategyId || null,
    strategyLabelAr: record.strategyLabelAr || null,
    entryLow: finite(record.entryLow),
    entryHigh: finite(record.entryHigh),
    stop: finite(record.stopLoss),
    target: finite(record.target1),
    holdingSessions: finite(record.holdingSessions),
    status,
    statusAr: record.statusAr || null,
    entered: storedResolved ? finite(record.entryPrice) !== null : backfill.entered === true,
    entryDate: storedResolved ? record.entryDate || null : backfill.entryDate || null,
    outcomeDate: storedResolved ? record.exitDate || null : backfill.outcomeDate || null,
    netReturnPct: round(netReturnPct),
    provenance: storedResolved
      ? 'RECORDED_ORIGINAL_EVALUATION'
      : backfill.resolved
        ? 'RECORDED_SIGNAL_RETROACTIVE_TRUSTED_OHLC_BACKFILL'
        : 'RECORDED_SIGNAL_PENDING_TRUSTED_HISTORY',
    evidenceClass: 'RECORDED_BACKFILL_NOT_NATIVE_V17_LIVE',
    countsTowardNativeV17Gate: false,
  };
}

const legacyRecords = (Array.isArray(legacyEvaluation.records) ? legacyEvaluation.records : []).map(compactLegacyRecord);
const legacyResolvedReturns = legacyRecords.map(row => finite(row.netReturnPct)).filter(Number.isFinite);
const exactLegacyRecords = legacyRecords.filter(row => row.strategyId === 'V16_9_EQUAL_WEIGHT_BASKET');

function compactExactLiveSession(session) {
  const resolved = session.status === 'RESOLVED' && finite(session.netReturnPct) !== null;
  let backfilledMembers = [];
  let backfilledNet = null;
  let backfillComplete = false;
  if (!resolved && Array.isArray(session.members)) {
    backfilledMembers = session.members.map(member => conservativeBackfill({
      recommendationDate: session.signalDate,
      ticker: member.ticker,
      entryLow: member.entryLow,
      entryHigh: member.entryHigh,
      stopLoss: member.stopLoss,
      target1: member.target1,
      holdingSessions: 1,
    }));
    backfillComplete = backfilledMembers.length > 0 && backfilledMembers.every(row => row.resolved === true);
    if (backfillComplete) {
      backfilledNet = backfilledMembers.reduce((sum, row, index) => {
        const weight = finite(session.members[index]?.weightPct, 0) / 100;
        return sum + weight * finite(row.netReturnPct, 0);
      }, 0);
    }
  }
  return {
    signalDate: session.signalDate || null,
    publishedAt: session.publishedAt || null,
    outcomeDate: session.outcomeDate || (backfillComplete ? backfilledMembers.find(row => row.outcomeDate)?.outcomeDate || null : null),
    basketSize: finite(session.basketSize, Array.isArray(session.members) ? session.members.length : 0),
    tickers: Array.isArray(session.members) ? session.members.map(row => row.ticker) : [],
    originalStatus: session.status || null,
    originalLiveResolved: resolved,
    originalLiveNetReturnPct: resolved ? round(session.netReturnPct) : null,
    retroactiveStatus: resolved ? 'ORIGINAL_LIVE_RESULT_PRESERVED' : backfillComplete ? 'RETROACTIVELY_RESOLVED' : 'PENDING_TRUSTED_HISTORY',
    retroactiveNetReturnPct: resolved ? round(session.netReturnPct) : round(backfilledNet),
    evidenceClass: resolved ? 'EXACT_METHOD_RECORDED_LIVE' : 'EXACT_METHOD_RECORDED_BACKFILL_NOT_NATIVE_V17_LIVE',
    countsTowardNativeV17Gate: false,
  };
}

const exactMethodSessions = (Array.isArray(exactLive.sessions) ? exactLive.sessions : []).map(compactExactLiveSession);
const exactOriginalLiveResolved = exactMethodSessions.filter(row => row.originalLiveResolved);
const exactOriginalLiveReturns = exactOriginalLiveResolved.map(row => finite(row.originalLiveNetReturnPct)).filter(Number.isFinite);
const exactRetroResolved = exactMethodSessions.filter(row => finite(row.retroactiveNetReturnPct) !== null);

const nativeEntries = (Array.isArray(ledger.entries) ? ledger.entries : []).map(entry => ({
  signalId: entry.signalId || null,
  signalDate: entry.sessionDate || null,
  issuedAt: entry.issuedAt || null,
  engineId: entry.engineId || null,
  tickers: Array.isArray(entry.recommendations) ? entry.recommendations.map(row => row.ticker) : [],
  status: entry.status || null,
  resolved: entry.outcome?.resolved === true,
  outcomeDate: entry.outcome?.outcomeDate || null,
  basketSleeveReturnPct: round(finite(entry.outcome?.basketSleeveReturnPct)),
  totalPortfolioReturnPct: round(finite(entry.outcome?.totalPortfolioReturnPct)),
  evidenceClass: 'NATIVE_V17_LIVE',
  countsTowardNativeV17Gate: true,
}));
const nativeResolved = nativeEntries.filter(row => row.resolved);
const nativeReturns = nativeResolved.map(row => finite(row.basketSleeveReturnPct)).filter(Number.isFinite);

const researchMetrics = research.blockedWalkForwardMetrics || {};
const researchSessions = (Array.isArray(research.recentBlockedSessions) ? research.recentBlockedSessions : []).map(row => ({
  signalDate: row.signalDate || null,
  outcomeDate: row.outcomeDate || null,
  basketSize: finite(row.basketSize),
  tickers: Array.isArray(row.tickers) ? row.tickers : [],
  netReturnPct: round(finite(row.netReturnPct)),
  top10Hits: finite(row.top10Hits),
  evidenceClass: 'HISTORICAL_BLOCKED_WALK_FORWARD_RESEARCH',
  countsTowardNativeV17Gate: false,
}));

function historicalConfidenceGrade() {
  const sessions = finite(researchMetrics.sessions, 0);
  const avg = finite(researchMetrics.averageNetReturnPct, -Infinity);
  const pf = finite(researchMetrics.profitFactor, 0);
  const dd = finite(researchMetrics.maximumDrawdownPct, -Infinity);
  const win = finite(researchMetrics.sessionWinRatePct, 0);
  if (sessions >= 30 && avg > 0 && pf >= 1.5 && dd >= -15 && win >= 50) return 'MODERATE_PLUS';
  if (sessions >= 20 && avg > 0 && pf >= 1.2 && dd >= -15 && win >= 45) return 'MODERATE';
  return 'LOW';
}

function liveConfidenceGrade(resolvedSessions) {
  if (resolvedSessions >= 20) return 'MATURE';
  if (resolvedSessions >= 10) return 'DEVELOPING';
  if (resolvedSessions >= 5) return 'EARLY';
  return 'LOW_SAMPLE';
}

const executionReady = current?.readiness?.executionReady === true && current?.systemHealth?.executionGrade === true;
const confidenceCapPct = finite(resilient?.confidencePolicy?.confidenceCapPct);
const currentConfidenceStatus = executionReady ? 'EXECUTION_GATED' : 'RESEARCH_ONLY';
const output = {
  schemaVersion: '17.0.0-recommendation-track-record-1',
  generatedAt: new Date().toISOString(),
  engineId: 'V16_9_EQUAL_WEIGHT_BASKET',
  policy: {
    immutableSignalLedgerUntouched: true,
    backfillCountsAsNativeV17Evidence: false,
    researchCountsAsNativeV17Evidence: false,
    sameSessionTargetStopAmbiguity: 'CONSERVATIVE_STOP',
    transactionCostPct: COST_PCT,
    trustedHistoryQualities: [...TRUSTED_HISTORY_QUALITIES],
    excludedSyntheticHistoryQuality: 'snapshot_ohlc_derived_from_public_market_data',
    disclosureAr: 'التقييم الرجعي يراجع إشارات كانت مسجلة بالفعل فقط. لا يُحوّل النتائج التاريخية أو المعاد بناؤها إلى دليل حي V17، ولا يغيّر Signal Hash أو ترتيب الأسهم أو قواعد المحرك.',
  },
  confidence: {
    techniqueHistorical: {
      grade: historicalConfidenceGrade(),
      labelAr: 'ثقة بحثية متوسطة في التكنيك',
      evidenceClass: 'BLOCKED_WALK_FORWARD_RESEARCH',
      sessions: finite(researchMetrics.sessions, 0),
      averageNetReturnPct: round(finite(researchMetrics.averageNetReturnPct)),
      sessionWinRatePct: round(finite(researchMetrics.sessionWinRatePct)),
      profitFactor: round(finite(researchMetrics.profitFactor)),
      maximumDrawdownPct: round(finite(researchMetrics.maximumDrawdownPct)),
      rationaleAr: 'الـChampion اجتاز اختبارًا محجوبًا بعد التكاليف وبمقاييس موجبة، لكن حجم العينة ما زال محدودًا ولا يساوي ضمانًا مستقبليًا.',
    },
    exactMethodLive: {
      grade: liveConfidenceGrade(exactOriginalLiveResolved.length),
      labelAr: exactOriginalLiveResolved.length < 5 ? 'ثقة حية منخفضة بسبب صغر العينة' : 'ثقة حية قيد البناء',
      evidenceClass: 'EXACT_METHOD_RECORDED_LIVE_ONLY',
      resolvedSessions: exactOriginalLiveResolved.length,
      averageNetReturnPct: round(mean(exactOriginalLiveReturns)),
      profitFactor: round(profitFactor(exactOriginalLiveReturns)),
      maximumDrawdownPct: exactOriginalLiveReturns.length ? round(maxDrawdown(exactOriginalLiveReturns)) : null,
      retroactivelyResolvedSessionsShownSeparately: exactRetroResolved.filter(row => !row.originalLiveResolved).length,
      rationaleAr: 'النتائج المعاد تقييمها بأثر رجعي تُعرض للمراجعة لكنها لا تُضاف إلى عدد الجلسات الحية الأصلية.',
    },
    nativeV17Live: {
      grade: liveConfidenceGrade(nativeResolved.length),
      labelAr: nativeResolved.length < 5 ? 'السجل الحي V17 غير كافٍ بعد' : 'السجل الحي V17 قيد البناء',
      issuedSessions: nativeEntries.length,
      resolvedSessions: nativeResolved.length,
      averageBasketReturnPct: round(mean(nativeReturns)),
      countsTowardProfessionalGate: true,
    },
    currentRecommendation: {
      status: currentConfidenceStatus,
      labelAr: executionReady ? 'توصية مشروطة ببوابات التنفيذ' : 'بحث ومراقبة فقط — ليست توصية تنفيذية',
      executionReady,
      displayConfidenceCapPct: confidenceCapPct,
      recommendationMode: current?.recommendationMode || null,
      currentSessionDate: current?.sessionDate || null,
      rationaleAr: executionReady
        ? 'الثقة الحالية تظل مشروطة باتساق الجلسة والسيولة وجودة المصدر ولا تمثل احتمال ربح مضمونًا.'
        : 'بوابة التنفيذ الحالية مغلقة؛ أي نسبة على بطاقة السهم هي ترتيب/ثقة بحثية بعد سقف جودة المصدر، وليست احتمال ربح أو أمر شراء.',
    },
  },
  nativeV17: {
    summary: {
      issuedSessions: nativeEntries.length,
      resolvedSessions: nativeResolved.length,
      wins: nativeReturns.filter(value => value > 0).length,
      losses: nativeReturns.filter(value => value < 0).length,
      averageBasketReturnPct: round(mean(nativeReturns)),
      profitFactor: round(profitFactor(nativeReturns)),
      maximumDrawdownPct: nativeReturns.length ? round(maxDrawdown(nativeReturns)) : null,
    },
    entries: nativeEntries,
  },
  exactMethodRecordedSessions: {
    summary: {
      recordedSessions: exactMethodSessions.length,
      originalLiveResolvedSessions: exactOriginalLiveResolved.length,
      retroactivelyResolvedSessions: exactRetroResolved.filter(row => !row.originalLiveResolved).length,
      originalLiveAverageNetReturnPct: round(mean(exactOriginalLiveReturns)),
    },
    sessions: exactMethodSessions,
  },
  recordedRecommendationBackfill: {
    summary: {
      recordedRecommendations: legacyRecords.length,
      resolvedWithStoredOrTrustedBackfill: legacyRecords.filter(row => finite(row.netReturnPct) !== null).length,
      sameTechniqueRecordedRecommendations: exactLegacyRecords.length,
      wins: legacyResolvedReturns.filter(value => value > 0).length,
      losses: legacyResolvedReturns.filter(value => value < 0).length,
      averageNetReturnPct: round(mean(legacyResolvedReturns)),
      profitFactor: round(profitFactor(legacyResolvedReturns)),
    },
    records: legacyRecords,
  },
  historicalResearchSessions: {
    summary: {
      sessions: finite(researchMetrics.sessions, researchSessions.length),
      averageNetReturnPct: round(finite(researchMetrics.averageNetReturnPct)),
      sessionWinRatePct: round(finite(researchMetrics.sessionWinRatePct)),
      profitFactor: round(finite(researchMetrics.profitFactor)),
      compoundedNetReturnPct: round(finite(researchMetrics.compoundedNetReturnPct)),
      maximumDrawdownPct: round(finite(researchMetrics.maximumDrawdownPct)),
    },
    recentSessions: researchSessions,
  },
};

writeJsonAtomic(files.output, output);
console.log(JSON.stringify({
  schemaVersion: output.schemaVersion,
  currentConfidenceStatus,
  techniqueConfidence: output.confidence.techniqueHistorical.grade,
  exactOriginalLiveResolved: exactOriginalLiveResolved.length,
  nativeV17Resolved: nativeResolved.length,
  recordedBackfillRows: legacyRecords.length,
  historicalResearchSessions: output.historicalResearchSessions.summary.sessions,
  output: path.relative(root, files.output),
}, null, 2));
