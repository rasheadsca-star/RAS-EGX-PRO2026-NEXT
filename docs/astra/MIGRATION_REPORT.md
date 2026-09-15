# ASTRA G07 — Historical Migration + Reconciliation

- Status: **GREEN**
- Historical store groups processed: **19/19**
- Exact commit provenance resolved: **8/8 pending cases**
- Raw records archived: **60288**
- Canonical records produced: **26270**
- Exact duplicates classified: **357**
- Semantic duplicates classified: **0**
- Versioned successors classified: **0**
- Conflicts preserved: **0**
- Invalid records preserved: **34018**
- Unresolved records: **34012**
- Unexplained data loss: **0**
- Run #1 == Run #2: **PASS**
- G06 regression: **NONE detected**
- Evidence workflow run: **35019349149**

Raw evidence and canonical JSONL are stored in workflow artifact `astra-g07-migration-evidence-35019349149`. Exact source commits and hashes are persisted in reconciliation/checkpoint/provenance artifacts. QUANT_EDGE remained legacy-output-only; no calculation logic was fabricated. Runtime cutover was not started and G12 remains PENDING.
