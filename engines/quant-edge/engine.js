'use strict';

const config = require('./config');
const { computeFeatures, detectRegime, scoreStrategies, constructTrade } = require('./core');
const { buildBrokerConsensus } = require('./broker-intelligence');
const { confidenceProxy, probabilityView } = require('./probability');

function analyzeSymbol(input, options = {}) {
  const { ticker, bars, benchmarkBars, sectorBars, brokerRecommendations = [], brokerStats = {} } = input;
  if (!ticker) throw new Error('QUANT_EDGE_TICKER_REQUIRED');
  if (!benchmarkBars) throw new Error('QUANT_EDGE_BENCHMARK_REQUIRED');

  const features = computeFeatures(bars, benchmarkBars, sectorBars);
  const regime = detectRegime(benchmarkBars);
  const strategies = scoreStrategies(features, regime);
  const best = strategies[0];
  const coreConfidence = confidenceProxy(features, best.score, regime);
  const coreRejected = coreConfidence < config.engine.minCoreConfidence || features.liquidityScore < config.engine.minLiquidityScore || regime.code === 'RISK_OFF';
  const broker = buildBrokerConsensus(ticker, brokerRecommendations, brokerStats);

  // Research can confirm/reduce an accepted quant signal. It can never rescue a core reject.
  const finalConfidence = coreRejected ? coreConfidence : Math.max(0, Math.min(100, coreConfidence + broker.adjustmentPoints));
  const accepted = !coreRejected && finalConfidence >= config.engine.minCoreConfidence;
  const trade = accepted ? constructTrade(features, regime) : null;
  const probability = probabilityView(coreConfidence, options.calibrator);

  return {
    engine: config.engine.name,
    engineVersion: config.engine.version,
    mode: 'SHADOW',
    executionAllowed: false,
    ticker: ticker.toUpperCase(),
    generatedAt: new Date().toISOString(),
    status: accepted ? (finalConfidence >= config.engine.highConvictionConfidence ? 'HIGH_CONVICTION_BUY' : 'BUY') : 'REJECT',
    direction: accepted ? 'BUY' : 'REJECT',
    regime,
    selectedSetup: best,
    allSetups: strategies,
    coreConfidence,
    brokerIntelligence: broker,
    finalConfidence,
    probability,
    features,
    trade,
    rejectionReasons: accepted ? [] : [
      ...(coreConfidence < config.engine.minCoreConfidence ? ['CORE_CONFIDENCE_BELOW_GATE'] : []),
      ...(features.liquidityScore < config.engine.minLiquidityScore ? ['LIQUIDITY_BELOW_GATE'] : []),
      ...(regime.code === 'RISK_OFF' ? ['MARKET_REGIME_RISK_OFF'] : []),
    ],
    invariants: {
      mainRecommendationImports: false,
      mainScoreImports: false,
      mainRankingImports: false,
      brokerCanFlipCoreReject: false,
      executionBlocked: true,
    },
  };
}

function rankMarket(universe, options = {}) {
  const results = universe.map(x => analyzeSymbol(x, options));
  const accepted = results.filter(x => x.direction === 'BUY').sort((a, b) => b.finalConfidence - a.finalConfidence);
  return {
    engine: config.engine.name,
    mode: 'SHADOW',
    generatedAt: new Date().toISOString(),
    recommendationCount: Math.min(accepted.length, config.engine.maxRecommendations),
    recommendations: accepted.slice(0, config.engine.maxRecommendations),
    rejected: results.filter(x => x.direction === 'REJECT'),
  };
}

function assertShadowSafety() {
  if (!config.engine.shadowMode || config.engine.allowExecution) throw new Error('QUANT_EDGE_EXECUTION_SAFETY_VIOLATION');
  return true;
}

module.exports = { analyzeSymbol, rankMarket, assertShadowSafety };
