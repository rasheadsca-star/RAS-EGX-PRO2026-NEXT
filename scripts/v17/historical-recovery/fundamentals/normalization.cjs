'use strict';

const UNIT_MULTIPLIERS = Object.freeze({
  UNIT: 1,
  THOUSAND: 1_000,
  MILLION: 1_000_000,
  BILLION: 1_000_000_000,
});

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function normalizeUnit(value, unit = 'UNIT') {
  const normalizedUnit = String(unit || 'UNIT').toUpperCase();
  if (!finite(value) || !UNIT_MULTIPLIERS[normalizedUnit]) return null;
  return Number(value) * UNIT_MULTIPLIERS[normalizedUnit];
}

function normalizeCurrency(value, fromCurrency, toCurrency, exchangeRates = {}) {
  if (!finite(value)) return null;
  const from = String(fromCurrency || '').toUpperCase();
  const to = String(toCurrency || '').toUpperCase();
  if (!from || !to) return null;
  if (from === to) return Number(value);
  const direct = Number(exchangeRates[`${from}_${to}`]);
  if (finite(direct) && direct > 0) return Number(value) * direct;
  const inverse = Number(exchangeRates[`${to}_${from}`]);
  if (finite(inverse) && inverse > 0) return Number(value) / inverse;
  return null;
}

function normalizeDatapoint(point, targetCurrency = 'EGP', exchangeRates = {}) {
  if (!point || typeof point !== 'object') return { value: null, issue: 'INVALID_DATAPOINT' };
  const unitValue = normalizeUnit(point.value, point.unit);
  if (unitValue === null) return { value: null, issue: 'INVALID_VALUE_OR_UNIT' };
  const value = normalizeCurrency(unitValue, point.currency, targetCurrency, exchangeRates);
  if (value === null) return { value: null, issue: 'CURRENCY_RATE_UNAVAILABLE' };
  return {
    value,
    currency: targetCurrency,
    sourceCurrency: String(point.currency).toUpperCase(),
    sourceUnit: String(point.unit || 'UNIT').toUpperCase(),
    source: point.source || null,
    reportingPeriod: point.reportingPeriod || null,
    publicationDate: point.publicationDate || null,
    retrievedAt: point.retrievedAt || null,
    confidence: point.confidence || 'LOW',
  };
}

module.exports = { UNIT_MULTIPLIERS, finite, normalizeUnit, normalizeCurrency, normalizeDatapoint };
