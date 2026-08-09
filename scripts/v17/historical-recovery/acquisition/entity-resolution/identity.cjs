'use strict';

function normalizedText(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function domainOf(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

function nameMatches(candidate, expected, aliases = []) {
  const actual = normalizedText(candidate);
  const names = [expected, ...aliases].map(normalizedText).filter(Boolean);
  return actual && names.some(name => actual === name || actual.includes(name) || name.includes(actual));
}

function resolveIdentity(candidate, registryEntry) {
  if (!registryEntry) return { confidence: 'REJECTED', accepted: false, score: 0, signals: [], conflicts: ['REGISTRY_ENTRY_MISSING'] };
  const signals = [];
  const conflicts = [];
  const candidateTicker = String(candidate?.ticker || '').toUpperCase().replace(/\.CA$/, '');
  const expectedTicker = String(registryEntry.ticker || '').toUpperCase();
  if (candidateTicker && candidateTicker === expectedTicker) signals.push('TICKER_MATCH');
  else if (candidateTicker) conflicts.push('TICKER_CONFLICT');

  const expectedNames = registryEntry.historicalNames || [];
  if (nameMatches(candidate?.legalName, registryEntry.legalNameEn, expectedNames)
    || nameMatches(candidate?.legalName, registryEntry.legalNameAr, expectedNames)) signals.push('LEGAL_NAME_MATCH');
  else if (candidate?.legalName) conflicts.push('LEGAL_NAME_CONFLICT');

  const expectedDomain = domainOf(registryEntry.officialDomain || registryEntry.investorRelationsUrl);
  const candidateDomain = domainOf(candidate?.sourceUrl || candidate?.officialDomain);
  if (expectedDomain && candidateDomain && (candidateDomain === expectedDomain || candidateDomain.endsWith(`.${expectedDomain}`))) signals.push('OFFICIAL_DOMAIN_MATCH');
  else if (candidateDomain && expectedDomain) conflicts.push('OFFICIAL_DOMAIN_CONFLICT');

  if (candidate?.exchange && String(candidate.exchange).toUpperCase() === String(registryEntry.exchange || 'EGX').toUpperCase()) signals.push('EXCHANGE_MATCH');
  else if (candidate?.exchange) conflicts.push('EXCHANGE_CONFLICT');

  if (candidate?.currency && String(candidate.currency).toUpperCase() === String(registryEntry.currency || '').toUpperCase()) signals.push('CURRENCY_MATCH');
  else if (candidate?.currency && registryEntry.currency) conflicts.push('CURRENCY_CONFLICT');

  if (candidate?.securityClass && String(candidate.securityClass).toUpperCase() === String(registryEntry.securityClass || 'ORDINARY_EQUITY').toUpperCase()) signals.push('SECURITY_CLASS_MATCH');
  else if (candidate?.securityClass) conflicts.push('SECURITY_CLASS_CONFLICT');

  if (candidate?.securityId && registryEntry.egxSecurityId && candidate.securityId === registryEntry.egxSecurityId) signals.push('SECURITY_ID_MATCH');
  else if (candidate?.securityId && registryEntry.egxSecurityId) conflicts.push('SECURITY_ID_CONFLICT');

  const hardConflict = conflicts.some(code => ['TICKER_CONFLICT', 'EXCHANGE_CONFLICT', 'CURRENCY_CONFLICT', 'SECURITY_CLASS_CONFLICT', 'SECURITY_ID_CONFLICT'].includes(code));
  const score = signals.reduce((total, signal) => total + ({ SECURITY_ID_MATCH: 30, OFFICIAL_DOMAIN_MATCH: 25, LEGAL_NAME_MATCH: 20, TICKER_MATCH: 15, EXCHANGE_MATCH: 5, CURRENCY_MATCH: 3, SECURITY_CLASS_MATCH: 2 }[signal] || 0), 0);
  const confidence = hardConflict ? 'REJECTED' : score >= 65 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
  return { confidence, accepted: confidence === 'HIGH' || confidence === 'MEDIUM', score, signals, conflicts };
}

module.exports = { normalizedText, domainOf, nameMatches, resolveIdentity };
