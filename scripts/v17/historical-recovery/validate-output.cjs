#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const allowedStages = new Set(['DATA_REVIEW_REQUIRED', 'NO_RECOVERY', 'BOTTOMING', 'EARLY_RECOVERY', 'RECOVERY_CONFIRMED', 'RECOVERY_EXTENDED']);
const allowedBottom = new Set(['EXTREME_BOTTOM', 'NEAR_BOTTOM', 'BOTTOM_ZONE', 'ABOVE_BOTTOM_ZONE']);
const forbiddenKeys = /(?:portfolioWeight|positionSiz|entryOrder|executionInstruction|ledger|recommendation)/i;
const forbiddenValues = /\b(?:BUY|HOLD|SELL)\b/i;

function validateOutput(output) {
  const findings = [];
  if (output.operatingMode !== 'SHORT_WINDOW_RESEARCH') findings.push('invalid_operating_mode');
  if (output.researchOnly !== true) findings.push('research_only_flag_missing');
  if (!Array.isArray(output.results)) findings.push('results_not_array');
  if (!Array.isArray(output.topRecoveryOpportunities)) findings.push('top_recovery_opportunities_not_array');
  if (!Array.isArray(output.bottomUniverse)) findings.push('bottom_universe_not_array');
  function inspect(value, keyPath = '') {
    if (Array.isArray(value)) return value.forEach((item, index) => inspect(item, `${keyPath}[${index}]`));
    if (value && typeof value === 'object') return Object.entries(value).forEach(([key, child]) => {
      if (forbiddenKeys.test(key)) findings.push(`forbidden_key:${keyPath}.${key}`);
      inspect(child, `${keyPath}.${key}`);
    });
    if (typeof value === 'string' && forbiddenValues.test(value)) findings.push(`forbidden_value:${keyPath}`);
  }
  inspect(output);
  const requiredNumeric = ['availableWindowAdjustedHigh', 'currentAdjustedPrice', 'drawdownFromAvailableWindowAdjustedHighPct', 'availableWindowAdjustedLow', 'distanceFromAvailableWindowAdjustedLowPct', 'rsi14'];
  for (const row of output.results || []) {
    if (!allowedStages.has(row.stage)) findings.push(`invalid_stage:${row.symbol}`);
    if (row.stage !== 'DATA_REVIEW_REQUIRED') {
      if (!allowedBottom.has(row.bottomClassification)) findings.push(`invalid_bottom_classification:${row.symbol}`);
      for (const key of requiredNumeric) if (!Number.isFinite(Number(row.metrics?.[key]))) findings.push(`invalid_required_numeric:${row.symbol}:${key}`);
      for (const key of ['strengthScore', 'recoveryScore', 'dataConfidence']) if (!Number.isFinite(Number(row[key]))) findings.push(`invalid_required_numeric:${row.symbol}:${key}`);
    }
  }
  for (const row of output.topRecoveryOpportunities || []) {
    if (row.bottomClassification === 'ABOVE_BOTTOM_ZONE') findings.push(`top_row_outside_bottom_zone:${row.symbol}`);
    if (!['BOTTOMING', 'EARLY_RECOVERY', 'RECOVERY_CONFIRMED'].includes(row.recoveryStage)) findings.push(`invalid_top_stage:${row.symbol}:${row.recoveryStage}`);
  }
  if ((output.bottomUniverse || []).some((row, index, rows) => index > 0 && row.metrics.distanceFromAvailableWindowAdjustedLowPct < rows[index - 1].metrics.distanceFromAvailableWindowAdjustedLowPct)) findings.push('bottom_universe_not_sorted_by_distance');
  return { valid: findings.length === 0, findings };
}

if (require.main === module) {
  const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
  const currentFile = path.join(root, 'data/v17/historical-recovery/current.json');
  const reviewFile = path.join(root, 'data/v17/historical-recovery/review.json');
  const output = JSON.parse(fs.readFileSync(currentFile, 'utf8'));
  const validation = validateOutput(output);
  const review = { schemaVersion: '17.0.0-historical-recovery-review-1', generatedAt: new Date().toISOString(), verdict: validation.valid ? 'PASS' : 'FAIL', ...validation };
  fs.writeFileSync(reviewFile, `${JSON.stringify(review, null, 2)}\n`);
  console.log(JSON.stringify(review, null, 2));
  process.exit(validation.valid ? 0 : 1);
}

module.exports = { validateOutput };
