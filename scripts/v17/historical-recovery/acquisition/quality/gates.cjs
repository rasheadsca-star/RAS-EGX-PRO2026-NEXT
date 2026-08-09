'use strict';

function fundamentalConfidence(company) {
  if (!company || !company.identityConfidence || ['LOW', 'REJECTED'].includes(company.identityConfidence)) return 'UNAVAILABLE';
  const comparableAnnual = (company.periods || []).filter(period => period.periodType === 'ANNUAL' && period.comparable !== false);
  if (!company.provenance?.length || !comparableAnnual.length) return company.interimPeriods?.length ? 'LOW' : 'UNAVAILABLE';
  const critical = ['revenue', 'netProfit', 'totalAssets', 'totalEquity'];
  const latest = comparableAnnual.at(-1) || {};
  const completeness = critical.filter(field => Number.isFinite(Number(latest[field]))).length / critical.length;
  if (company.unresolvedIssues?.length || completeness < 0.75 || comparableAnnual.length < 2) return 'LOW';
  if (company.sourceConfidence === 'HIGH' && comparableAnnual.length >= 3 && completeness === 1) return 'HIGH';
  return 'MEDIUM';
}

function positiveDecisionEligible(company) {
  const confidence = fundamentalConfidence(company);
  const issues = [];
  if (!['HIGH', 'MEDIUM'].includes(confidence)) issues.push('FUNDAMENTAL_CONFIDENCE_INSUFFICIENT');
  if (company?.identityConfidence !== 'HIGH') issues.push('IDENTITY_NOT_HIGH_CONFIDENCE');
  if (company?.unresolvedIssues?.length) issues.push('UNRESOLVED_EVIDENCE_REVIEW');
  return { eligible: issues.length === 0, confidence, issues };
}

module.exports = { fundamentalConfidence, positiveDecisionEligible };
