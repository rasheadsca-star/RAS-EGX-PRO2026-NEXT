'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAdapter } = require('../../scripts/v17/historical-recovery/acquisition/contracts.cjs');
const { resolveIdentity } = require('../../scripts/v17/historical-recovery/acquisition/entity-resolution/identity.cjs');

const entry = {
  ticker: 'CFGH', legalNameEn: 'Concrete Fashion Group for Commercial and Industrial Investments S.A.E.', legalNameAr: 'كونكريت فاشون جروب',
  historicalNames: ['Arafa Holding'], officialDomain: 'https://concretefashiongroup.com/', exchange: 'EGX', currency: 'USD', securityClass: 'ORDINARY_EQUITY', egxSecurityId: 'EGS672I2C014',
};
const exact = { ticker: 'CFGH.CA', legalName: entry.legalNameEn, sourceUrl: 'https://concretefashiongroup.com/investor-relations/', exchange: 'EGX', currency: 'USD', securityClass: 'ORDINARY_EQUITY', securityId: entry.egxSecurityId };

test('exact ticker, issuer, domain and security identity is HIGH confidence', () => {
  const result = resolveIdentity(exact, entry);
  assert.equal(result.confidence, 'HIGH');
  assert.equal(result.accepted, true);
});
test('historical company name is accepted only with supporting signals', () => {
  const result = resolveIdentity({ ...exact, legalName: 'Arafa Holding' }, entry);
  assert.equal(result.confidence, 'HIGH');
});
test('similar name without corroborating signals remains LOW', () => {
  const result = resolveIdentity({ ticker: 'CFGH', legalName: 'Concrete Building Group' }, entry);
  assert.equal(result.confidence, 'LOW');
  assert.equal(result.accepted, false);
});
for (const [label, mutation, conflict] of [
  ['wrong share class', { securityClass: 'RIGHTS_ISSUE' }, 'SECURITY_CLASS_CONFLICT'],
  ['wrong currency security', { currency: 'EGP' }, 'CURRENCY_CONFLICT'],
  ['wrong exchange', { exchange: 'LSE' }, 'EXCHANGE_CONFLICT'],
  ['wrong security id', { securityId: 'WRONG' }, 'SECURITY_ID_CONFLICT'],
]) test(`${label} is rejected even when the name matches`, () => {
  const result = resolveIdentity({ ...exact, ...mutation }, entry);
  assert.equal(result.confidence, 'REJECTED');
  assert.ok(result.conflicts.includes(conflict));
});
test('unrelated domain cannot supply an official-domain signal', () => {
  const result = resolveIdentity({ ...exact, sourceUrl: 'https://unrelated.example/report.pdf', securityId: null }, entry);
  assert.ok(result.conflicts.includes('OFFICIAL_DOMAIN_CONFLICT'));
});
test('missing registry entry is rejected', () => assert.equal(resolveIdentity(exact, null).confidence, 'REJECTED'));
test('source adapter contract requires every standard method', () => {
  const partial = { sourceId: 'TEST', discover() {} };
  const result = validateAdapter(partial);
  assert.equal(result.valid, false);
  assert.ok(result.issues.includes('METHOD_REQUIRED:fetchIndex'));
});
