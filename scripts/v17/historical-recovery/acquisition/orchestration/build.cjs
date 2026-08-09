#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { fundamentalConfidence, positiveDecisionEligible } = require('../quality/gates.cjs');
const { calculateSameCurrencyValuation } = require('../fundamentals/valuation.cjs');

const PILOT_TICKERS = Object.freeze(['SKPC', 'ELEC', 'SUGR', 'SPMD', 'IRON', 'AREH', 'NAHO', 'ODIN', 'CFGH']);
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const METADATA_FIELDS = new Set(['periodEnd', 'periodType', 'comparable', 'comparisonBasis', 'statementScope', 'currency', 'publicationDate', 'effectiveAvailableDate', 'retrievedAt', 'documentId', 'parserStatus', 'reason', 'months']);
const INCOME_FIELDS = new Set(['revenue', 'grossProfit', 'operatingProfit', 'ebitda', 'interestExpense', 'profitBeforeTax', 'netProfit', 'netIncomeAttributable', 'eps']);
const BALANCE_FIELDS = new Set(['totalAssets', 'currentAssets', 'cash', 'inventory', 'receivables', 'totalLiabilities', 'currentLiabilities', 'shortTermDebt', 'longTermDebt', 'totalDebt', 'totalEquity', 'sharesOutstanding', 'oneOffGoodwillImpairment']);

function buildDataPoints(company) {
  const periods = [...(company.periods || []), ...(company.interimPeriods || [])];
  return periods.flatMap(period => Object.entries(period).filter(([metric, value]) => !METADATA_FIELDS.has(metric) && Number.isFinite(Number(value))).map(([metric, normalizedValue]) => {
    const group = INCOME_FIELDS.has(metric) ? 'incomeStatement' : BALANCE_FIELDS.has(metric) ? 'balanceSheet' : ['operatingCashFlow', 'capex', 'investingCashFlow', 'financingCashFlow'].includes(metric) ? 'cashFlow' : 'earningsReleaseSummary';
    const evidence = company.fieldEvidence?.[metric] || company.fieldEvidence?.[group] || company.fieldEvidence?.earningsReleaseSummary || {};
    const unitScale = Number(evidence.unitScale || 1);
    return {
      metric,
      reportingPeriodEnd: period.periodEnd,
      periodType: period.periodType,
      statementScope: period.statementScope,
      currency: period.currency,
      unitScale,
      reportedValue: Number(normalizedValue) / unitScale,
      normalizedValue: Number(normalizedValue),
      normalizationMethod: evidence.derivation ? `DERIVED:${evidence.derivation}` : unitScale === 1 ? 'REPORTED_UNIT_1' : `REPORTED_SCALED_BY_${unitScale}`,
      documentId: period.documentId,
      pageReferences: evidence.pages || [],
      effectiveAvailableDate: period.effectiveAvailableDate,
    };
  }));
}
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

function buildAcquisitionArtifacts({ identityRegistry, pilotEvidence, sourceState, documentIndex, disclosureReview, market, asOf = new Date() }) {
  const identityByTicker = new Map(identityRegistry.companies.map(company => [company.ticker, company]));
  const marketByTicker = new Map(market.results.map(company => [company.ticker, company]));
  const evidenceByTicker = new Map(pilotEvidence.companies.map(company => [company.ticker, company]));
  const companies = [];
  const reviewQueues = {
    companyIdentity: [], financialDocument: [], publicationTiming: [], currencyUnit: [], sourceConflict: [], corporateAction: [], disclosure: [], newsClassification: [],
  };
  for (const ticker of PILOT_TICKERS) {
    const identity = identityByTicker.get(ticker);
    const evidence = evidenceByTicker.get(ticker);
    const uncovered = pilotEvidence.uncovered.find(row => row.ticker === ticker) || null;
    if (!identity || ['LOW', 'REJECTED'].includes(identity.identityConfidence)) {
      reviewQueues.companyIdentity.push({ ticker, reason: identity ? 'IDENTITY_CONFIDENCE_LOW' : 'IDENTITY_REGISTRY_ENTRY_MISSING' });
    }
    let normalized = null;
    if (evidence && ['HIGH', 'MEDIUM'].includes(identity?.identityConfidence)) {
      normalized = {
        ...evidence,
        dataPoints: buildDataPoints(evidence),
        valuation: calculateSameCurrencyValuation(evidence, marketByTicker.get(ticker), asOf),
      };
    }
    if (uncovered) reviewQueues.financialDocument.push(uncovered);
    if (evidence?.missingFields?.some(code => /UNIT|CURRENCY/.test(code))) reviewQueues.currencyUnit.push({ ticker, reasons: evidence.missingFields.filter(code => /UNIT|CURRENCY/.test(code)) });
    const confidence = normalized ? fundamentalConfidence(normalized) : 'UNAVAILABLE';
    const eligibility = normalized ? positiveDecisionEligible(normalized) : { eligible: false, confidence, issues: ['NO_VERIFIED_FINANCIAL_EVIDENCE'] };
    companies.push({
      ticker,
      companyNameAr: identity?.displayNameAr || null,
      companyNameEn: identity?.displayNameEn || null,
      identityConfidence: identity?.identityConfidence || 'REJECTED',
      financialCoverage: confidence,
      integratedPositiveEligibility: eligibility,
      latestFinancialPeriod: normalized?.periods?.filter(row => row.comparable !== false).at(-1)?.periodEnd || normalized?.interimPeriods?.at(-1)?.periodEnd || null,
      latestPublicationDate: normalized?.periods?.filter(row => row.comparable !== false).at(-1)?.publicationDate || normalized?.interimPeriods?.at(-1)?.publicationDate || null,
      statementScope: normalized?.statementScope || null,
      sourceType: normalized?.provenance?.[0]?.source || null,
      sourceUrl: normalized?.provenance?.[0]?.sourceUrl || null,
      missingFields: normalized?.missingFields || [uncovered?.reason || 'NO_VERIFIED_FINANCIAL_EVIDENCE'],
      valuationStatus: normalized?.valuation?.status || 'VALUATION_DATA_INSUFFICIENT',
    });
  }
  reviewQueues.disclosure = disclosureReview.reviewQueue;
  reviewQueues.publicationTiming = disclosureReview.reviewQueue.filter(item => /PUBLICATION|TIMESTAMP/.test(String(item.reason || '')));
  const financialCounts = companies.reduce((acc, row) => { acc[row.financialCoverage] = (acc[row.financialCoverage] || 0) + 1; return acc; }, { HIGH: 0, MEDIUM: 0, LOW: 0, UNAVAILABLE: 0 });
  const sourceCounts = sourceState.states.reduce((acc, row) => { acc[row.sourceStatus] = (acc[row.sourceStatus] || 0) + 1; return acc; }, { HEALTHY: 0, DEGRADED: 0, STALE: 0, FAILED: 0 });
  const officialCoverageTickers = ['SKPC', 'NAHO', 'CFGH'];
  const current = {
    schemaVersion: '17.5.0-acquisition-current-1',
    generatedAt: asOf.toISOString(),
    scope: 'PHASE_A_NINE_STOCK_PILOT',
    researchOnly: true,
    summary: {
      pilotCompanies: PILOT_TICKERS.length,
      identityConfidence: {
        HIGH: companies.filter(row => row.identityConfidence === 'HIGH').length,
        MEDIUM: companies.filter(row => row.identityConfidence === 'MEDIUM').length,
        LOW: companies.filter(row => row.identityConfidence === 'LOW').length,
        REJECTED: companies.filter(row => row.identityConfidence === 'REJECTED').length,
      },
      financialCoverage: financialCounts,
      normalizedFinancialCompanies: companies.filter(row => row.financialCoverage !== 'UNAVAILABLE').length,
      scoredFinancialCompanies: companies.filter(row => row.financialCoverage === 'HIGH' || row.financialCoverage === 'MEDIUM').length,
      officialDisclosureCoverage: officialCoverageTickers.length,
      verifiedSecondaryNewsCoverage: 0,
      verifiedDecisionEligibleEvents: disclosureReview.verifiedCanonicalEvents.length,
      sourceHealth: sourceCounts,
    },
    companies,
    reviewQueues,
    sourceState: sourceState.states,
    documentCount: documentIndex.documents.length,
    rawDocumentsGitTracked: false,
    limitationsAr: [
      'التغطية الحالية تجربة تحقق لتسع شركات فقط وليست تغطية للسوق بالكامل.',
      'غياب التغطية لا يمثل رأيًا سلبيًا في الشركة.',
      'الإفصاحات التي لم يُتحقق من توقيت نشرها تبقى في المراجعة ولا تغير أثر الأخبار.',
    ],
  };
  const verifiedInput = {
    schemaVersion: '17.5.0-fundamental-input-1',
    asOf: asOf.toISOString(),
    scope: 'PHASE_A_NINE_STOCK_PILOT',
    status: 'PARTIAL_VERIFIED_PRIMARY_EVIDENCE',
    researchOnly: true,
    companies: pilotEvidence.companies
      .filter(company => ['HIGH', 'MEDIUM'].includes(identityByTicker.get(company.ticker)?.identityConfidence))
      .map(company => ({ ...company, dataPoints: buildDataPoints(company), valuation: calculateSameCurrencyValuation(company, marketByTicker.get(company.ticker), asOf) })),
    notesAr: current.limitationsAr,
  };
  const verifiedEvents = {
    schemaVersion: '17.5.0-verified-events-1',
    asOf: asOf.toISOString(),
    sourceHealth: 'DEGRADED',
    coverageTickers: officialCoverageTickers,
    officialCoverageTickers,
    verifiedSecondaryCoverageTickers: [],
    events: disclosureReview.verifiedCanonicalEvents,
    reviewQueue: disclosureReview.reviewQueue,
    notesAr: ['تم فحص مصادر رسمية محددة للشركات الثلاث، ولا يعني عدم وجود حدث موثق أنه لا توجد أخبار أخرى.', 'لا تدخل الأحداث غير مكتملة توقيت النشر في درجة الأثر.'],
  };
  return { current, verifiedInput, verifiedEvents };
}

function run(root = path.resolve(process.env.GITHUB_WORKSPACE || '.'), asOf = new Date()) {
  const base = path.join(root, 'data/v17/historical-recovery');
  const acquisition = path.join(base, 'acquisition');
  const artifacts = buildAcquisitionArtifacts({
    identityRegistry: readJson(path.join(acquisition, 'identity-registry.json')),
    pilotEvidence: readJson(path.join(acquisition, 'pilot-evidence.json')),
    sourceState: readJson(path.join(acquisition, 'source-state.json')),
    documentIndex: readJson(path.join(acquisition, 'document-index.json')),
    disclosureReview: readJson(path.join(acquisition, 'disclosure-review.json')),
    market: readJson(path.join(base, 'long-history/compact-market.json')),
    asOf,
  });
  writeJsonAtomic(path.join(acquisition, 'current.json'), artifacts.current);
  writeJsonAtomic(path.join(base, 'fundamentals/verified-input.json'), artifacts.verifiedInput);
  writeJsonAtomic(path.join(base, 'news/verified-events.json'), artifacts.verifiedEvents);
  return artifacts;
}

if (require.main === module) console.log(JSON.stringify(run().current.summary, null, 2));
module.exports = { PILOT_TICKERS, buildDataPoints, buildAcquisitionArtifacts, run };
