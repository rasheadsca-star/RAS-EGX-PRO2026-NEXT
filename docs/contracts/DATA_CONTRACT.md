# Data Contract

The **EGX Market Data Store** is the only authoritative engine input. Legacy JSON, UI state and external APIs are acquisition or forensic inputs only.

## Immutable lineage order
1. Acquisition Run is opened for one expected EGX session.
2. Raw observations are appended with source identity and payload hashes.
3. Acquisition is finalized to an immutable `rawDataVersion` hash.
4. Sources are reconciled; values are never averaged merely to hide disagreement.
5. A source manifest is frozen with source identities, capture times, row hashes and conflicts.
6. Validated normalized OHLCV is written to a Data Snapshot.
7. The Data Snapshot is finalized to an immutable `normalizedDataVersion` hash.
8. Only then may a Session Manifest be created; it must resolve to the frozen raw hash, normalized hash and source-manifest hash.

## Fail-closed rules
- Missing values remain `UNKNOWN`, never fabricated zero.
- Mixed tickers or mixed sessions in a reconciliation unit are blocked.
- Material cross-source price conflicts are `DATA_CONFLICT`; the engine must not average them away.
- Invalid OHLCV is blocked before normalized truth.
- Suspicious unexplained price discontinuities are `CORPORATE_ACTION_REVIEW` until a verified action explains them.
- A fresh price cannot be combined with stale dependent features.
- Once an acquisition or normalized snapshot is finalized, it cannot be mutated.

## Point-in-time fundamentals
Each fundamental record stores `reportPeriod`, `publicationDate`, `availableFrom`, `source`, and `verifiedAt`. Historical evaluation at time T may retrieve only records with `availableFrom <= T`. `availableFrom` cannot precede `publicationDate`.
