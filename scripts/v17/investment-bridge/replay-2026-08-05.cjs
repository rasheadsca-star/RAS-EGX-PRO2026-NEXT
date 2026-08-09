#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { analyze } = require('../historical-recovery/long-history/build-market.cjs');
const { buildFundamentalDataset } = require('../historical-recovery/fundamentals/build.cjs');
const { buildNewsDataset } = require('../historical-recovery/news/engine.cjs');
const { integrateStock } = require('../historical-recovery/intelligence/integrated-model.cjs');
const { evaluateConversionGate } = require('./gates.cjs');
const { toPublicDataset } = require('./build.cjs');
const { writeJsonAtomic } = require('./io.cjs');

const SIGNAL_ID = '2026-08-05:V16_9_EQUAL_WEIGHT_BASKET';
const AS_OF = '2026-08-05';
const TICKERS = ['MOIN', 'GGCC', 'AMER', 'ORWE'];
const dateOnly = value => String(value || '').slice(0, 10);
const availableDate = row => dateOnly(row?.effectiveAvailableDate || row?.publicationDate || row?.retrievedAt);
function filterCompanyAsOf(company, asOf) {
  if (!company) return null;
  const copy = JSON.parse(JSON.stringify(company));
  for (const key of ['periods', 'interimPeriods', 'dataPoints']) if (Array.isArray(copy[key])) copy[key] = copy[key].filter(row => availableDate(row) && availableDate(row) <= asOf);
  const evidence = [...(copy.periods || []), ...(copy.interimPeriods || []), ...(copy.dataPoints || [])];
  return evidence.length ? copy : null;
}
function buildReplay({ root, asOf = AS_OF, historyMutator = null, fundamentalInput = null, newsInput = null, intelligenceSnapshot = null } = {}) {
  root = root || path.resolve(process.env.GITHUB_WORKSPACE || '.');
  const ledger = JSON.parse(fs.readFileSync(path.join(root, 'data/v17/ledger.json'), 'utf8'));
  const signal = ledger.entries.find(row => row.signalId === SIGNAL_ID);
  if (!signal?.outcome?.resolved) throw new Error(`Resolved ledger signal missing: ${SIGNAL_ID}`);
  const fundamentals = fundamentalInput || JSON.parse(fs.readFileSync(path.join(root, 'data/v17/historical-recovery/fundamentals/verified-input.json'), 'utf8'));
  const news = newsInput || JSON.parse(fs.readFileSync(path.join(root, 'data/v17/historical-recovery/news/verified-events.json'), 'utf8'));
  const rows = [];
  for (const ticker of TICKERS) {
    const recommendation = signal.recommendations.find(row => row.ticker === ticker);
    const outcome = signal.outcome.members.find(row => row.ticker === ticker);
    const original = JSON.parse(fs.readFileSync(path.join(root, `data/v17/historical-recovery/history/${ticker}.json`), 'utf8'));
    if (historyMutator) historyMutator(original, ticker);
    const sessions = original.sessions.filter(row => dateOnly(row.date) <= asOf);
    const doc = { ...original, sessions, sessionCount: sessions.length, coverageEnd: sessions.at(-1)?.date || null };
    const market = analyze(doc);
    const company = filterCompanyAsOf((fundamentals.companies || []).find(row => row.ticker === ticker), asOf);
    const fundamental = buildFundamentalDataset({ universe: [market], input: { companies: company ? [company] : [] }, asOf: new Date(`${asOf}T23:59:59Z`) }).results[0];
    const eligibleEvents = (news.events || []).filter(event => dateOnly(event.eventDate) <= asOf && dateOnly(event.effectiveAvailableDate || event.publicationDate || event.retrievedAt || event.eventDate) <= asOf);
    const covered = (news.coverageTickers || []).includes(ticker) && dateOnly(news.asOf) <= asOf;
    const newsResult = buildNewsDataset({ universe: [market], events: eligibleEvents, asOf: new Date(`${asOf}T23:59:59Z`), sourceHealth: 'FAILED', coverageTickers: covered ? [ticker] : [] }).results[0];
    const detail = integrateStock(market, fundamental, newsResult);
    const daily = { ...recommendation, ticker, signalDate: signal.sessionDate, executionStatus: outcome.executable ? 'EXECUTED' : 'UNFILLED', executed: outcome.executable, actualExecutionPrice: outcome.executable ? outcome.open : null };
    const gate = evaluateConversionGate({ daily, historicalDecision: { ticker, detail } });
    rows.push({
      ticker, executable: outcome.executable, executableStatusAr: outcome.executable ? 'قابل للتنفيذ وفق سجل النتيجة' : 'غير منفذ وفق سجل النتيجة',
      executionEvidence: { source: 'data/v17/ledger.json', outcomeDate: outcome.outcomeDate, open: outcome.open, state: outcome.state, entryLow: recommendation.entryLow, entryHigh: recommendation.entryHigh },
      historicalMatch: true, reconstructedAsOf: asOf, reconstructedHigh: detail.historical?.high ?? null, reconstructedHighDate: detail.historical?.highDate ?? null,
      postPeakLow: detail.historical?.postPeakLow ?? null, postPeakLowDate: detail.historical?.postPeakLowDate ?? null, recoveryPositionPct: detail.historical?.recoveryPositionPct ?? null,
      rsi14: detail.technical?.rsi14 ?? null, recoveryScore: detail.technical?.recoveryScore ?? null, strengthScore: detail.technical?.strengthScore ?? null,
      recoveryStageAr: detail.technical?.recoveryStageAr ?? null, fundamentalsAvailableAsOf: fundamental.fundamentalDataConfidence !== 'UNAVAILABLE',
      newsAvailableAsOf: newsResult.coverageStatus !== 'SOURCE_COVERAGE_UNAVAILABLE', corporateActionConfidenceAsOf: detail.historicalDataQuality?.corporateActionConfidence ?? null,
      bridgeClassificationAr: gate.classificationAr, conversionAllowed: gate.passed, exactGateReasonsAr: gate.reasonsAr,
    });
  }
  return { schemaVersion: '17.0.0-investment-bridge-replay-1', signalId: SIGNAL_ID, asOf, intelligenceSnapshotUsed: false, intelligenceSnapshotIgnored: Boolean(intelligenceSnapshot), priceCutoffInclusive: asOf, rows };
}
function run(root = path.resolve(process.env.GITHUB_WORKSPACE || '.')) {
  const replay = toPublicDataset(buildReplay({ root }));
  writeJsonAtomic(path.join(root, 'data/v17/investment-bridge/replay-2026-08-05.json'), replay);
  return replay;
}
if (require.main === module) console.log(JSON.stringify(run(), null, 2));
module.exports = { SIGNAL_ID, AS_OF, TICKERS, filterCompanyAsOf, buildReplay, run };
