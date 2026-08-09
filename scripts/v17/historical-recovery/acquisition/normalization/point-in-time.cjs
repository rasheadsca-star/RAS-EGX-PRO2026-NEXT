'use strict';

function dateValue(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.getTime() : null;
}

function effectiveAvailableDate(record) {
  return record?.effectiveAvailableDate || record?.publicationDate || record?.retrievedAt || null;
}

function isAvailableAsOf(record, decisionDate, options = {}) {
  const decision = dateValue(decisionDate);
  const effective = dateValue(effectiveAvailableDate(record));
  if (decision === null || effective === null || effective > decision) return false;
  const retrieved = dateValue(record?.retrievedAt);
  if (!options.reconstructionMode && retrieved !== null && retrieved > decision) return false;
  return true;
}

function selectEvidenceAsOf(records, decisionDate, options = {}) {
  return (records || []).filter(record => isAvailableAsOf(record, decisionDate, options));
}

function assertNoLookAhead(records, decisionDate, options = {}) {
  const rejected = (records || []).filter(record => !isAvailableAsOf(record, decisionDate, options));
  return { valid: rejected.length === 0, rejected: rejected.map(record => record.documentId || record.eventId || null) };
}

module.exports = { effectiveAvailableDate, isAvailableAsOf, selectEvidenceAsOf, assertNoLookAhead };
