#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

function validateIntegratedOutput(output) {
  const issues = [];
  if (!output?.researchOnly) issues.push('NOT_RESEARCH_ONLY');
  if (!Array.isArray(output?.results)) issues.push('RESULTS_MISSING');
  if (output?.results?.length !== output?.summary?.canonicalEquityUniverse) issues.push('UNIVERSE_MISMATCH');
  for (const row of output?.results || []) {
    if (!row.ticker || !row.classificationAr) issues.push('IDENTITY_OR_ARABIC_LABEL_MISSING');
    if (row.fundamental?.fundamentalDataConfidence === 'UNAVAILABLE' && row.investmentResearchScore !== null) issues.push(`${row.ticker}:SCORE_WITHOUT_FUNDAMENTALS`);
    if (row.fundamental?.valuation?.status === 'VALUATION_DATA_INSUFFICIENT' && row.investmentResearchScore !== null) issues.push(`${row.ticker}:SCORE_WITHOUT_VALUATION`);
    if (row.news?.coverageStatus === 'SOURCE_COVERAGE_UNAVAILABLE' && row.investmentResearchScore !== null) issues.push(`${row.ticker}:SCORE_WITHOUT_NEWS_COVERAGE`);
    if (['STRONG_CONFIRMED_CANDIDATE', 'STAGED_INVESTMENT_CANDIDATE'].includes(row.classificationCode)) {
      if (!['HIGH', 'MEDIUM'].includes(row.fundamental?.fundamentalDataConfidence)) issues.push(`${row.ticker}:POSITIVE_WITH_LOW_FUNDAMENTAL_CONFIDENCE`);
      if (['HIGH', 'VERY_HIGH'].includes(row.risk?.classification)) issues.push(`${row.ticker}:POSITIVE_WITH_SEVERE_RISK`);
      if (row.valueTrapRisk?.classification === 'HIGH') issues.push(`${row.ticker}:POSITIVE_VALUE_TRAP`);
    }
  }
  return { valid: issues.length === 0, issues };
}

function validateDecisionHistory(index, snapshotsById) {
  const issues = [];
  const ids = (index?.snapshots || []).map(x => x.snapshotId);
  if (new Set(ids).size !== ids.length) issues.push('DUPLICATE_SNAPSHOT_ID');
  let previous = null;
  for (const item of index?.snapshots || []) {
    const snapshot = snapshotsById[item.snapshotId];
    if (!snapshot) { issues.push(`${item.snapshotId}:MISSING`); continue; }
    if (snapshot.immutable !== true) issues.push(`${item.snapshotId}:NOT_IMMUTABLE`);
    if (snapshot.previousSnapshotId !== previous) issues.push(`${item.snapshotId}:CHAIN_BROKEN`);
    previous = item.snapshotId;
  }
  return { valid: issues.length === 0, issues };
}

if (require.main === module) {
  const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
  const base = path.join(root, 'data/v17/historical-recovery');
  const output = JSON.parse(fs.readFileSync(path.join(base, 'integrated-market.json'), 'utf8'));
  const result = validateIntegratedOutput(output);
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exit(1);
}

module.exports = { validateIntegratedOutput, validateDecisionHistory };
