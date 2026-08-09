#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { PILOT_TICKERS } = require('./build.cjs');

function validateAcquisition({ current, verifiedInput, verifiedEvents }) {
  const issues = [];
  const tickers = (current?.companies || []).map(row => row.ticker);
  if (tickers.length !== PILOT_TICKERS.length || PILOT_TICKERS.some(ticker => !tickers.includes(ticker))) issues.push('PILOT_UNIVERSE_MISMATCH');
  for (const company of verifiedInput?.companies || []) {
    if (!['HIGH', 'MEDIUM'].includes(company.identityConfidence)) issues.push(`LOW_IDENTITY_ENTERED_MODEL:${company.ticker}`);
    if (!company.provenance?.length) issues.push(`PROVENANCE_REQUIRED:${company.ticker}`);
    for (const period of company.periods || []) {
      if (!period.currency || !period.statementScope || !period.periodType || !period.documentId) issues.push(`PERIOD_METADATA_INCOMPLETE:${company.ticker}:${period.periodEnd}`);
      if (!period.effectiveAvailableDate || !period.retrievedAt) issues.push(`POINT_IN_TIME_METADATA_INCOMPLETE:${company.ticker}:${period.periodEnd}`);
    }
    for (const point of company.dataPoints || []) {
      for (const field of ['metric', 'reportingPeriodEnd', 'periodType', 'statementScope', 'currency', 'unitScale', 'reportedValue', 'normalizedValue', 'normalizationMethod', 'documentId', 'effectiveAvailableDate']) {
        if (point[field] === null || point[field] === undefined || point[field] === '') issues.push(`DATAPOINT_FIELD_REQUIRED:${company.ticker}:${point.metric || 'UNKNOWN'}:${field}`);
      }
    }
    if ((company.periods?.length || company.interimPeriods?.length) && !company.dataPoints?.length) issues.push(`DATAPOINT_PROVENANCE_REQUIRED:${company.ticker}`);
  }
  if ((verifiedEvents?.events || []).some(event => !event.publicationTimestamp)) issues.push('UNTIMED_EVENT_ENTERED_DECISION_MODEL');
  if (current?.rawDocumentsGitTracked !== false) issues.push('RAW_DOCUMENT_STORAGE_POLICY_VIOLATION');
  const counts = current?.summary?.financialCoverage || {};
  if (['HIGH', 'MEDIUM', 'LOW', 'UNAVAILABLE'].reduce((sum, key) => sum + Number(counts[key] || 0), 0) !== PILOT_TICKERS.length) issues.push('FINANCIAL_COVERAGE_NOT_RECONCILED');
  return { valid: issues.length === 0, issues };
}

if (require.main === module) {
  const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
  const base = path.join(root, 'data/v17/historical-recovery');
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = validateAcquisition({ current: read(path.join(base, 'acquisition/current.json')), verifiedInput: read(path.join(base, 'fundamentals/verified-input.json')), verifiedEvents: read(path.join(base, 'news/verified-events.json')) });
  if (!result.valid) { console.error(JSON.stringify(result, null, 2)); process.exit(1); }
  console.log('Historical Recovery acquisition validation: PASS');
}

module.exports = { validateAcquisition };
