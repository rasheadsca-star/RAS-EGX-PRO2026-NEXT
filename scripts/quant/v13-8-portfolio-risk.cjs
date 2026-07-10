#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const HISTORY_DIR = path.join(ROOT, 'data', 'history');
const OUTPUT_PATH = path.join(ROOT, 'data', 'quant', 'portfolio-risk-universe.json');
const POLICY = readJson('data/v13-8-risk-policy.json', true);
const STOCK_INDEX = readJson('data/quant/stock-intelligence-index.json', true);

function readJson(relativePath, required = false) {
  const full = path.join(ROOT, relativePath);
  if (!fs.existsSync(full)) {
    if (required) throw new Error(`Missing required file: ${relativePath}`);
    return null;
  }
  try { return JSON.parse(fs.readFileSync(full, 'utf8')); }
  catch (error) {
    if (required) throw new Error(`Invalid JSON ${relativePath}: ${error.message}`);
    return null;
  }
}

function writeJson(fullPath, value) {
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  const temp = `${fullPath}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  JSON.parse(fs.readFileSync(temp, 'utf8'));
  fs.renameSync(temp, fullPath);
}

function num(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function round(value, digits = 4) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
}
function safeTicker(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '');
}
function mean(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null;
}
function std(values) {
  const clean = values.filter(Number.isFinite);
  const m = mean(clean);
  if (m === null || clean.length < 2) return null;
  return Math.sqrt(clean.reduce((sum, value) => sum + ((value - m) ** 2), 0) / clean.length);
}
function covariance(a, b) {
  if (a.length !== b.length || a.length < 2) return null;
  const ma = mean(a), mb = mean(b);
  return mean(a.map((value, index) => (value - ma) * (b[index] - mb)));
}
function correlation(a, b) {
  const cov = covariance(a, b);
  const sa = std(a), sb = std(b);
  return cov === null || !sa || !sb ? null : cov / (sa * sb);
}
function quantile(values, p) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const index = (clean.length - 1) * p;
  const lower = Math.floor(index), upper = Math.ceil(index);
  if (lower === upper) return clean[lower];
  return clean[lower] + (clean[upper] - clean[lower]) * (index - lower);
}
function clamp(value, minValue = 0, maxValue = 100) {
  return Math.max(minValue, Math.min(maxValue, value));
}
function normalizeRows(doc) {
  const raw = Array.isArray(doc) ? doc : (doc?.sessions || doc?.rows || doc?.data || doc?.history || []);
  return raw.map(row => ({
    date: String(row.date || row.sessionDate || row.session || '').slice(0, 10),
    close: num(row.close),
    volume: num(row.volume, 0)
  }))
    .filter(row => row.date && Number.isFinite(row.close))
    .sort((a, b) => a.date.localeCompare(b.date));
}
function dailyReturnMap(rows) {
  const map = new Map();
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1].close;
    const current = rows[index].close;
    if (previous > 0 && current > 0) map.set(rows[index].date, (current / previous) - 1);
  }
  return map;
}
function alignMaps(mapA, mapB, lookback) {
  const dates = [...mapA.keys()].filter(date => mapB.has(date)).sort().slice(-lookback);
  return {
    dates,
    a: dates.map(date => mapA.get(date)),
    b: dates.map(date => mapB.get(date))
  };
}
function maxDrawdown(rows, lookback) {
  const closes = rows.slice(-lookback).map(row => row.close);
  if (!closes.length) return null;
  let peak = closes[0], worst = 0;
  for (const close of closes) {
    if (close > peak) peak = close;
    if (peak > 0) worst = Math.min(worst, (close / peak) - 1);
  }
  return Math.abs(worst) * 100;
}
function downsideDeviation(returns) {
  const downside = returns.filter(value => value < 0);
  return downside.length ? std(downside.map(value => value * 100)) : 0;
}
function recommendationCandidates() {
  const adaptive = readJson('data/quant/adaptive-daily-recommendations.json') || {};
  const daily = readJson('data/quant/daily-recommendations.json') || {};
  const output = [];
  const seen = new Set();

  const add = (items, source, status, priority) => {
    for (const raw of items || []) {
      const ticker = safeTicker(raw.ticker);
      if (!ticker) continue;
      const key = `${ticker}:${raw.strategyId || ''}`;
      const current = seen.has(key);
      if (current) continue;
      seen.add(key);
      output.push({
        ticker,
        source,
        status,
        priority,
        statusLabelAr: raw.statusLabelAr || (status === 'PAPER_READY' ? 'مرشح تداول ورقي' : 'مراقبة مشروطة'),
        strategyId: raw.strategyId || null,
        strategyLabelAr: raw.strategyLabelAr || null,
        recommendationScore: num(raw.recommendationScore),
        companyNameAr: raw.companyNameAr || '',
        companyNameEn: raw.companyNameEn || '',
        reasonAr: raw.reasonAr || '',
        failedConditions: raw.failedConditions || [],
        adaptive: raw.adaptive || null,
        plan: {
          entryLow: num(raw.plan?.entryLow),
          entryHigh: num(raw.plan?.entryHigh),
          stopLoss: num(raw.plan?.stopLoss),
          target1: num(raw.plan?.target1),
          target2: num(raw.plan?.target2),
          riskReward1: num(raw.plan?.riskReward1),
          maximumHoldingSessions: num(raw.plan?.maximumHoldingSessions)
        }
      });
    }
  };

  add(adaptive.paperCandidates, 'V13.5', 'PAPER_READY', 4);
  add(adaptive.conditionalWatch, 'V13.5', 'WATCH', 3);
  add(daily.paperCandidates, 'V13.4', 'PAPER_READY', 2);
  add(daily.watchCandidates, 'V13.4', 'WATCH', 1);

  return {
    sessionId: adaptive.sessionId || daily.sessionId || STOCK_INDEX.sessionId || null,
    marketRegime: adaptive.marketRegime || daily.marketRegime || STOCK_INDEX.marketRegime || null,
    candidates: output
  };
}

function main() {
  if (!fs.existsSync(HISTORY_DIR)) throw new Error('Missing data/history directory');

  const stockMap = new Map((STOCK_INDEX.stocks || []).map(item => [safeTicker(item.ticker), item]));
  const histories = new Map();
  const returnMaps = new Map();

  for (const filename of fs.readdirSync(HISTORY_DIR).filter(name => name.endsWith('.json')).sort()) {
    const ticker = safeTicker(filename.replace(/\.json$/i, ''));
    const doc = readJson(path.posix.join('data/history', filename), true);
    const rows = normalizeRows(doc);
    if (rows.length < 20) continue;
    histories.set(ticker, rows);
    returnMaps.set(ticker, dailyReturnMap(rows));
  }

  const dateBuckets = new Map();
  for (const returnMap of returnMaps.values()) {
    for (const [date, value] of returnMap.entries()) {
      if (!dateBuckets.has(date)) dateBuckets.set(date, []);
      dateBuckets.get(date).push(value);
    }
  }
  const marketReturns = new Map(
    [...dateBuckets.entries()]
      .filter(([, values]) => values.length >= 5)
      .map(([date, values]) => [date, mean(values)])
  );

  const rawProfiles = [];
  const lookback = Number(POLICY.risk.riskLookbackSessions || 100);
  const corrLookback = Number(POLICY.risk.correlationLookbackSessions || 60);
  const minOverlap = Number(POLICY.risk.minimumCorrelationOverlapSessions || 20);

  for (const [ticker, rows] of histories.entries()) {
    const stock = stockMap.get(ticker) || {};
    const returnsMap = returnMaps.get(ticker);
    const recentReturns = [...returnsMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-lookback).map(([, value]) => value);
    const recent20 = recentReturns.slice(-20);
    const recent50 = recentReturns.slice(-50);
    const alignedMarket = alignMaps(returnsMap, marketReturns, corrLookback);
    const corrMarket = alignedMarket.dates.length >= minOverlap ? correlation(alignedMarket.a, alignedMarket.b) : null;
    const marketVariance = alignedMarket.dates.length >= minOverlap ? (std(alignedMarket.b) ** 2) : null;
    const beta = marketVariance ? covariance(alignedMarket.a, alignedMarket.b) / marketVariance : null;
    const q05 = quantile(recentReturns, 0.05);
    const tail = q05 === null ? [] : recentReturns.filter(value => value <= q05);
    const var95 = q05 === null ? null : Math.max(0, -q05 * 100);
    const cvar95 = tail.length ? Math.max(0, -mean(tail) * 100) : null;
    const volatility20 = std(recent20.map(value => value * 100));
    const volatility50 = std(recent50.map(value => value * 100));
    const downside20 = downsideDeviation(recent20);
    const drawdown100 = maxDrawdown(rows, lookback);
    const avgTurnover20 = num(stock.averageTurnover20Egp, 0);

    rawProfiles.push({
      ticker,
      companyNameAr: stock.companyNameAr || '',
      companyNameEn: stock.companyNameEn || '',
      sector: stock.sector || 'غير مصنف',
      sessionId: stock.sessionId || rows.at(-1)?.date || null,
      price: num(stock.price),
      technicalScore: num(stock.technicalScore),
      trendCode: stock.trendCode || null,
      trendLabelAr: stock.trendLabelAr || null,
      recommendationStatus: stock.recommendationStatus || null,
      recommendationLabelAr: stock.recommendationLabelAr || null,
      averageTurnover20Egp: avgTurnover20,
      historySessions: rows.length,
      volatility20Pct: round(volatility20, 3),
      volatility50Pct: round(volatility50, 3),
      downsideDeviation20Pct: round(downside20, 3),
      var95OneDayPct: round(var95, 3),
      cvar95OneDayPct: round(cvar95, 3),
      maxDrawdown100Pct: round(drawdown100, 3),
      beta60: round(beta, 3),
      marketCorrelation60: round(corrMarket, 3),
      correlationOverlapSessions: alignedMarket.dates.length,
      liquidityPercentile: 0,
      riskScore: 0,
      riskCode: null,
      riskLabelAr: null,
      topCorrelated: []
    });
  }

  const liquidRank = rawProfiles
    .filter(item => item.averageTurnover20Egp > 0)
    .slice()
    .sort((a, b) => a.averageTurnover20Egp - b.averageTurnover20Egp);

  for (const profile of rawProfiles) {
    if (profile.averageTurnover20Egp > 0 && liquidRank.length) {
      const rank = liquidRank.filter(item => item.averageTurnover20Egp <= profile.averageTurnover20Egp).length;
      profile.liquidityPercentile = round((rank / liquidRank.length) * 100, 1);
    }
  }

  for (const profile of rawProfiles) {
    let score = 0;
    score += Math.min(22, (profile.volatility20Pct || 0) * 6);
    score += Math.min(18, (profile.downsideDeviation20Pct || 0) * 6);
    score += Math.min(20, (profile.var95OneDayPct || 0) * 6);
    score += Math.min(20, (profile.maxDrawdown100Pct || 0) * 0.8);
    score += Math.max(0, 12 - ((profile.liquidityPercentile || 0) * 0.12));
    if (profile.trendCode === 'BEARISH') score += 8;
    if ((profile.beta60 || 0) > 1.4) score += Math.min(8, ((profile.beta60 - 1.4) * 8));
    profile.riskScore = Math.round(clamp(score));

    if (profile.riskScore <= Number(POLICY.classification.lowRiskScoreMax || 34)) {
      profile.riskCode = 'LOW';
      profile.riskLabelAr = 'مخاطر منخفضة نسبيًا';
    } else if (profile.riskScore <= Number(POLICY.classification.mediumRiskScoreMax || 64)) {
      profile.riskCode = 'MEDIUM';
      profile.riskLabelAr = 'مخاطر متوسطة';
    } else {
      profile.riskCode = 'HIGH';
      profile.riskLabelAr = 'مخاطر مرتفعة';
    }
  }

  const profileMap = new Map(rawProfiles.map(item => [item.ticker, item]));
  const tickers = rawProfiles.map(item => item.ticker);
  const neighborMap = new Map(tickers.map(ticker => [ticker, []]));

  for (let i = 0; i < tickers.length; i += 1) {
    for (let j = i + 1; j < tickers.length; j += 1) {
      const tickerA = tickers[i], tickerB = tickers[j];
      const aligned = alignMaps(returnMaps.get(tickerA), returnMaps.get(tickerB), corrLookback);
      if (aligned.dates.length < minOverlap) continue;
      const corr = correlation(aligned.a, aligned.b);
      if (!Number.isFinite(corr)) continue;
      neighborMap.get(tickerA).push({ ticker: tickerB, correlation: corr, overlapSessions: aligned.dates.length });
      neighborMap.get(tickerB).push({ ticker: tickerA, correlation: corr, overlapSessions: aligned.dates.length });
    }
  }

  for (const profile of rawProfiles) {
    profile.topCorrelated = neighborMap.get(profile.ticker)
      .filter(item => item.correlation > 0)
      .sort((a, b) => b.correlation - a.correlation)
      .slice(0, 8)
      .map(item => ({
        ticker: item.ticker,
        companyNameAr: profileMap.get(item.ticker)?.companyNameAr || '',
        sector: profileMap.get(item.ticker)?.sector || 'غير مصنف',
        correlation: round(item.correlation, 3),
        overlapSessions: item.overlapSessions
      }));
  }

  const recommendationData = recommendationCandidates();
  const candidates = recommendationData.candidates.map(candidate => {
    const risk = profileMap.get(candidate.ticker);
    const referenceEntry = Number.isFinite(candidate.plan.entryHigh)
      ? candidate.plan.entryHigh
      : candidate.plan.entryLow;
    const stopDistancePct =
      Number.isFinite(referenceEntry) && Number.isFinite(candidate.plan.stopLoss) && referenceEntry > 0
        ? ((referenceEntry - candidate.plan.stopLoss) / referenceEntry) * 100
        : null;

    const allocationReady =
      candidate.status === 'PAPER_READY'
      && Number.isFinite(referenceEntry)
      && Number.isFinite(candidate.plan.stopLoss)
      && referenceEntry > candidate.plan.stopLoss
      && Number.isFinite(risk?.averageTurnover20Egp)
      && risk.averageTurnover20Egp > 0;

    return {
      ...candidate,
      referenceEntry: round(referenceEntry, 3),
      stopDistancePct: round(stopDistancePct, 3),
      allocationReady,
      riskProfile: risk ? {
        riskScore: risk.riskScore,
        riskCode: risk.riskCode,
        riskLabelAr: risk.riskLabelAr,
        volatility20Pct: risk.volatility20Pct,
        var95OneDayPct: risk.var95OneDayPct,
        maxDrawdown100Pct: risk.maxDrawdown100Pct,
        beta60: risk.beta60,
        liquidityPercentile: risk.liquidityPercentile,
        averageTurnover20Egp: risk.averageTurnover20Egp,
        sector: risk.sector,
        topCorrelated: risk.topCorrelated
      } : null
    };
  });

  const output = {
    schemaVersion: '13.8.0',
    generatedAt: new Date().toISOString(),
    sessionId: recommendationData.sessionId || STOCK_INDEX.sessionId || null,
    liveExecutionEnabled: false,
    paperSimulationOnly: true,
    marketRegime: recommendationData.marketRegime,
    counts: {
      historySymbols: histories.size,
      riskProfiles: rawProfiles.length,
      recommendationCandidates: candidates.length,
      allocationReadyCandidates: candidates.filter(item => item.allocationReady).length,
      highRiskSymbols: rawProfiles.filter(item => item.riskCode === 'HIGH').length,
      lowRiskSymbols: rawProfiles.filter(item => item.riskCode === 'LOW').length
    },
    policy: {
      defaultRiskPerTradePct: POLICY.risk.defaultRiskPerTradePct,
      maximumStockWeightPct: POLICY.risk.maximumStockWeightPct,
      maximumSectorWeightPct: POLICY.risk.maximumSectorWeightPct,
      maximumLiquidityParticipationPct: POLICY.risk.maximumLiquidityParticipationPct,
      correlationWarning: POLICY.risk.correlationWarning,
      correlationBlock: POLICY.risk.correlationBlock,
      maximumOpenPaperPositions: POLICY.risk.maximumOpenPaperPositions
    },
    candidates,
    profiles: rawProfiles.sort((a, b) => a.ticker.localeCompare(b.ticker)),
    safety: [
      'Position sizes are paper-simulation limits only and are never submitted to a broker.',
      'Portfolio and decision journal stay in browser localStorage only.',
      'Missing entry, stop, price, or liquidity data blocks allocation instead of estimating values.',
      'Correlation is historical and does not guarantee future diversification.'
    ]
  };

  writeJson(OUTPUT_PATH, output);
  console.log(`V13.8 built ${rawProfiles.length} risk profiles and ${candidates.length} candidates.`);
}

try { main(); }
catch (error) {
  console.error(error.stack || error.message);
  process.exit(1);
}
