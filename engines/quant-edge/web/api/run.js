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

function cairoParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(now);
  const o = Object.fromEntries(parts.map(p => [p.type,p.value]));
  return {year:+o.year,month:+o.month,day:+o.day,hour:+o.hour,minute:+o.minute};
}
function ymd(p){return `${String(p.year).padStart(4,'0')}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`}
function shift(date,days){const [y,m,d]=date.split('-').map(Number),x=new Date(Date.UTC(y,m-1,d));x.setUTCDate(x.getUTCDate()+days);return x.toISOString().slice(0,10)}
function tradingDay(date){const [y,m,d]=date.split('-').map(Number),dow=new Date(Date.UTC(y,m-1,d)).getUTCDay();return dow>=0&&dow<=4}
function liveRequiredSession(now=new Date()){
  const p=cairoParts(now),today=ymd(p),minutes=p.hour*60+p.minute;
  if(tradingDay(today)&&minutes>=15*60)return today;
  let d=shift(today,-1);for(let i=0;i<10;i++){if(tradingDay(d))return d;d=shift(d,-1)}
  return today;
}

module.exports = async function handler(req, res) {
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    const [manifest, shadow, calibration, brokers, acceptance, comparison, snapshot] = await Promise.all([
      readJson(`${BASE}/manifest.json`),
      readJson(`${BASE}/shadow-latest.json`),
      readJson(`${BASE}/calibration.json`),
      readJson(`${BASE}/broker-collection.json`),
      readJson(`${BASE}/acceptance-report.json`),
      readJson(`${BASE}/vs-main-latest.json`),
      readJson(`${BASE}/independent-snapshot.json`)
    ]);

    const artifactRequired = snapshot.diagnostics?.requiredSession || manifest.freshness?.requiredSession || null;
    const liveRequired = liveRequiredSession();
    const requiredSession = [artifactRequired,liveRequired].filter(Boolean).sort().at(-1) || liveRequired;
    const artifactFresh = snapshot.sourceGrade === 'ANALYSIS_GRADE' && snapshot.diagnostics?.freshness?.isFresh === true;
    const isFresh = artifactFresh && Boolean(snapshot.asOf && snapshot.asOf >= requiredSession);
    const blocked = !isFresh || shadow.blocked === true;
    const blockReason = blocked ? (shadow.blockReason || 'STALE_MARKET_DATA') : null;

    const comparisonMap = new Map((comparison.rows || []).map(r => [r.ticker, r.classification]));
    const rawRecommendations = blocked ? [] : (shadow.recommendations || []);
    const recommendations = rawRecommendations.map(r => ({
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
    const usable = snapshot.diagnostics?.usableSymbols ?? diagnostics.universeAnalyzed ?? 0;
    const discovered = snapshot.diagnostics?.discoveredSymbols ?? diagnostics.universeDiscovered ?? 0;

    res.status(200).json({
      engine: 'QUANT EDGE',
      engineVersion: manifest.engineVersion || '1.1.0-shadow',
      mode: 'SHADOW',
      executionAllowed: false,
      blocked,
      blockReason,
      generatedAt: new Date().toISOString(),
      asOf: snapshot.asOf || manifest.asOf,
      requiredSession,
      freshness: {
        isFresh,
        actualAsOf: snapshot.asOf || manifest.asOf,
        requiredSession,
        lagSessions: snapshot.diagnostics?.freshness?.lagSessions ?? null,
        fallback: snapshot.diagnostics?.historyFallback || null
      },
      sourceGrade: snapshot.sourceGrade || 'UNKNOWN',
      benchmark: snapshot.benchmark?.symbol || 'QE_EQUAL_WEIGHT_MARKET',
      benchmarkSynthetic: Boolean(snapshot.benchmark?.source?.synthetic),
      universe: {
        discovered,
        analyzed: usable,
        coverage: discovered ? usable / discovered : 0
      },
      calibration: {
        ready: !blocked && Boolean(calibration.calibrationReady),
        completedSignals: calibration.totalCompletedSignals || 0,
        validationSignals: calibration.validationSignals || 0,
        method: calibration.method,
        brierTp1: calibration.validation?.tp1?.brier ?? null,
        brierTp2: calibration.validation?.tp2?.brier ?? null
      },
      brokers: {
        verifiedRecommendations: blocked ? 0 : (brokers.recommendations || []).length,
        diagnostics: brokers.diagnostics || []
      },
      acceptance: {
        status: blocked ? 'BLOCKED_STALE_DATA' : acceptance.status,
        counts: acceptance.counts
      },
      recommendationCount: recommendations.length,
      recommendations,
      rejectedCount: blocked ? usable : Math.max(0, usable - recommendations.length),
      manifestGeneratedAt: manifest.generatedAt,
      warnings: [
        ...(blocked ? ['STALE_MARKET_DATA_BLOCKED'] : []),
        ...(snapshot.diagnostics?.benchmarkWarning ? [snapshot.diagnostics.benchmarkWarning] : []),
        ...((brokers.recommendations || []).length || blocked ? [] : ['NO_VERIFIED_PUBLIC_BROKER_RECOMMENDATIONS_IN_CURRENT_RUN'])
      ]
    });
  } catch (err) {
    res.status(502).json({
      engine: 'QUANT EDGE',
      mode: 'SHADOW',
      executionAllowed: false,
      blocked: true,
      error: 'تعذر قراءة أحدث نتائج المحرك',
      message: err.message
    });
  }
};
