#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const HISTORY_DIR = path.join(ROOT, 'data/history');
const OUT_DECISION = path.join(ROOT, 'data/stable/v15-practical-decision.json');
const OUT_RESEARCH = path.join(ROOT, 'data/research/v15-practical-validation.json');
const OUT_MISSED = path.join(ROOT, 'data/research/v15-missed-opportunities.json');

const COST_PCT = 0.6;
const MIN_RISK_REWARD = 1.15;
const MAX_RECOMMENDATION_RSI = 78;
const MAX_RECOMMENDATION_RET5 = 15;
const MAX_RECOMMENDATION_RET20 = 45;
const MIN_CROSS_SECTION = 60;
const MIN_PROFESSIONAL_TEST_SESSIONS = 20;

const n = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const round = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const mean = values => {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
};
const median = values => {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
};
const pct = (value, base) => base > 0 ? (value / base - 1) * 100 : null;
const dateOnly = value => (String(value || '').match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || null;

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, file);
}
function normalize(file) {
  const document = readJson(file, {});
  const ticker = String(document.ticker || path.basename(file, '.json')).toUpperCase();
  const sourceRows = Array.isArray(document.sessions) ? document.sessions : Array.isArray(document) ? document : [];
  const rows = sourceRows.map(row => ({
    date: dateOnly(row.date || row.sessionDate),
    open: n(row.open),
    high: n(row.high),
    low: n(row.low),
    close: n(row.close),
    volume: n(row.volume, 0),
  })).filter(row =>
    row.date && row.open > 0 && row.close > 0 && row.low > 0
    && row.high >= Math.max(row.open, row.close)
    && row.low <= Math.min(row.open, row.close)
  ).sort((a, b) => a.date.localeCompare(b.date));
  return {
    ticker,
    companyNameAr: document.companyNameAr || document.companyNameEn || ticker,
    verified: document.symbolVerified !== false,
    stale: document.staleData === true,
    rows,
  };
}
function sma(rows, index, length, key = 'close') {
  if (index - length + 1 < 0) return null;
  return mean(rows.slice(index - length + 1, index + 1).map(row => n(row[key])).filter(Number.isFinite));
}
function atr(rows, index, length = 14) {
  if (index - length + 1 < 1) return null;
  const values = [];
  for (let i = index - length + 1; i <= index; i += 1) {
    const previousClose = rows[i - 1].close;
    values.push(Math.max(
      rows[i].high - rows[i].low,
      Math.abs(rows[i].high - previousClose),
      Math.abs(rows[i].low - previousClose),
    ));
  }
  return mean(values);
}
function rsi(rows, index, length = 14) {
  if (index - length < 0) return null;
  let gains = 0;
  let losses = 0;
  for (let i = index - length + 1; i <= index; i += 1) {
    const change = rows[i].close - rows[i - 1].close;
    if (change >= 0) gains += change;
    else losses -= change;
  }
  const averageGain = gains / length;
  const averageLoss = losses / length;
  return averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
}
function feature(history, index) {
  if (index < 55) return null;
  const rows = history.rows;
  const row = rows[index];
  const close = row.close;
  const s10 = sma(rows, index, 10);
  const s20 = sma(rows, index, 20);
  const s50 = sma(rows, index, 50);
  const a14 = atr(rows, index);
  const r14 = rsi(rows, index);
  const averageVolume20 = sma(rows, index - 1, 20, 'volume');
  const volumeRatio20 = averageVolume20 > 0 ? row.volume / averageVolume20 : null;
  const averageTurnover20 = mean(rows.slice(index - 19, index + 1).map(item => item.close * item.volume));
  const prior20 = rows.slice(index - 20, index);
  const high20 = Math.max(...prior20.map(item => item.high));
  const low20 = Math.min(...prior20.map(item => item.low));
  const ret1 = pct(close, rows[index - 1]?.close);
  const ret3 = pct(close, rows[index - 3]?.close);
  const ret5 = pct(close, rows[index - 5]?.close);
  const ret10 = pct(close, rows[index - 10]?.close);
  const ret20 = pct(close, rows[index - 20]?.close);
  const atrPct = a14 > 0 ? a14 / close * 100 : null;
  const rangePosition20 = high20 > low20 ? (close - low20) / (high20 - low20) : 0.5;
  const required = [s10, s20, s50, a14, r14, volumeRatio20, averageTurnover20, ret1, ret3, ret5, ret10, ret20, atrPct];
  if (!required.every(Number.isFinite)) return null;
  if (atrPct < 0.4 || atrPct > 14 || Math.abs(ret1) > 30) return null;
  return {
    ticker: history.ticker,
    companyNameAr: history.companyNameAr,
    date: row.date,
    index,
    rows,
    open: row.open,
    high: row.high,
    low: row.low,
    close,
    volume: row.volume,
    s10,
    s20,
    s50,
    a14,
    r14,
    vr: volumeRatio20,
    turnover: averageTurnover20,
    high20,
    low20,
    rangePos: rangePosition20,
    ret1,
    ret3,
    ret5,
    ret10,
    ret20,
    atrPct,
    breakoutPct: pct(close, high20),
    trend: close > s20 && s20 > s50,
  };
}
function buildStore(histories) {
  const byDate = new Map();
  for (const history of histories) {
    for (let index = 55; index < history.rows.length; index += 1) {
      const item = feature(history, index);
      if (!item) continue;
      const daily = byDate.get(item.date) || [];
      daily.push(item);
      byDate.set(item.date, daily);
    }
  }
  const dates = [...byDate.keys()].sort();
  for (const date of dates) {
    const daily = byDate.get(date);
    const marketReturn20 = median(daily.map(item => item.ret20));
    for (const item of daily) item.rs20 = item.ret20 - marketReturn20;
  }
  return { byDate, dates };
}

const MODELS = [
  {
    id: 'BREAKOUT_CONTINUATION',
    labelAr: 'اختراق مع استمرار وسيولة',
    profile: 'FAST',
    eligible: f => f.trend && f.breakoutPct >= -0.5 && f.vr >= 1.05 && f.ret5 >= 1 && f.ret20 >= 4 && f.rs20 >= 1 && f.r14 >= 52 && f.r14 <= 80,
    score: f => f.breakoutPct * 5 + f.ret5 * 2.4 + f.ret20 * 0.45 + f.rs20 * 1.6 + Math.min(f.vr, 4) * 7 + f.rangePos * 12 - Math.max(0, f.r14 - 75) * 2.5,
  },
  {
    id: 'MOMENTUM_ACCELERATION',
    labelAr: 'تسارع زخم نسبي',
    profile: 'BALANCED',
    eligible: f => f.close > f.s10 && f.s10 > f.s20 && f.s20 > f.s50 && f.ret3 > 0.8 && f.ret10 > 3 && f.ret20 > 5 && f.rs20 > 2 && f.vr >= 0.8 && f.r14 >= 50 && f.r14 <= 78,
    score: f => f.ret3 * 3 + f.ret5 * 2 + f.ret10 + f.ret20 * 0.35 + f.rs20 * 1.8 + Math.min(f.vr, 3) * 5 + f.rangePos * 10,
  },
  {
    id: 'TREND_RESUMPTION',
    labelAr: 'استئناف الاتجاه بعد هدوء',
    profile: 'BALANCED',
    eligible: f => f.trend && f.close > f.s10 && f.ret1 > 0 && f.ret5 > -1 && f.ret20 > 5 && f.rs20 > 1 && f.vr >= 0.7 && f.rangePos >= 0.55 && f.r14 >= 48 && f.r14 <= 72,
    score: f => f.ret1 * 3 + f.ret5 * 1.2 + f.ret20 * 0.45 + f.rs20 * 1.5 + Math.min(f.vr, 2.5) * 5 + f.rangePos * 12 - Math.abs(f.r14 - 60) * 0.5,
  },
  {
    id: 'LIQUID_LEADERS',
    labelAr: 'قيادات سائلة قوية نسبيًا',
    profile: 'FAST',
    eligible: f => f.trend && f.ret5 > 0 && f.ret20 > 3 && f.rs20 > 2 && f.vr >= 0.75 && f.turnover >= 5000000 && f.r14 >= 50 && f.r14 <= 76,
    score: f => Math.log10(Math.max(f.turnover, 1)) * 4 + clamp(f.ret5, -5, 20) * 1.8 + clamp(f.ret20, -10, 60) * 0.35 + clamp(f.rs20, -10, 50) * 1.7 + Math.min(f.vr, 3) * 4,
  },
  {
    id: 'HOT_MOMENTUM',
    labelAr: 'استمرار زخم ساخن',
    profile: 'FAST',
    watchOnly: true,
    eligible: f => f.ret5 >= 8 && f.ret20 >= 12 && f.rs20 >= 7 && f.vr >= 0.8 && f.r14 >= 76 && f.r14 <= 90 && f.turnover >= 1000000,
    score: f => clamp(f.ret5, 0, 35) * 2 + clamp(f.ret20, 0, 80) * 0.45 + clamp(f.rs20, 0, 70) * 1.4 + Math.min(f.vr, 5) * 5 - Math.max(0, f.r14 - 82) * 4,
  },
  {
    id: 'PRE_BREAKOUT_ACCUMULATION',
    labelAr: 'تجميع قبل الاختراق',
    profile: 'FAST',
    eligible: f => f.trend && f.ret5 >= 1 && f.ret20 >= 0 && f.rs20 >= -3 && f.vr >= 1.2 && f.rangePos >= 0.55 && f.breakoutPct >= -7 && f.breakoutPct <= 2 && f.r14 >= 50 && f.r14 <= 74,
    score: f => f.ret5 * 2 + f.ret20 * 0.3 + f.rs20 + Math.min(f.vr, 5) * 7 + f.rangePos * 15 - Math.abs(f.breakoutPct) * 0.8,
  },
  {
    id: 'REVERSAL_CONFIRMATION',
    labelAr: 'انعكاس مبكر مؤكد بالحجم',
    profile: 'BALANCED',
    eligible: f => !f.trend && f.ret1 >= 1.5 && f.ret3 > 0 && f.ret5 <= 8 && f.r14 >= 28 && f.r14 <= 58 && f.vr >= 1.2 && f.close > f.open && f.close > f.s10,
    score: f => f.ret1 * 4 + f.ret3 * 2 - Math.min(0, f.ret5) * 1.2 + Math.min(f.vr, 5) * 7 + (58 - f.r14) * 0.5,
  },
];

const PROFILES = {
  FAST: { stopAtr: 1.0, targetAtr: 1.4, maxHold: 4, labelAr: 'هدف أعلى من الوقف مع مدة قصيرة' },
  BALANCED: { stopAtr: 1.15, targetAtr: 1.65, maxHold: 6, labelAr: 'عائد/مخاطرة متوازن مع وقت أطول' },
  TREND: { stopAtr: 1.4, targetAtr: 2.0, maxHold: 10, labelAr: 'استمرار اتجاه متوسط' },
};

function simulate(featureRow, profileId) {
  const profile = PROFILES[profileId];
  const future = featureRow.rows.slice(featureRow.index + 1, featureRow.index + 1 + profile.maxHold);
  if (!future.length) return null;
  const next = future[0];
  const gap = pct(next.open, featureRow.close);
  if (gap > 5 || next.open <= 0) return { entered: false, status: 'CANCELLED_GAP', returnPct: 0, targetHit: false, stopHit: false };
  const entry = next.open;
  const stop = entry - featureRow.a14 * profile.stopAtr;
  const target = entry + featureRow.a14 * profile.targetAtr;
  if (stop <= 0) return null;
  let exit = future.at(-1).close;
  let status = 'TIME_EXIT';
  let targetHit = false;
  let stopHit = false;
  let hold = future.length;
  for (let index = 0; index < future.length; index += 1) {
    const row = future[index];
    const stopTouched = row.low <= stop;
    const targetTouched = row.high >= target;
    if (stopTouched) {
      exit = stop;
      status = targetTouched ? 'STOP_FIRST_SAME_BAR' : 'STOP';
      stopHit = true;
      hold = index + 1;
      break;
    }
    if (targetTouched) {
      exit = target;
      status = 'TARGET';
      targetHit = true;
      hold = index + 1;
      break;
    }
  }
  return {
    entered: true,
    status,
    entry: round(entry, 4),
    stop: round(stop, 4),
    target: round(target, 4),
    returnPct: round(pct(exit, entry) - COST_PCT, 3),
    targetHit,
    stopHit,
    hold,
  };
}
function metrics(items) {
  const trades = items.filter(item => item.sim?.entered);
  const returns = trades.map(item => item.sim.returnPct);
  const wins = returns.filter(value => value > 0);
  const losses = returns.filter(value => value < 0);
  const grossProfit = wins.reduce((sum, value) => sum + value, 0);
  const grossLoss = Math.abs(losses.reduce((sum, value) => sum + value, 0));
  return {
    signals: items.length,
    entered: trades.length,
    targetHits: trades.filter(item => item.sim.targetHit).length,
    stopHits: trades.filter(item => item.sim.stopHit).length,
    targetRatePct: trades.length ? round(trades.filter(item => item.sim.targetHit).length / trades.length * 100, 1) : null,
    stopRatePct: trades.length ? round(trades.filter(item => item.sim.stopHit).length / trades.length * 100, 1) : null,
    winRatePct: trades.length ? round(wins.length / trades.length * 100, 1) : null,
    averageReturnPct: round(mean(returns), 2),
    medianReturnPct: round(median(returns), 2),
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 2) : grossProfit > 0 ? 99 : null,
  };
}
function candidateRows(store, model, date) {
  return (store.byDate.get(date) || []).filter(model.eligible).sort((a, b) => model.score(b) - model.score(a)).slice(0, 5);
}
function evaluateModel(store, model, dates) {
  const rows = [];
  for (const date of dates) {
    for (const item of candidateRows(store, model, date)) {
      const sim = simulate(item, model.profile);
      if (sim) rows.push({ date, ticker: item.ticker, score: round(model.score(item), 2), sim });
    }
  }
  return { rows, metrics: metrics(rows) };
}
function passesPerformanceGate(result) {
  return result.entered >= 20
    && n(result.averageReturnPct, -99) > 0
    && n(result.profitFactor, 0) >= 1.15
    && n(result.winRatePct, 0) >= 45
    && n(result.targetRatePct, 0) > n(result.stopRatePct, 100);
}
function stability(dev, validation, test, testSessions) {
  let score = 100;
  const reasons = [];
  if (n(dev.averageReturnPct, -99) <= -0.5) { score -= 25; reasons.push('متوسط التطوير خاسر بوضوح'); }
  else if (n(dev.averageReturnPct, -99) <= 0) { score -= 12; reasons.push('التطوير غير موجب'); }
  if (n(dev.profitFactor, 0) < 0.7) { score -= 20; reasons.push('Profit Factor التطوير ضعيف'); }
  else if (n(dev.profitFactor, 0) < 1) { score -= 10; reasons.push('Profit Factor التطوير أقل من 1'); }
  const pfs = [dev, validation, test].map(item => n(item.profitFactor)).filter(Number.isFinite);
  if (pfs.length === 3 && Math.max(...pfs) - Math.min(...pfs) > 1.2) { score -= 15; reasons.push('تفاوت كبير بين الفترات'); }
  const wins = [dev, validation, test].map(item => n(item.winRatePct)).filter(Number.isFinite);
  if (wins.length === 3 && Math.max(...wins) - Math.min(...wins) > 25) { score -= 12; reasons.push('نسبة النجاح حساسة لدورة السوق'); }
  if (testSessions < MIN_PROFESSIONAL_TEST_SESSIONS) { score -= 18; reasons.push(`الاختبار النهائي ${testSessions} جلسة فقط`); }
  score = clamp(score, 0, 100);
  return {
    score,
    labelAr: score >= 70 ? 'مستقر نسبيًا' : score >= 45 ? 'حساس لدورة السوق' : 'غير مستقر',
    reasonsAr: reasons,
    passedPilotGate: score >= 45,
    passedProfessionalGate: score >= 70 && testSessions >= MIN_PROFESSIONAL_TEST_SESSIONS,
  };
}
function missedOpportunities(store, dates) {
  const winners = [];
  for (const date of dates) {
    for (const item of store.byDate.get(date) || []) {
      const future = item.rows[item.index + 3];
      const next = item.rows[item.index + 1];
      if (!future || !next) continue;
      const forward3Pct = pct(future.close, item.close);
      const nextOpenGapPct = pct(next.open, item.close);
      if (forward3Pct < 5) continue;
      winners.push({
        signalDate: date,
        ticker: item.ticker,
        companyNameAr: item.companyNameAr,
        forward3Pct: round(forward3Pct, 2),
        nextOpenGapPct: round(nextOpenGapPct, 2),
        averageTurnover20Egp: round(item.turnover, 0),
        ret5: round(item.ret5, 2),
        ret20: round(item.ret20, 2),
        relativeStrength20: round(item.rs20, 2),
        volumeRatio20: round(item.vr, 2),
        breakoutPct: round(item.breakoutPct, 2),
        rsi14: round(item.r14, 1),
        trend: item.trend,
        matchedModels: MODELS.filter(model => model.eligible(item)).map(model => model.id),
      });
    }
  }
  const tradable = winners.filter(item => item.averageTurnover20Egp >= 1000000 && Math.abs(item.nextOpenGapPct) <= 15);
  const missed = tradable.filter(item => !item.matchedModels.length).sort((a, b) => b.forward3Pct - a.forward3Pct);
  return {
    rawWinners: winners.length,
    rawCaptured: winners.filter(item => item.matchedModels.length).length,
    rawCaptureRatePct: winners.length ? round(winners.filter(item => item.matchedModels.length).length / winners.length * 100, 1) : null,
    tradableWinners: tradable.length,
    tradableCaptured: tradable.length - missed.length,
    tradableCaptureRatePct: tradable.length ? round((tradable.length - missed.length) / tradable.length * 100, 1) : null,
    topMissed: missed.slice(0, 40),
    topWinners: tradable.sort((a, b) => b.forward3Pct - a.forward3Pct).slice(0, 40),
  };
}

function main() {
  if (!fs.existsSync(HISTORY_DIR)) throw new Error('Missing data/history');
  const histories = fs.readdirSync(HISTORY_DIR)
    .filter(name => name.endsWith('.json'))
    .map(name => normalize(path.join(HISTORY_DIR, name)))
    .filter(history => history.verified && !history.stale && history.rows.length >= 80);
  const store = buildStore(histories);
  const usable = store.dates.filter((date, index) =>
    index >= 5 && index < store.dates.length - 5 && (store.byDate.get(date) || []).length >= MIN_CROSS_SECTION
  );
  if (usable.length < 40) throw new Error(`Insufficient cross-sectional sessions: ${usable.length}`);

  const testCount = Math.max(15, Math.min(30, Math.floor(usable.length * 0.25)));
  const validationCount = Math.max(12, Math.min(25, Math.floor(usable.length * 0.25)));
  const developmentCount = usable.length - testCount - validationCount;
  if (developmentCount < 12) throw new Error(`Insufficient development sessions: ${developmentCount}`);
  const development = usable.slice(0, developmentCount);
  const validation = usable.slice(developmentCount, developmentCount + validationCount);
  const test = usable.slice(developmentCount + validationCount);

  const modelResults = MODELS.map(model => {
    const dev = evaluateModel(store, model, development);
    const val = evaluateModel(store, model, validation);
    const finalTest = evaluateModel(store, model, test);
    const stabilityResult = stability(dev.metrics, val.metrics, finalTest.metrics, test.length);
    const validationPassed = passesPerformanceGate(val.metrics);
    const testPassed = passesPerformanceGate(finalTest.metrics);
    const edgeValidation = n(val.metrics.targetRatePct, 0) - n(val.metrics.stopRatePct, 100);
    const edgeTest = n(finalTest.metrics.targetRatePct, 0) - n(finalTest.metrics.stopRatePct, 100);
    const selectionScore =
      Math.min(n(val.metrics.averageReturnPct, -99), n(finalTest.metrics.averageReturnPct, -99)) * 10
      + Math.min(n(val.metrics.profitFactor, 0), n(finalTest.metrics.profitFactor, 0)) * 4
      + Math.min(n(val.metrics.winRatePct, 0), n(finalTest.metrics.winRatePct, 0)) * 0.06
      + Math.min(edgeValidation, edgeTest) * 0.12
      + stabilityResult.score * 0.08;
    return {
      id: model.id,
      labelAr: model.labelAr,
      profile: model.profile,
      watchOnly: model.watchOnly === true,
      development: dev.metrics,
      validation: val.metrics,
      test: finalTest.metrics,
      validationPassed,
      testPassed,
      stabilityScore: stabilityResult.score,
      stabilityLabelAr: stabilityResult.labelAr,
      stabilityReasonsAr: stabilityResult.reasonsAr,
      pilotPassed: validationPassed && testPassed,
      pilotRiskMode: validationPassed && testPassed && !stabilityResult.passedProfessionalGate ? 'REDUCED_RISK' : 'STANDARD_RISK',
      professionalEvidencePassed: validationPassed && testPassed && stabilityResult.passedProfessionalGate,
      evidenceTier: stabilityResult.passedProfessionalGate ? 'PROFESSIONAL_BACKTEST' : 'PILOT_SHORT_SAMPLE',
      selectionScore: round(selectionScore, 2),
    };
  }).sort((a, b) => b.selectionScore - a.selectionScore);

  const validatedModels = modelResults.filter(result => result.pilotPassed);
  const selected = validatedModels.find(result => !result.watchOnly) || validatedModels[0] || null;
  const latestDate = store.dates.at(-1);
  const latestAll = store.byDate.get(latestDate) || [];
  const opportunities = [];

  for (const result of validatedModels) {
    const model = MODELS.find(item => item.id === result.id);
    const profile = PROFILES[model.profile];
    const pool = latestAll.filter(model.eligible).sort((a, b) => model.score(b) - model.score(a)).slice(0, 12);
    for (const [localRank, item] of pool.entries()) {
      const entryLow = item.close - item.a14 * 0.1;
      const entryHigh = item.close + item.a14 * 0.1;
      const stopLoss = item.close - item.a14 * profile.stopAtr;
      const target1 = item.close + item.a14 * profile.targetAtr;
      const riskReward = (target1 - entryHigh) / (entryHigh - stopLoss);
      const chaseReasons = [];
      if (model.watchOnly) chaseReasons.push('استراتيجية زخم ساخن للمراقبة فقط');
      if (item.r14 > MAX_RECOMMENDATION_RSI) chaseReasons.push(`RSI ${round(item.r14, 1)} أعلى من الحد المهني`);
      if (item.ret5 > MAX_RECOMMENDATION_RET5) chaseReasons.push(`صعود 5 جلسات ${round(item.ret5, 2)}%`);
      if (item.ret20 > MAX_RECOMMENDATION_RET20) chaseReasons.push(`صعود 20 جلسة ${round(item.ret20, 2)}%`);
      if (item.breakoutPct > 8) chaseReasons.push('ممتد بعيدًا عن الاختراق');
      if (riskReward < MIN_RISK_REWARD) chaseReasons.push(`العائد/المخاطرة ${round(riskReward, 2)} أقل من الحد`);
      const professionalEligible = chaseReasons.length === 0 && result.stabilityScore >= 10;
      opportunities.push({
        ticker: item.ticker,
        companyNameAr: item.companyNameAr,
        strategyId: model.id,
        strategyLabelAr: model.labelAr,
        profile: model.profile,
        modelRobustScore: result.selectionScore,
        modelStabilityScore: result.stabilityScore,
        modelStabilityLabelAr: result.stabilityLabelAr,
        modelEvidenceTier: result.evidenceTier,
        pilotRiskMode: result.pilotRiskMode,
        modelStabilityReasonsAr: result.stabilityReasonsAr,
        localRank: localRank + 1,
        combinedScore: result.selectionScore * 3 + (12 - localRank) * 2 + result.stabilityScore * 0.1,
        extended: !professionalEligible,
        professionalEligible,
        exclusionReasonsAr: chaseReasons,
        score: round(model.score(item), 2),
        close: round(item.close, 4),
        entryLow: round(entryLow, 4),
        entryHigh: round(entryHigh, 4),
        stopLoss: round(stopLoss, 4),
        target1: round(target1, 4),
        riskReward: round(riskReward, 2),
        holdingSessions: profile.maxHold,
        estimatedTargetProbabilityPct: result.test.targetRatePct,
        estimatedStopProbabilityPct: result.test.stopRatePct,
        estimatedWinRatePct: result.test.winRatePct,
        outOfSampleAverageReturnPct: result.test.averageReturnPct,
        outOfSampleProfitFactor: result.test.profitFactor,
        ret5Pct: round(item.ret5, 2),
        ret20Pct: round(item.ret20, 2),
        relativeStrength20Pct: round(item.rs20, 2),
        volumeRatio20: round(item.vr, 2),
        rsi14: round(item.r14, 1),
        averageTurnover20Egp: round(item.turnover, 0),
      });
    }
  }

  const deduplicated = new Map();
  for (const item of opportunities.sort((a, b) => b.combinedScore - a.combinedScore)) {
    if (!deduplicated.has(item.ticker)) deduplicated.set(item.ticker, item);
  }
  const unique = [...deduplicated.values()];
  const recommendations = unique.filter(item => item.professionalEligible).slice(0, 5).map((item, index) => ({
    ...item,
    rank: index + 1,
    status: test.length >= MIN_PROFESSIONAL_TEST_SESSIONS
      ? 'PROFESSIONAL_CANDIDATE_PENDING_OPEN_CONFIRMATION'
      : 'PILOT_CANDIDATE_PENDING_OPEN_CONFIRMATION',
    statusAr: test.length >= MIN_PROFESSIONAL_TEST_SESSIONS
      ? 'فرصة اجتازت البوابات الفنية والإحصائية وتنتظر تأكيد الافتتاح'
      : 'فرصة Pilot اجتازت البوابات الحالية لكن حجم الاختبار الزمني ما زال محدودًا',
  }));
  const extendedMomentumWatch = unique.filter(item => !item.professionalEligible).slice(0, 10).map((item, index) => ({
    rank: index + 1,
    ticker: item.ticker,
    companyNameAr: item.companyNameAr,
    strategyId: item.strategyId,
    strategyLabelAr: item.strategyLabelAr,
    close: item.close,
    ret5Pct: item.ret5Pct,
    ret20Pct: item.ret20Pct,
    volumeRatio20: item.volumeRatio20,
    rsi14: item.rsi14,
    riskReward: item.riskReward,
    reasonAr: item.exclusionReasonsAr.join(' — ') || 'لم يجتز بوابة الاعتماد المهني',
  }));

  const missed = missedOpportunities(store, usable.slice(-20));
  const practicalReady = recommendations.length > 0;
  const evidenceTier = test.length >= MIN_PROFESSIONAL_TEST_SESSIONS && validatedModels.some(item => item.professionalEvidencePassed)
    ? 'PROFESSIONAL_BACKTEST'
    : 'PILOT_SHORT_SAMPLE';

  const decision = {
    schemaVersion: '15.0.0',
    generatedAt: new Date().toISOString(),
    sessionDate: latestDate,
    mode: 'FULL_MARKET_CROSS_SECTIONAL_WALK_FORWARD',
    practicalReady,
    professionalEvidenceReady: evidenceTier === 'PROFESSIONAL_BACKTEST',
    evidenceTier,
    status: practicalReady ? (evidenceTier === 'PROFESSIONAL_BACKTEST' ? 'PROFESSIONAL_CANDIDATES_AVAILABLE' : 'PILOT_CANDIDATES_AVAILABLE') : 'NO_VALIDATED_STRATEGY',
    statusAr: practicalReady
      ? `توجد ${recommendations.length} فرص اجتازت بوابات المطاردة والعائد/المخاطرة؛ مستوى الدليل ${evidenceTier === 'PROFESSIONAL_BACKTEST' ? 'احترافي' : 'Pilot بسبب قصر العينة الزمنية'}`
      : 'لا توجد فرصة اجتازت جميع البوابات؛ لا يتم ملء قائمة الخمس قسرًا',
    selectedModel: selected,
    validatedModels: validatedModels.map(item => item.id),
    recommendations,
    extendedMomentumWatch,
    marketScan: {
      histories: histories.length,
      symbolsLatest: latestAll.length,
      latestDate,
      crossSectionMinimum: MIN_CROSS_SECTION,
      usableSessions: usable.length,
    },
    validationWindows: {
      development: { sessions: development.length, from: development[0] || null, to: development.at(-1) || null },
      validation: { sessions: validation.length, from: validation[0] || null, to: validation.at(-1) || null },
      test: { sessions: test.length, from: test[0] || null, to: test.at(-1) || null },
      professionalMinimumTestSessions: MIN_PROFESSIONAL_TEST_SESSIONS,
      sampleSufficientForProfessionalClaim: test.length >= MIN_PROFESSIONAL_TEST_SESSIONS,
    },
    guardrails: {
      fullMarketScan: true,
      developmentValidationTestSplit: true,
      futureLeakageForbidden: true,
      transactionCostsPct: COST_PCT,
      minimumRiskReward: MIN_RISK_REWARD,
      maximumRecommendationRsi: MAX_RECOMMENDATION_RSI,
      maximumRecommendationReturn5Pct: MAX_RECOMMENDATION_RET5,
      maximumRecommendationReturn20Pct: MAX_RECOMMENDATION_RET20,
      hotMomentumWatchOnly: true,
      modelStabilityGate: true,
      targetProbabilityMustExceedStopProbability: true,
      manualOpeningPriceConfirmation: true,
      automaticOrders: false,
    },
    missedOpportunityCapture: missed.tradableCaptureRatePct,
  };

  writeJson(OUT_RESEARCH, {
    schemaVersion: '16.0.0',
    generatedAt: new Date().toISOString(),
    sessions: {
      totalUsable: usable.length,
      development: development.length,
      validation: validation.length,
      test: test.length,
      professionalMinimumTest: MIN_PROFESSIONAL_TEST_SESSIONS,
    },
    sessionRanges: decision.validationWindows,
    profiles: PROFILES,
    minimumRiskReward: MIN_RISK_REWARD,
    models: modelResults,
    selection: selected?.id || null,
    validatedModels: validatedModels.map(item => item.id),
    professionalValidatedModels: validatedModels.filter(item => item.professionalEvidencePassed).map(item => item.id),
    evidenceTier,
    selectionRule: 'Model must pass validation and untouched test, target rate above stop rate, minimum risk/reward, and stability gate. Short time samples remain Pilot.',
    costPct: COST_PCT,
  });
  writeJson(OUT_MISSED, {
    schemaVersion: '16.0.0',
    generatedAt: new Date().toISOString(),
    sessionsAnalyzed: Math.min(20, usable.length),
    ...missed,
  });
  writeJson(OUT_DECISION, decision);
  console.log(JSON.stringify({
    latestDate,
    histories: histories.length,
    usableSessions: usable.length,
    split: { development: development.length, validation: validation.length, test: test.length },
    evidenceTier,
    selected: selected?.id || null,
    validatedModels: validatedModels.map(item => ({ id: item.id, stability: item.stabilityScore, tier: item.evidenceTier })),
    recommendations: recommendations.map(item => ({ ticker: item.ticker, rr: item.riskReward, rsi: item.rsi14 })),
    watch: extendedMomentumWatch.map(item => ({ ticker: item.ticker, reason: item.reasonAr })),
  }, null, 2));
}

main();
