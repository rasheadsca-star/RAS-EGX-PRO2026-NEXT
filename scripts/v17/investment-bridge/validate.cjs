#!/usr/bin/env node
'use strict';
const path = require('path');
const { readJson } = require('./io.cjs');

function validateBridgeOutput(dataset) {
  const issues = [];
  if (!dataset?.researchOnly) issues.push('NOT_RESEARCH_ONLY');
  if (!dataset?.independenceStatementAr?.includes('مستقل')) issues.push('MISSING_INDEPENDENCE_DISCLAIMER');
  if (!dataset?.historicalHighDisclaimerAr?.includes('ليست سعر بيع مضمون')) issues.push('MISSING_HIGH_DISCLAIMER');
  if (!Array.isArray(dataset?.decisionHistory)) issues.push('DECISION_HISTORY_MISSING');
  for (const row of dataset?.activePositions || []) {
    if (!row.ticker || !row.currentInvestmentClassification) issues.push('POSITION_IDENTITY_OR_ARABIC_CLASSIFICATION_MISSING');
    if (row.currentInvestmentClassification.includes('متوسط/طويل') && row.FundamentalQuality == null) issues.push(`${row.ticker}:LONG_TERM_WITHOUT_FUNDAMENTALS`);
    if (!row.dailyReview?.whyAr?.length) issues.push(`${row.ticker}:DAILY_REVIEW_REASONS_MISSING`);
  }
  if (dataset?.performance?.separateFromDailyStrategy !== true) issues.push('PERFORMANCE_NOT_SEPARATE');
  function inspect(value, trail = []) {
    if (Array.isArray(value)) return value.forEach((item, index) => inspect(item, [...trail, index]));
    if (value && typeof value === 'object') return Object.entries(value).forEach(([key, item]) => inspect(item, [...trail, key]));
    const key = String(trail.at(-1) || '');
    if (typeof value === 'string' && key !== 'ticker' && !key.toLowerCase().includes('file') && /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(value)) issues.push(`PUBLIC_ENUM_LEAK:${trail.join('.')}:${value}`);
  }
  inspect(dataset);
  return { valid: issues.length === 0, issues };
}

if (require.main === module) {
  const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
  const dataset = readJson(path.join(root, 'data/v17/investment-bridge/current.json'));
  const result = validateBridgeOutput(dataset);
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exit(1);
}

module.exports = { validateBridgeOutput };
