'use strict';

const PERIOD_TYPES = new Set(['ANNUAL', 'QUARTERLY', 'YTD', 'TTM_DERIVED']);
const STATEMENT_SCOPES = new Set(['CONSOLIDATED', 'STANDALONE']);

function validateFinancialPeriod(period) {
  const issues = [];
  if (!period?.periodEnd || !Number.isFinite(new Date(period.periodEnd).getTime())) issues.push('PERIOD_END_INVALID');
  if (!PERIOD_TYPES.has(period?.periodType)) issues.push('PERIOD_TYPE_INVALID');
  if (!STATEMENT_SCOPES.has(period?.statementScope)) issues.push('STATEMENT_SCOPE_INVALID');
  if (!period?.currency || !/^[A-Z]{3}$/.test(period.currency)) issues.push('CURRENCY_INVALID');
  if (!period?.documentId) issues.push('DOCUMENT_ID_REQUIRED');
  if (!period?.effectiveAvailableDate || !period?.retrievedAt) issues.push('POINT_IN_TIME_METADATA_REQUIRED');
  if (period?.periodType === 'YTD' && ![3, 6, 9].includes(Number(period.months))) issues.push('YTD_MONTHS_REQUIRED');
  if (period?.periodType === 'QUARTERLY' && period.months && Number(period.months) !== 3) issues.push('QUARTERLY_PERIOD_CONFLICT');
  if (period?.periodType === 'TTM_DERIVED' && !Array.isArray(period.derivationDocuments)) issues.push('TTM_DERIVATION_REQUIRED');
  return { valid: issues.length === 0, issues };
}

function scopeCurrencyConsistency(periods) {
  const active = (periods || []).filter(period => period.comparable !== false);
  const scopes = new Set(active.map(period => period.statementScope).filter(Boolean));
  const currencies = new Set(active.map(period => period.currency).filter(Boolean));
  const issues = [];
  if (scopes.size > 1) issues.push('STATEMENT_SCOPE_CONFLICT');
  if (currencies.size > 1) issues.push('CURRENCY_CONFLICT');
  return { valid: issues.length === 0, issues };
}

module.exports = { PERIOD_TYPES, STATEMENT_SCOPES, validateFinancialPeriod, scopeCurrencyConsistency };
