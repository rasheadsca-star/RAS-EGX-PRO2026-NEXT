#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

function validateFundamentalOutput(output) {
  const issues = [];
  if (!output?.researchOnly) issues.push('NOT_RESEARCH_ONLY');
  if (!Array.isArray(output?.results)) issues.push('RESULTS_MISSING');
  for (const row of output?.results || []) {
    if (!row.ticker) issues.push('TICKER_MISSING');
    if (!['HIGH', 'MEDIUM', 'LOW', 'UNAVAILABLE'].includes(row.fundamentalDataConfidence)) issues.push(`${row.ticker}:BAD_CONFIDENCE`);
    if (row.fundamentalDataConfidence === 'UNAVAILABLE' && row.fundamentalQualityScore !== null) issues.push(`${row.ticker}:FABRICATED_UNAVAILABLE_SCORE`);
    if (row.valuation?.status === 'VALUATION_DATA_INSUFFICIENT' && row.valuation.score !== null) issues.push(`${row.ticker}:FABRICATED_VALUATION_SCORE`);
    if (Number.isFinite(row.fundamentalQualityScore) && (row.fundamentalQualityScore < 0 || row.fundamentalQualityScore > 100)) issues.push(`${row.ticker}:QUALITY_RANGE`);
    if (row.currency && !row.provenance?.length) issues.push(`${row.ticker}:PROVENANCE_MISSING`);
  }
  return { valid: issues.length === 0, issues };
}

if (require.main === module) {
  const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
  const file = path.join(root, 'data/v17/historical-recovery/fundamentals/current.json');
  const result = validateFundamentalOutput(JSON.parse(fs.readFileSync(file, 'utf8')));
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exit(1);
}

module.exports = { validateFundamentalOutput };
