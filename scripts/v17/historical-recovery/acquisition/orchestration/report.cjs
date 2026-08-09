#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { PILOT_TICKERS } = require('./build.cjs');

function finite(value) { return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)); }

function buildPilotReport({ acquisition, integrated, documentIndex, disclosureReview, asOf = new Date() }) {
  const acquisitionByTicker = new Map(acquisition.companies.map(row => [row.ticker, row]));
  const integratedByTicker = new Map(integrated.results.map(row => [row.ticker, row]));
  const companies = PILOT_TICKERS.map(ticker => {
    const coverage = acquisitionByTicker.get(ticker);
    const row = integratedByTicker.get(ticker);
    const metrics = row?.fundamental?.metrics;
    const latestEvidence = metrics?.latest || row?.fundamental?.latestInterimPeriod || {};
    const latestOfficial = disclosureReview.verifiedCanonicalEvents.filter(event => event.ticker === ticker).sort((a, b) => String(b.publicationTimestamp).localeCompare(String(a.publicationTimestamp))).at(0) || null;
    const latestNews = (row?.news?.materialEvents || []).filter(event => event.decisionEligible).at(0) || null;
    return {
      company: coverage?.companyNameAr || row?.companyNameAr || null,
      ticker,
      latestFinancialPeriod: row?.fundamental?.latestReportingPeriod || null,
      financialSource: row?.fundamental?.provenance?.[0]?.source || null,
      financialSourceUrl: row?.fundamental?.provenance?.[0]?.sourceUrl || null,
      fundamentalDataConfidence: row?.fundamental?.fundamentalDataConfidence || 'UNAVAILABLE',
      revenue: latestEvidence.revenue ?? null,
      revenueTrendPct: metrics?.revenueGrowthPct ?? null,
      netProfit: latestEvidence.netProfit ?? null,
      profitTrendPct: metrics?.earningsGrowthPct ?? null,
      operatingCashFlow: latestEvidence.operatingCashFlow ?? null,
      debtToEquity: metrics?.debtToEquity ?? null,
      sectorEquivalent: row?.fundamental?.sectorModel === 'NON_BANK_FINANCIAL' ? 'SECTOR_METRICS_INSUFFICIENT' : null,
      fundamentalQuality: row?.fundamental?.fundamentalQualityScore ?? null,
      financialRisk: row?.risk?.classification || 'UNAVAILABLE',
      valuationScore: row?.fundamental?.valuation?.score ?? null,
      valueTrapRisk: row?.valueTrapRisk?.classification || 'UNAVAILABLE',
      latestMaterialOfficialDisclosure: latestOfficial,
      latestMaterialVerifiedNews: latestNews,
      newsImpact: row?.news?.newsImpactScore ?? null,
      integratedInvestmentResearchScore: row?.investmentResearchScore ?? null,
      previousClassification: row?.previousDecision || null,
      currentClassification: row?.classificationCode || null,
      decisionChanged: row?.decisionChanged || false,
      changeTypes: row?.changeTypes || [],
      whyAr: row?.changeReasonsAr || [],
      missingFields: coverage?.missingFields || [],
    };
  });
  const parserCritical = documentIndex.documents.filter(document => document.parserStatus === 'PARSER_REVIEW_REQUIRED');
  const identityUnresolved = acquisition.companies.filter(row => ['LOW', 'REJECTED'].includes(row.identityConfidence));
  return {
    schemaVersion: '17.5.0-pilot-report-1',
    generatedAt: asOf.toISOString(),
    scope: 'PHASE_A_NINE_STOCK_PILOT',
    researchOnly: true,
    companies,
    summary: {
      pilotCompanies: companies.length,
      identityVerifiedHighOrMedium: acquisition.companies.filter(row => ['HIGH', 'MEDIUM'].includes(row.identityConfidence)).length,
      normalizedFinancialCoverage: companies.filter(row => row.fundamentalDataConfidence !== 'UNAVAILABLE').length,
      scoredFinancialCoverage: companies.filter(row => finite(row.fundamentalQuality)).length,
      officialDisclosureCoverage: integrated.summary.officialDisclosureCoverage,
      verifiedSecondaryNewsCoverage: integrated.summary.verifiedSecondaryNewsCoverage,
      integratedFullCoverage: companies.filter(row => finite(row.integratedInvestmentResearchScore)).length,
      valueTrapDetected: companies.filter(row => row.valueTrapRisk === 'HIGH').length,
      valueTrapPossible: companies.filter(row => row.valueTrapRisk === 'MEDIUM').length,
      valueTrapCannotAssess: companies.filter(row => row.valueTrapRisk === 'UNAVAILABLE').length,
      changedDecisions: companies.filter(row => row.decisionChanged).length,
    },
    top30ExpansionGate: {
      eligible: parserCritical.length === 0 && identityUnresolved.length === 0 && companies.every(row => row.fundamentalDataConfidence !== 'UNAVAILABLE'),
      parserCriticalFailures: parserCritical.map(row => ({ ticker: row.ticker, documentId: row.documentId, reason: 'PARSER_REVIEW_REQUIRED' })),
      identityUnresolved: identityUnresolved.map(row => ({ ticker: row.ticker, identityConfidence: row.identityConfidence })),
      uncoveredPilotCompanies: companies.filter(row => row.fundamentalDataConfidence === 'UNAVAILABLE').map(row => row.ticker),
      decision: 'BLOCKED_PENDING_PILOT_EVIDENCE_COMPLETION',
    },
    disclosureDeduplication: disclosureReview.deduplication,
  };
}

function run(root = path.resolve(process.env.GITHUB_WORKSPACE || '.'), asOf = new Date()) {
  const base = path.join(root, 'data/v17/historical-recovery');
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const report = buildPilotReport({
    acquisition: read(path.join(base, 'acquisition/current.json')),
    integrated: read(path.join(base, 'integrated-market.json')),
    documentIndex: read(path.join(base, 'acquisition/document-index.json')),
    disclosureReview: read(path.join(base, 'acquisition/disclosure-review.json')),
    asOf,
  });
  const file = path.join(base, 'acquisition/pilot-report.json');
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`);
  fs.renameSync(temporary, file);
  return report;
}

if (require.main === module) console.log(JSON.stringify(run().summary, null, 2));
module.exports = { buildPilotReport, run };
