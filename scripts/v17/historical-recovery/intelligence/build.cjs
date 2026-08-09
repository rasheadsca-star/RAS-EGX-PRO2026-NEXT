#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { buildFundamentalDataset } = require('../fundamentals/build.cjs');
const { buildNewsDataset } = require('../news/engine.cjs');
const { integrateStock } = require('./integrated-model.cjs');
const { buildDecisionSnapshot } = require('./decisions.cjs');
const { buildAlerts } = require('./alerts.cjs');
const { deriveSourceHealth } = require('./source-health.cjs');
const { validateIntegratedOutput } = require('./validate.cjs');

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function publishValidatedAtomic(file, value, validator) {
  const result = validator(value);
  if (!result?.valid) throw new Error(`REFUSING_INVALID_PUBLICATION:${(result?.issues || []).join(',')}`);
  writeJsonAtomic(file, value);
  return result;
}

function buildIntegratedDataset({ market, fundamentalInput, newsInput, previousSnapshot = null, previousAlerts = null, asOf = new Date() }) {
  const fundamentals = buildFundamentalDataset({ universe: market.results, input: fundamentalInput, asOf });
  const fundamentalByTicker = new Map(fundamentals.results.map(row => [row.ticker, row]));
  const newsUniverse = market.results.map(stock => ({ ...stock, sectorModel: fundamentalByTicker.get(stock.ticker)?.sectorModel || null }));
  const news = buildNewsDataset({
    universe: newsUniverse,
    events: newsInput.events || [],
    asOf,
    sourceHealth: newsInput.sourceHealth || 'FAILED',
    coverageTickers: newsInput.coverageTickers || [],
    officialCoverageTickers: newsInput.officialCoverageTickers || [],
    verifiedSecondaryCoverageTickers: newsInput.verifiedSecondaryCoverageTickers || [],
  });
  const newsByTicker = new Map(news.results.map(row => [row.ticker, row]));
  const integrated = market.results.map(row => integrateStock(row, fundamentalByTicker.get(row.ticker), newsByTicker.get(row.ticker)));
  const snapshot = buildDecisionSnapshot(integrated, previousSnapshot, asOf, { minimumScoreDelta: 5 });
  const alerts = buildAlerts(snapshot, previousAlerts);
  const sourceHealth = deriveSourceHealth({ market, fundamentals, news, generatedAt: asOf });
  const decisionCounts = snapshot.decisions.reduce((acc, row) => { acc[row.currentDecision] = (acc[row.currentDecision] || 0) + 1; return acc; }, {});
  const summary = {
    canonicalEquityUniverse: market.summary.canonicalOrdinaryEquities,
    priceHistoryCovered: market.summary.successfullyCoveredEquities,
    historicalDataValid: market.summary.validHistoricalData,
    fundamentalCoverage: fundamentals.summary.covered,
    fundamentalScored: fundamentals.summary.scored,
    fundamentalConfidenceCounts: fundamentals.summary.confidenceCounts,
    newsDisclosureCoverage: news.summary.coveredSymbols,
    officialDisclosureCoverage: news.summary.officialCoveredSymbols,
    verifiedSecondaryNewsCoverage: news.summary.verifiedSecondaryCoveredSymbols,
    coveredNoRecentMaterialEvent: news.summary.coveredNoMaterialEvent,
    newsSourceUnavailable: news.summary.sourceUnavailable,
    fullDataCoverage: integrated.filter(x => x.dataCompleteness === 'FULL').length,
    partialDataCoverage: integrated.filter(x => x.dataCompleteness === 'PARTIAL').length,
    unavailableData: integrated.filter(x => x.dataCompleteness === 'UNAVAILABLE').length,
    decisionCounts,
    decisionUpgrades: snapshot.decisions.filter(x => x.changeTypes.includes('CLASSIFICATION_UPGRADE')).length,
    decisionDowngrades: snapshot.decisions.filter(x => x.changeTypes.includes('CLASSIFICATION_DOWNGRADE')).length,
    criticalAlerts: alerts.criticalNewCount,
  };
  const publicDataset = {
    schemaVersion: '17.4.0-integrated-intelligence-1',
    generatedAt: asOf.toISOString(),
    operatingMode: 'INTEGRATED_INVESTMENT_INTELLIGENCE_RESEARCH',
    researchOnly: true,
    independenceStatementAr: 'هذه الأداة مستقلة تمامًا عن سلة التوصيات اليومية.',
    disclaimerAr: 'هذه التصنيفات بحثية وتعتمد على البيانات التاريخية والفنية والمالية والأخبار المتاحة، ولا تمثل توصية شخصية بالشراء أو البيع.',
    summary,
    sourceHealth,
    alerts,
    changes: snapshot.decisions.filter(x => x.decisionChanged),
    results: snapshot.decisions.map(decision => ({
      ...decision.detail,
      previousDecision: decision.previousDecision,
      previousDecisionAr: decision.previousDecisionAr,
      decisionChanged: decision.decisionChanged,
      changeTypes: decision.changeTypes,
      changeReasonsAr: decision.changeReasonsAr,
      changedAt: decision.changedAt,
      lastReviewedAt: asOf.toISOString(),
      decisionValidityAr: decision.detail.decisionState === 'VALID' ? 'ساري' : decision.detail.decisionState === 'REVIEW_REQUIRED' ? 'يحتاج مراجعة' : 'بيانات غير مكتملة',
    })),
  };
  return { fundamentals, news, snapshot, alerts, sourceHealth, publicDataset };
}

function runBuild(root = path.resolve(process.env.GITHUB_WORKSPACE || '.'), asOf = new Date()) {
  const base = path.join(root, 'data/v17/historical-recovery');
  const market = readJson(path.join(base, 'long-history/compact-market.json'));
  const fundamentalInput = readJson(path.join(base, 'fundamentals/verified-input.json'));
  const newsInput = readJson(path.join(base, 'news/verified-events.json'));
  const intelligenceDir = path.join(base, 'intelligence');
  const indexFile = path.join(intelligenceDir, 'history/index.json');
  const currentSnapshotFile = path.join(intelligenceDir, 'current.json');
  const alertFile = path.join(intelligenceDir, 'alerts.json');
  const explicitBaseline = process.env.V17_EVIDENCE_BASELINE_SNAPSHOT;
  const previousSnapshot = explicitBaseline
    ? readJson(path.resolve(root, explicitBaseline))
    : fs.existsSync(currentSnapshotFile) ? readJson(currentSnapshotFile) : null;
  const previousAlerts = fs.existsSync(alertFile) ? readJson(alertFile) : null;
  const built = buildIntegratedDataset({ market, fundamentalInput, newsInput, previousSnapshot, previousAlerts, asOf });
  const validation = validateIntegratedOutput(built.publicDataset);
  if (!validation.valid) throw new Error(`INTEGRATED_OUTPUT_INVALID:${validation.issues.join(',')}`);
  const snapshotFile = path.join(intelligenceDir, 'history', `${built.snapshot.snapshotId}.json`);
  if (fs.existsSync(snapshotFile)) throw new Error(`IMMUTABLE_SNAPSHOT_EXISTS:${snapshotFile}`);
  const index = fs.existsSync(indexFile) ? readJson(indexFile) : { schemaVersion: '17.4.0-decision-history-index-1', snapshots: [] };
  index.snapshots.push({ snapshotId: built.snapshot.snapshotId, generatedAt: built.snapshot.generatedAt, file: `history/${built.snapshot.snapshotId}.json` });
  writeJsonAtomic(path.join(base, 'fundamentals/current.json'), built.fundamentals);
  writeJsonAtomic(path.join(base, 'news/current.json'), built.news);
  writeJsonAtomic(snapshotFile, built.snapshot);
  writeJsonAtomic(indexFile, index);
  writeJsonAtomic(currentSnapshotFile, built.snapshot);
  writeJsonAtomic(alertFile, built.alerts);
  writeJsonAtomic(path.join(intelligenceDir, 'source-health.json'), built.sourceHealth);
  publishValidatedAtomic(path.join(base, 'integrated-market.json'), built.publicDataset, validateIntegratedOutput);
  return built;
}

if (require.main === module) {
  const built = runBuild();
  console.log(JSON.stringify({ summary: built.publicDataset.summary, snapshotId: built.snapshot.snapshotId }, null, 2));
}

module.exports = { writeJsonAtomic, publishValidatedAtomic, buildIntegratedDataset, runBuild };
