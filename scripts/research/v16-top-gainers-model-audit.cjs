#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const HISTORY_DIR = path.join(ROOT, 'data/history');
const DECISION_FILE = path.join(ROOT, 'data/stable/v15-practical-decision.json');
const PRICE_TRUTH_FILE = path.join(ROOT, 'data/stable/v15-price-truth.json');
const OUT_FILE = path.join(ROOT, 'data/research/v16-top-gainers-model-audit.json');

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
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
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

const MODELS = [
  {
    id: 'BREAKOUT_CONTINUATION',
    labelAr: 'اختراق مع استمرار وسيولة',
    watchOnly: false,
    eligible: f => f.trend && f.breakoutPct >= -0.5 && f.vr >= 1.05 && f.ret5 >= 1 && f.ret20 >= 4 && f.rs20 >= 1 && f.r14 >= 52 && f.r14 <= 80,
  },
  {
    id: 'MOMENTUM_ACCELERATION',
    labelAr: 'تسارع زخم نسبي',
    watchOnly: false,
    eligible: f => f.close > f.s10 && f.s10 > f.s20 && f.s20 > f.s50 && f.ret3 > 0.8 && f.ret10 > 3 && f.ret20 > 5 && f.rs20 > 2 && f.vr >= 0.8 && f.r14 >= 50 && f.r14 <= 78,
  },
  {
    id: 'TREND_RESUMPTION',
    labelAr: 'استئناف الاتجاه بعد هدوء',
    watchOnly: false,
    eligible: f => f.trend && f.close > f.s10 && f.ret1 > 0 && f.ret5 > -1 && f.ret20 > 5 && f.rs20 > 1 && f.vr >= 0.7 && f.rangePos >= 0.55 && f.r14 >= 48 && f.r14 <= 72,
  },
  {
    id: 'LIQUID_LEADERS',
    labelAr: 'قيادات سائلة قوية نسبيًا',
    watchOnly: false,
    eligible: f => f.trend && f.ret5 > 0 && f.ret20 > 3 && f.rs20 > 2 && f.vr >= 0.75 && f.turnover >= 5000000 && f.r14 >= 50 && f.r14 <= 76,
  },
  {
    id: 'HOT_MOMENTUM',
    labelAr: 'استمرار زخم ساخن',
    watchOnly: true,
    eligible: f => f.ret5 >= 8 && f.ret20 >= 12 && f.rs20 >= 7 && f.vr >= 0.8 && f.r14 >= 76 && f.r14 <= 90 && f.turnover >= 1000000,
  },
  {
    id: 'PRE_BREAKOUT_ACCUMULATION',
    labelAr: 'تجميع قبل الاختراق',
    watchOnly: false,
    eligible: f => f.trend && f.ret5 >= 1 && f.ret20 >= 0 && f.rs20 >= -3 && f.vr >= 1.2 && f.rangePos >= 0.55 && f.breakoutPct >= -7 && f.breakoutPct <= 2 && f.r14 >= 50 && f.r14 <= 74,
  },
  {
    id: 'REVERSAL_CONFIRMATION',
    labelAr: 'انعكاس مبكر مؤكد بالحجم',
    watchOnly: false,
    eligible: f => !f.trend && f.ret1 >= 1.5 && f.ret3 > 0 && f.ret5 <= 8 && f.r14 >= 28 && f.r14 <= 58 && f.vr >= 1.2 && f.close > f.open && f.close > f.s10,
  },
];

function main() {
  const decision = readJson(DECISION_FILE, {});
  const priceTruth = readJson(PRICE_TRUTH_FILE, {});
  if (priceTruth.ready !== true || priceTruth.executionGrade !== true) {
    throw new Error('Current session is not execution-grade');
  }

  const currentSession = priceTruth.expectedSession || decision.sessionDate;
  const histories = fs.readdirSync(HISTORY_DIR)
    .filter(name => name.endsWith('.json'))
    .map(name => normalize(path.join(HISTORY_DIR, name)))
    .filter(history => history.verified && !history.stale && history.rows.length >= 56);

  const priorCandidates = new Set();
  for (const history of histories) {
    const currentIndex = history.rows.findIndex(row => row.date === currentSession);
    if (currentIndex > 0) priorCandidates.add(history.rows[currentIndex - 1].date);
  }
  const priorSession = [...priorCandidates].sort().at(-1);
  if (!priorSession) throw new Error(`Unable to resolve prior session before ${currentSession}`);

  const priorFeatures = [];
  for (const history of histories) {
    const index = history.rows.findIndex(row => row.date === priorSession);
    const item = index >= 55 ? feature(history, index) : null;
    if (item) priorFeatures.push(item);
  }
  const marketReturn20 = median(priorFeatures.map(item => item.ret20));
  for (const item of priorFeatures) item.rs20 = item.ret20 - marketReturn20;
  const featureMap = new Map(priorFeatures.map(item => [item.ticker, item]));

  const currentRecommendations = new Set((decision.recommendations || []).map(row => row.ticker));
  const validatedModels = new Set(Array.isArray(decision.validatedModels) ? decision.validatedModels : []);

  const gainers = [];
  for (const history of histories) {
    const currentIndex = history.rows.findIndex(row => row.date === currentSession);
    const priorIndex = history.rows.findIndex(row => row.date === priorSession);
    if (currentIndex < 0 || priorIndex < 0) continue;
    const currentRow = history.rows[currentIndex];
    const priorRow = history.rows[priorIndex];
    const returnPct = pct(currentRow.close, priorRow.close);
    if (!Number.isFinite(returnPct)) continue;
    const priorFeature = featureMap.get(history.ticker) || null;
    const matched = priorFeature ? MODELS.filter(model => model.eligible(priorFeature)) : [];
    const executableMatched = matched.filter(model => !model.watchOnly);
    const validatedMatched = matched.filter(model => validatedModels.has(model.id));
    gainers.push({
      ticker: history.ticker,
      companyNameAr: history.companyNameAr,
      priorClose: round(priorRow.close, 4),
      currentClose: round(currentRow.close, 4),
      dailyReturnPct: round(returnPct, 2),
      priorSignalAvailable: Boolean(priorFeature),
      matchedModels: matched.map(model => ({ id: model.id, labelAr: model.labelAr, watchOnly: model.watchOnly })),
      matchedModelCount: matched.length,
      executableModelCount: executableMatched.length,
      validatedMatchedModels: validatedMatched.map(model => ({ id: model.id, labelAr: model.labelAr })),
      validatedMatchedModelCount: validatedMatched.length,
      wasRecommendedForCurrentSession: currentRecommendations.has(history.ticker),
      priorMetrics: priorFeature ? {
        ret1Pct: round(priorFeature.ret1, 2),
        ret3Pct: round(priorFeature.ret3, 2),
        ret5Pct: round(priorFeature.ret5, 2),
        ret20Pct: round(priorFeature.ret20, 2),
        relativeStrength20Pct: round(priorFeature.rs20, 2),
        volumeRatio20: round(priorFeature.vr, 2),
        rsi14: round(priorFeature.r14, 1),
        breakoutPct: round(priorFeature.breakoutPct, 2),
        averageTurnover20Egp: round(priorFeature.turnover, 0),
        trend: priorFeature.trend,
      } : null,
    });
  }

  gainers.sort((a, b) => b.dailyReturnPct - a.dailyReturnPct);
  const top10 = gainers.slice(0, 10).map((row, index) => ({ rank: index + 1, ...row }));
  const capturedAnyModel = top10.filter(row => row.matchedModelCount > 0).length;
  const capturedValidated = top10.filter(row => row.validatedMatchedModelCount > 0).length;
  const recommendedCount = top10.filter(row => row.wasRecommendedForCurrentSession).length;

  const output = {
    schemaVersion: '16.3.6',
    generatedAt: new Date().toISOString(),
    methodology: {
      currentSession,
      priorSession,
      ranking: 'current close versus prior close percentage return',
      universe: 'verified non-stale history symbols with both sessions',
      executionGrade: priceTruth.executionGrade,
      acceptedRows: priceTruth.acceptedRows,
      anomalyGuard: priceTruth.acceptanceMode,
      modelEvaluationDate: priorSession,
      modelDefinitions: MODELS.map(model => ({ id: model.id, labelAr: model.labelAr, watchOnly: model.watchOnly })),
      validatedModels: [...validatedModels],
    },
    summary: {
      eligibleUniverseCount: gainers.length,
      top10CapturedByAnyModel: capturedAnyModel,
      top10CapturedByAnyModelPct: round(capturedAnyModel / 10 * 100, 1),
      top10CapturedByValidatedModel: capturedValidated,
      top10CapturedByValidatedModelPct: round(capturedValidated / 10 * 100, 1),
      top10ActuallyRecommended: recommendedCount,
      top10ActuallyRecommendedPct: round(recommendedCount / 10 * 100, 1),
    },
    top10,
    notesAr: [
      'المراجعة تقيس ما إذا كانت شروط النموذج متحققة عند إغلاق الجلسة السابقة، وليس بعد معرفة ارتفاع اليوم.',
      'النموذج HOT_MOMENTUM للمراقبة فقط ولا يُعد توصية تنفيذية.',
      'النماذج المعتمدة حاليًا هي فقط النماذج الموجودة في validatedModels.',
    ],
  };

  writeJson(OUT_FILE, output);
  console.log(JSON.stringify(output, null, 2));
}

main();
