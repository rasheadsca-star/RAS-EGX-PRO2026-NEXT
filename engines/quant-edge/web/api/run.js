'use strict';

const OWNER = 'rasheadsca-star';
const REPO = 'RAS-EGX-PRO2026-NEXT';
const BRANCH = 'develop/v17-rebuild';
const BASE = 'engines/quant-edge/data';

async function readJson(path) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${encodeURIComponent(BRANCH)}`;
  const res = await fetch(url, {
    headers: {
      accept: 'application/vnd.github.raw+json',
      'user-agent': 'quant-edge-arabic-web-shadow'
    },
    cache: 'no-store'
  });
  if (!res.ok) throw new Error(`SOURCE_READ_FAILED:${res.status}:${path}`);
  return JSON.parse(await res.text());
}

module.exports = async function handler(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    const [manifest, shadow, calibration, brokers, acceptance, comparison] = await Promise.all([
      readJson(`${BASE}/manifest.json`),
      readJson(`${BASE}/shadow-latest.json`),
      readJson(`${BASE}/calibration.json`),
      readJson(`${BASE}/broker-collection.json`),
      readJson(`${BASE}/acceptance-report.json`),
      readJson(`${BASE}/vs-main-latest.json`)
    ]);

    const comparisonMap = new Map((comparison.rows || []).map(r => [r.ticker, r.classification]));
    const recommendations = (shadow.recommendations || []).map(r => ({
      ticker: r.ticker,
      status: r.status,
      direction: r.direction,
      regime: r.regime,
      selectedSetup: r.selectedSetup,
      coreConfidence: r.coreConfidence,
      finalConfidence: r.finalConfidence,
      probability: r.probability,
      brokerIntelligence: r.brokerIntelligence,
      trade: r.trade,
      features: {
        close: r.features?.close,
        volumeRatio: r.features?.volumeRatio,
        liquidityScore: r.features?.liquidityScore,
        momentum20: r.features?.momentum20,
        relativeStrengthMarket: r.features?.relativeStrengthMarket
      },
      executionAllowed: false,
      comparison: comparisonMap.get(r.ticker) || 'QUANT_ONLY'
    }));

    const diagnostics = manifest.summary || {};
    const usable = diagnostics.universeAnalyzed || 0;
    const discovered = diagnostics.universeDiscovered || 0;

    res.status(200).json({
      engine: 'QUANT EDGE',
      engineVersion: manifest.engineVersion || '1.1.0-shadow',
      mode: 'SHADOW',
      executionAllowed: false,
      generatedAt: new Date().toISOString(),
      asOf: manifest.asOf,
      sourceGrade: 'ANALYSIS_GRADE',
      benchmark: 'QE_EQUAL_WEIGHT_MARKET',
      benchmarkSynthetic: true,
      universe: {
        discovered,
        analyzed: usable,
        coverage: discovered ? usable / discovered : 0
      },
      calibration: {
        ready: Boolean(calibration.calibrationReady),
        completedSignals: calibration.totalCompletedSignals || 0,
        validationSignals: calibration.validationSignals || 0,
        method: calibration.method,
        brierTp1: calibration.validation?.tp1?.brier ?? null,
        brierTp2: calibration.validation?.tp2?.brier ?? null
      },
      brokers: {
        verifiedRecommendations: (brokers.recommendations || []).length,
        diagnostics: brokers.diagnostics || []
      },
      acceptance: {
        status: acceptance.status,
        counts: acceptance.counts
      },
      recommendationCount: recommendations.length,
      recommendations,
      rejectedCount: Math.max(0, usable - recommendations.length),
      manifestGeneratedAt: manifest.generatedAt,
      warnings: [
        'DIRECT_BENCHMARK_UNAVAILABLE_USING_INDEPENDENT_EQUAL_WEIGHT_BENCHMARK',
        ...((brokers.recommendations || []).length ? [] : ['NO_VERIFIED_PUBLIC_BROKER_RECOMMENDATIONS_IN_CURRENT_RUN'])
      ]
    });
  } catch (err) {
    res.status(502).json({
      engine: 'QUANT EDGE',
      mode: 'SHADOW',
      executionAllowed: false,
      error: 'تعذر قراءة أحدث نتائج المحرك',
      message: err.message
    });
  }
};
