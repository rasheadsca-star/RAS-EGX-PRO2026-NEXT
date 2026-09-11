import crypto from 'node:crypto';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function createV17ResearchDecisionLedger({ snapshotHash, signalSessionDate, nextTradingSessionDate, createdAt } = {}) {
  if (!/^[a-f0-9]{64}$/i.test(String(snapshotHash || ''))) throw new Error('V17_LEDGER_SNAPSHOT_HASH_INVALID');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(signalSessionDate || ''))) throw new Error('V17_LEDGER_SIGNAL_DATE_INVALID');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(nextTradingSessionDate || ''))) throw new Error('V17_LEDGER_NEXT_DATE_INVALID');
  if (!Number.isFinite(Date.parse(String(createdAt || '')))) throw new Error('V17_LEDGER_CREATED_AT_INVALID');

  const anchor = {
    schemaVersion: 'egx.v17-research-decision-ledger.1',
    researchOnly: true,
    immutableSnapshotHash: snapshotHash,
    signalSessionDate,
    nextTradingSessionDate,
    createdAt: new Date(Date.parse(createdAt)).toISOString(),
    productionAuthority: false,
    scoringImpact: 'NONE',
  };

  return Object.freeze({
    ...anchor,
    anchorHash: hash(anchor),
    records: Object.freeze([]),
    headHash: null,
  });
}

export function appendV17ResearchDecisionRecord({ ledger, observedAt, decisions, source = 'V17_RESEARCH_OBSERVATION' } = {}) {
  if (!ledger || ledger.schemaVersion !== 'egx.v17-research-decision-ledger.1') throw new Error('V17_LEDGER_INVALID');
  if (!Number.isFinite(Date.parse(String(observedAt || '')))) throw new Error('V17_LEDGER_OBSERVED_AT_INVALID');
  if (!Array.isArray(decisions)) throw new Error('V17_LEDGER_DECISIONS_REQUIRED');

  const previous = ledger.records.at(-1) || null;
  if (previous && Date.parse(observedAt) <= Date.parse(previous.observedAt)) throw new Error('V17_LEDGER_NON_MONOTONIC_APPEND');

  const payload = {
    index: ledger.records.length,
    observedAt: new Date(Date.parse(observedAt)).toISOString(),
    source,
    previousHash: previous?.recordHash ?? ledger.anchorHash,
    snapshotHash: ledger.immutableSnapshotHash,
    decisions: stable(decisions.map((row) => ({
      ticker: row.ticker,
      rank: row.rank ?? null,
      category: row.category ?? null,
      label: row.label,
      lifecycleStatus: row.lifecycleStatus ?? null,
      reason: row.reason ?? null,
      sessionDate: row.sessionDate ?? null,
      simulatedEntryPrice: row.simulatedEntryPrice ?? null,
      frozenStop: row.frozenStop ?? null,
      frozenTarget1: row.frozenTarget1 ?? null,
      productionAuthority: false,
    }))),
    productionAuthority: false,
  };
  const record = Object.freeze({ ...payload, recordHash: hash(payload) });

  return Object.freeze({
    ...ledger,
    records: Object.freeze([...ledger.records, record]),
    headHash: record.recordHash,
    productionAuthority: false,
  });
}

export function verifyV17ResearchDecisionLedger(ledger) {
  if (!ledger || ledger.schemaVersion !== 'egx.v17-research-decision-ledger.1') return false;
  let previousHash = ledger.anchorHash;
  let previousTime = null;
  for (const record of ledger.records || []) {
    if (record.previousHash !== previousHash) return false;
    if (previousTime && Date.parse(record.observedAt) <= previousTime) return false;
    const { recordHash, ...payload } = record;
    if (hash(payload) !== recordHash) return false;
    previousHash = recordHash;
    previousTime = Date.parse(record.observedAt);
  }
  return (ledger.records.length === 0 && ledger.headHash === null) || previousHash === ledger.headHash;
}
