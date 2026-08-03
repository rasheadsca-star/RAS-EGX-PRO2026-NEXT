#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const HISTORY_DIR = path.join(ROOT, 'data/history');
const MARKET_PATH = path.join(ROOT, 'data/quant/market-search-index-v13-17.json');
const FUNDAMENTAL_PATH = path.join(ROOT, 'data/stable/v16-fundamental-analysis.json');
const OUT_PATH = path.join(ROOT, 'data/stable/v16-market-regime.json');

const readJson = (file, fallback = {}) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const num = value => Number.isFinite(Number(value)) ? Number(value) : null;
const round = (value, digits = 2) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
function median(values) {
  const rows = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!rows.length) return null;
  const i = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[i] : (rows[i - 1] + rows[i]) / 2;
}
function std(values) {
  if (values.length < 2) return null;
  const avg = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1));
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8'));
  fs.renameSync(tmp, file);
}
function sessionsFor(ticker) {
  const document = readJson(path.join(HISTORY_DIR, `${ticker}.json`), {});
  const source = Array.isArray(document.sessions) ? document.sessions : Array.isArray(document) ? document : [];
  return source
    .map(row => ({
      date: String(row.date || row.sessionDate || '').slice(0, 10),
      close: num(row.close),
      volume: num(row.volume),
      confidence: num(row.confidence?.overall),
      validationStatus: String(row.validationStatus || '')
    }))
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.close > 0 && row.validationStatus !== 'source_conflict' && (row.confidence === null || row.confidence >= 55))
    .sort((a, b) => a.date.localeCompare(b.date));
}
function snapshot(ticker, sessions, targetDate) {
  const eligible = sessions.filter(row => !targetDate || row.date <= targetDate);
  if (eligible.length < 21) return null;
  const latest = eligible.at(-1);
  const closes = eligible.map(row => row.close);
  const dailyReturns = [];
  for (let i = Math.max(1, closes.length - 21); i < closes.length; i += 1) dailyReturns.push((closes[i] / closes[i - 1] - 1) * 100);
  const sma20 = mean(closes.slice(-20));
  const sma50 = eligible.length >= 50 ? mean(closes.slice(-50)) : null;
  const prev = closes.at(-2);
  const close5 = closes.at(-6);
  const close20 = closes.at(-21);
  const vol20 = std(dailyReturns);
  return {
    ticker,
    date: latest.date,
    close: round(latest.close, 4),
    return1Pct: round((latest.close / prev - 1) * 100),
    return5Pct: round((latest.close / close5 - 1) * 100),
    return20Pct: round((latest.close / close20 - 1) * 100),
    aboveSma20: latest.close >= sma20,
    aboveSma50: sma50 === null ? null : latest.close >= sma50,
    volatility20AnnualizedPct: vol20 === null ? null : round(vol20 * Math.sqrt(252)),
    relativeVolume20: latest.volume && eligible.slice(-21, -1).some(row => row.volume > 0)
      ? round(latest.volume / mean(eligible.slice(-21, -1).map(row => row.volume).filter(value => value > 0)), 2)
      : null
  };
}
function classify(metrics) {
  let score = 50;
  if (metrics.advancePct >= 60) score += 14; else if (metrics.advancePct < 40) score -= 16;
  if (metrics.aboveSma20Pct >= 60) score += 16; else if (metrics.aboveSma20Pct < 40) score -= 18;
  if (metrics.aboveSma50Pct >= 55) score += 14; else if (metrics.aboveSma50Pct < 35) score -= 16;
  if (metrics.medianReturn20Pct >= 4) score += 12; else if (metrics.medianReturn20Pct < -4) score -= 14;
  if (metrics.medianReturn5Pct >= 1.5) score += 6; else if (metrics.medianReturn5Pct < -2) score -= 8;
  if (metrics.volatility20AnnualizedPct >= 55) score -= 18; else if (metrics.volatility20AnnualizedPct <= 30) score += 6;
  score = clamp(Math.round(score), 0, 100);
  let regime = 'NEUTRAL';
  if (metrics.volatility20AnnualizedPct >= 65) regime = 'HIGH_VOLATILITY';
  else if (score >= 68) regime = 'RISK_ON';
  else if (score <= 35) regime = 'RISK_OFF';
  const map = {
    RISK_ON: { labelAr: 'سوق داعم للمخاطرة', riskMultiplier: 1, maxOpenRiskPct: 2, maxTradeRiskPct: 0.25, guidanceAr: 'يسمح بمراجعة الفرص التي اجتازت البوابات، مع الالتزام بالوقف وعدم مطاردة الافتتاح.' },
    NEUTRAL: { labelAr: 'سوق محايد وانتقائي', riskMultiplier: 0.65, maxOpenRiskPct: 1.3, maxTradeRiskPct: 0.16, guidanceAr: 'قلّل عدد المراكز، وانتظر تأكيد الدخول والسيولة قبل التنفيذ.' },
    RISK_OFF: { labelAr: 'سوق دفاعي مرتفع المخاطر', riskMultiplier: 0.35, maxOpenRiskPct: 0.7, maxTradeRiskPct: 0.09, guidanceAr: 'الأولوية للحفاظ على رأس المال؛ لا تُفتح صفقات جديدة إلا استثنائيًا وبمخاطرة شديدة الانخفاض.' },
    HIGH_VOLATILITY: { labelAr: 'تقلب استثنائي', riskMultiplier: 0.2, maxOpenRiskPct: 0.4, maxTradeRiskPct: 0.05, guidanceAr: 'أوقف التوسع في المراكز، وراجع الفجوات والسيولة قبل أي قرار.' }
  };
  return { regime, score, ...map[regime] };
}

function main() {
  const market = readJson(MARKET_PATH, { stocks: [] });
  const fundamental = readJson(FUNDAMENTAL_PATH, { records: [] });
  const targetDate = market.marketDate || market.analysisSession || null;
  const rows = [];
  for (const item of market.stocks || []) {
    const ticker = String(item.ticker || '').toUpperCase();
    if (!ticker) continue;
    const row = snapshot(ticker, sessionsFor(ticker), targetDate);
    if (row) rows.push(row);
  }
  const latestDates = rows.map(row => row.date).sort();
  const sessionDate = latestDates.at(-1) || targetDate;
  const sameSession = rows.filter(row => row.date === sessionDate);
  const advances = sameSession.filter(row => row.return1Pct > 0.05).length;
  const declines = sameSession.filter(row => row.return1Pct < -0.05).length;
  const unchanged = sameSession.length - advances - declines;
  const metrics = {
    sessionDate,
    universeCount: (market.stocks || []).length,
    analyzedCount: sameSession.length,
    participationPct: round(sameSession.length / Math.max(1, (market.stocks || []).length) * 100, 1),
    advances,
    declines,
    unchanged,
    advancePct: round(advances / Math.max(1, advances + declines) * 100, 1),
    advanceDeclineRatio: round(advances / Math.max(1, declines), 2),
    aboveSma20Pct: round(sameSession.filter(row => row.aboveSma20).length / Math.max(1, sameSession.length) * 100, 1),
    aboveSma50Pct: round(sameSession.filter(row => row.aboveSma50 === true).length / Math.max(1, sameSession.filter(row => row.aboveSma50 !== null).length) * 100, 1),
    medianReturn1Pct: round(median(sameSession.map(row => row.return1Pct))),
    medianReturn5Pct: round(median(sameSession.map(row => row.return5Pct))),
    medianReturn20Pct: round(median(sameSession.map(row => row.return20Pct))),
    volatility20AnnualizedPct: round(median(sameSession.map(row => row.volatility20AnnualizedPct))),
    highVolumeParticipationPct: round(sameSession.filter(row => row.relativeVolume20 >= 1.2).length / Math.max(1, sameSession.filter(row => row.relativeVolume20 !== null).length) * 100, 1)
  };
  const classification = classify(metrics);
  const fundamentalMap = new Map((fundamental.records || []).map(row => [String(row.ticker || '').toUpperCase(), row]));
  const groups = new Map();
  for (const row of sameSession) {
    const financial = fundamentalMap.get(row.ticker);
    const group = financial?.classification?.sector || financial?.classification?.template || 'غير مصنف';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(row);
  }
  const sectorLeadership = [...groups.entries()]
    .filter(([, values]) => values.length >= 3)
    .map(([name, values]) => ({
      name,
      count: values.length,
      medianReturn5Pct: round(median(values.map(row => row.return5Pct))),
      medianReturn20Pct: round(median(values.map(row => row.return20Pct))),
      aboveSma20Pct: round(values.filter(row => row.aboveSma20).length / values.length * 100, 1)
    }))
    .sort((a, b) => (b.medianReturn20Pct || -999) - (a.medianReturn20Pct || -999));
  const out = {
    schemaVersion: '16.2.0',
    generatedAt: new Date().toISOString(),
    methodology: {
      name: 'EGX_PRO_MARKET_REGIME_BREADTH_1.0',
      benchmarkType: 'EQUAL_WEIGHT_MARKET_BREADTH',
      principles: [
        'The regime is based on broad market participation, trend and volatility, not a single index close.',
        'Risk multipliers reduce exposure; they never generate an automatic order.',
        'Insufficient participation produces a warning rather than a bullish classification.'
      ]
    },
    ...classification,
    metrics,
    sectorLeadership: sectorLeadership.slice(0, 8),
    weakestGroups: sectorLeadership.slice(-5).reverse(),
    warnings: [
      ...(metrics.participationPct < 60 ? ['LOW_MARKET_HISTORY_PARTICIPATION'] : []),
      ...(metrics.volatility20AnnualizedPct >= 55 ? ['ELEVATED_VOLATILITY'] : []),
      ...(metrics.aboveSma20Pct < 40 ? ['WEAK_SHORT_TERM_BREADTH'] : [])
    ]
  };
  writeJson(OUT_PATH, out);
  console.log({ regime: out.regime, score: out.score, metrics: out.metrics, leaders: out.sectorLeadership.slice(0, 3) });
}

main();
