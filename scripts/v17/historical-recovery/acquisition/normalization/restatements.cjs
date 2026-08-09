'use strict';
const { isAvailableAsOf } = require('./point-in-time.cjs');

function versionKey(record) {
  return [record.ticker, record.reportingPeriodEnd, record.statementScope, record.periodType].join('::');
}

function resolveActiveVersions(records, asOf, options = {}) {
  const eligible = (records || []).filter(record => isAvailableAsOf(record, asOf, options));
  const byKey = new Map();
  for (const record of eligible) {
    const key = versionKey(record);
    const group = byKey.get(key) || [];
    group.push(record);
    byKey.set(key, group);
  }
  const active = [];
  const history = [];
  for (const group of byKey.values()) {
    group.sort((a, b) => String(a.effectiveAvailableDate || a.publicationDate || a.retrievedAt).localeCompare(String(b.effectiveAvailableDate || b.publicationDate || b.retrievedAt)));
    const latest = group.at(-1);
    active.push({ ...latest, activeVersion: true });
    for (const record of group.slice(0, -1)) history.push({ ...record, activeVersion: false, supersededBy: latest.documentId });
  }
  return { active, history };
}

module.exports = { versionKey, resolveActiveVersions };
