'use strict';

const ARABIC_DIGITS = Object.freeze({ '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' });
const UNIT_SCALE = Object.freeze({ UNIT: 1, THOUSAND: 1_000, MILLION: 1_000_000, BILLION: 1_000_000_000 });

function normalizeDigits(value) {
  return String(value ?? '').replace(/[٠-٩۰-۹]/g, char => ARABIC_DIGITS[char]);
}

function isMissingToken(value) {
  return /^(?:|[-–—]|n\/?a|nil|none|غير متاح)$/i.test(String(value || '').trim());
}

function parseFinancialNumber(value, options = {}) {
  const original = value;
  let text = normalizeDigits(value).replace(/\u00a0/g, ' ').trim();
  if (isMissingToken(text)) return { value: null, missing: true, original, issue: null };
  const negative = /^\(.*\)$/.test(text) || /^-/.test(text);
  text = text.replace(/^\(|\)$/g, '').replace(/^[-+]/, '').trim();
  const isPercent = /%|٪/.test(text);
  text = text.replace(/[%٪]/g, '').replace(/[٬,](?=\d{3}(?:\D|$))/g, '').replace(/٬/g, '').replace(/٫/g, '.');
  text = text.replace(/\s+/g, '');
  if (/^\d+,\d+$/.test(text)) text = text.replace(',', '.');
  else text = text.replace(/,/g, '');
  if (!/^\d*(?:\.\d+)?$/.test(text) || !text) return { value: null, missing: false, original, issue: 'INVALID_NUMERIC_TEXT' };
  const unit = String(options.unit || 'UNIT').toUpperCase();
  if (!UNIT_SCALE[unit]) return { value: null, missing: false, original, issue: 'INVALID_UNIT' };
  const parsed = Number(text) * UNIT_SCALE[unit] * (negative ? -1 : 1);
  return { value: Number.isFinite(parsed) ? parsed : null, missing: false, original, isPercent, unit, issue: Number.isFinite(parsed) ? null : 'NON_FINITE_NUMBER' };
}

module.exports = { ARABIC_DIGITS, UNIT_SCALE, normalizeDigits, isMissingToken, parseFinancialNumber };
