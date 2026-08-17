'use strict';

const config = require('./config');
const { clamp } = require('./core');

const ratingValue = Object.freeze({ STRONG_BUY: 1, BUY: 0.9, OVERWEIGHT: 0.75, ACCUMULATE: 0.65, HOLD: 0, NEUTRAL: 0, UNDERWEIGHT: -0.75, REDUCE: -0.65, SELL: -0.9, STRONG_SELL: -1 });

function sourceQuality(type) { return config.broker.sourceQuality[type] ?? 0; }
function freshnessWeight(ageSessions) {
  const age = Number.isFinite(ageSessions) ? Math.max(0, ageSessions) : Infinity;
  return config.broker.freshness.find(x => age <= x.maxSessions).weight;
}
function trackRecordFactor(stat = {}) {
  const n = Number(stat.samples || 0);
  if (!n) return 0.70;
  const hit = clamp(Number(stat.tpBeforeSlRate ?? 0.5));
  const exp = clamp((Number(stat.expectancyPct ?? 0) + 0.05) / 0.10);
  const evidence = clamp(n / 60);
  const learned = 0.60 + 0.45 * hit + 0.20 * (exp - 0.5);
  return clamp(0.75 * (1 - evidence) + learned * evidence, 0.55, 1.25);
}
function originKey(r) {
  return String(r.originReportId || r.canonicalUrl || `${r.source}|${r.ticker}|${r.publishedAt}|${r.rating}|${r.target ?? ''}`).trim().toLowerCase();
}
function dedupe(recommendations) {
  const seen = new Set();
  return recommendations.filter(r => { const k = originKey(r); if (seen.has(k)) return false; seen.add(k); return true; });
}
function normalizeRecommendation(raw) {
  const rating = String(raw.rating || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return {
    ticker: String(raw.ticker || '').trim().toUpperCase(), source: String(raw.source || 'UNKNOWN').trim(),
    sourceType: String(raw.sourceType || 'UNKNOWN').trim().toUpperCase(), publishedAt: raw.publishedAt || null,
    ageSessions: Number.isFinite(raw.ageSessions) ? raw.ageSessions : Infinity, rating,
    target: Number.isFinite(raw.target) ? raw.target : null, stop: Number.isFinite(raw.stop) ? raw.stop : null,
    entry: raw.entry || null, horizon: String(raw.horizon || 'SHORT_TERM').toUpperCase(), verified: raw.verified !== false,
    originReportId: raw.originReportId || null, canonicalUrl: raw.canonicalUrl || null,
  };
}
function buildBrokerConsensus(ticker, rawRecommendations = [], sourceStats = {}) {
  const normalized = dedupe(rawRecommendations.map(normalizeRecommendation)).filter(r => r.ticker === ticker.toUpperCase() && r.verified && sourceQuality(r.sourceType) > 0);
  const usable = normalized.filter(r => freshnessWeight(r.ageSessions) > 0 && r.horizon !== 'LONG_TERM_FUNDAMENTAL');
  let weighted = 0, denom = 0;
  const sourceSet = new Set();
  const details = [];
  for (const r of usable) {
    const q = sourceQuality(r.sourceType), fresh = freshnessWeight(r.ageSessions), record = trackRecordFactor(sourceStats[r.source]);
    const w = q * fresh * record, direction = ratingValue[r.rating] ?? 0;
    weighted += direction * w; denom += w; sourceSet.add(r.source.toLowerCase());
    details.push({ source: r.source, rating: r.rating, quality: q, freshness: fresh, trackRecord: record, weightedDirection: direction * w });
  }
  const rawScore = denom ? weighted / denom : 0;
  const independentSources = sourceSet.size;
  const evidenceFactor = independentSources >= config.broker.minSourcesForConsensus ? 1 : independentSources === 1 ? 0.55 : 0;
  return {
    ticker: ticker.toUpperCase(), independentSources, usableRecommendations: usable.length,
    consensusScore: clamp((rawScore + 1) / 2) * 100,
    direction: rawScore > 0.20 ? 'BULLISH' : rawScore < -0.20 ? 'BEARISH' : 'NEUTRAL',
    adjustmentPoints: Math.max(-config.broker.maxInfluencePoints, Math.min(config.broker.maxInfluencePoints, rawScore * evidenceFactor * config.broker.maxInfluencePoints)),
    details,
    longTermFundamentalBias: normalized.filter(r => r.horizon === 'LONG_TERM_FUNDAMENTAL'),
  };
}

module.exports = { normalizeRecommendation, dedupe, freshnessWeight, sourceQuality, trackRecordFactor, buildBrokerConsensus };
