'use strict';

const CRITICAL_METRICS = new Set(['revenue', 'netProfit', 'eps', 'totalAssets', 'totalEquity', 'totalDebt', 'sharesOutstanding']);

function relativeDifference(a, b) {
  if (!Number.isFinite(Number(a)) || !Number.isFinite(Number(b))) return null;
  const denominator = Math.max(Math.abs(Number(a)), Math.abs(Number(b)), 1);
  return Math.abs(Number(a) - Number(b)) / denominator;
}

function compareMetric(primary, secondary, options = {}) {
  const issues = [];
  if (!primary || !secondary || primary.metric !== secondary.metric) return { status: 'NOT_COMPARABLE', issues: ['METRIC_MISMATCH'] };
  for (const field of ['currency', 'statementScope', 'reportingPeriodEnd']) {
    if (primary[field] && secondary[field] && primary[field] !== secondary[field]) issues.push(`${field.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase()}_CONFLICT`);
  }
  const difference = relativeDifference(primary.value, secondary.value);
  const tolerance = options.tolerance ?? (primary.metric === 'eps' ? 0.02 : 0.015);
  if (difference !== null && difference > tolerance) issues.push('VALUE_DISCREPANCY');
  return { status: issues.length ? 'REVIEW_REQUIRED' : 'MATCH', differencePct: difference === null ? null : Number((difference * 100).toFixed(4)), tolerancePct: tolerance * 100, issues };
}

function crossValidate(primaryRecords, secondaryRecords, options = {}) {
  const comparisons = [];
  for (const primary of primaryRecords || []) {
    if (!CRITICAL_METRICS.has(primary.metric)) continue;
    const secondary = (secondaryRecords || []).find(row => row.metric === primary.metric && row.reportingPeriodEnd === primary.reportingPeriodEnd);
    if (secondary) comparisons.push({ metric: primary.metric, ...compareMetric(primary, secondary, options) });
  }
  return { valid: comparisons.every(item => item.status === 'MATCH'), comparisons };
}

module.exports = { CRITICAL_METRICS, relativeDifference, compareMetric, crossValidate };
