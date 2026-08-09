'use strict';
const crypto = require('crypto');

const EVENT_TYPES = new Set(['FINANCIAL_RESULTS','PROFIT_WARNING','DIVIDEND','CAPITAL_INCREASE','RIGHTS_ISSUE','BONUS_SHARES','STOCK_SPLIT','ACQUISITION','MERGER','ASSET_SALE','MAJOR_CONTRACT','CONTRACT_CANCELLATION','NEW_PROJECT','CAPACITY_EXPANSION','PRODUCTION_INTERRUPTION','DEBT_REFINANCING','CREDIT_EVENT','MANAGEMENT_CHANGE','BOARD_CHANGE','LITIGATION','REGULATORY_ACTION','TAX_EVENT','SHAREHOLDER_CHANGE','RELATED_PARTY_EVENT','TREASURY_SHARES','OTHER_MATERIAL_DISCLOSURE','UNKNOWN']);

function fingerprint(event) {
  const facts = (event.facts || []).map(fact => `${fact.metric || fact.fact}:${fact.value ?? fact.text ?? ''}`).sort().join('|');
  return crypto.createHash('sha256').update([event.ticker, event.eventType, String(event.publicationTimestamp || '').slice(0, 10), event.officialReference || '', facts].join('::')).digest('hex').slice(0, 24);
}

function validateDisclosureEvent(event) {
  const issues = [];
  if (!EVENT_TYPES.has(event?.eventType)) issues.push('EVENT_TYPE_INVALID');
  if (!event?.ticker) issues.push('TICKER_REQUIRED');
  if (!event?.publicationTimestamp || !Number.isFinite(new Date(event.publicationTimestamp).getTime())) issues.push('PUBLICATION_TIMESTAMP_REQUIRED');
  if (!event?.sourceUrl && !event?.officialReference) issues.push('SOURCE_REFERENCE_REQUIRED');
  if (!['HIGH', 'MEDIUM'].includes(event?.identityConfidence)) issues.push('IDENTITY_CONFIDENCE_INSUFFICIENT');
  return { valid: issues.length === 0, issues };
}

function canonicalizeEvents(events) {
  const map = new Map();
  for (const event of events || []) {
    const id = fingerprint(event);
    const validation = validateDisclosureEvent(event);
    const evidence = { sourceId: event.sourceId, sourceUrl: event.sourceUrl, sourceTier: event.sourceTier, documentHash: event.documentHash || null };
    const existing = map.get(id);
    if (!existing) map.set(id, { ...event, eventId: event.eventId || id, fingerprint: id, primaryEvidence: evidence, secondaryEvidence: [], validationIssues: validation.issues });
    else existing.secondaryEvidence.push(evidence);
  }
  return [...map.values()];
}

module.exports = { EVENT_TYPES, fingerprint, validateDisclosureEvent, canonicalizeEvents };
