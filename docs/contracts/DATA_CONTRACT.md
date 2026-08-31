# Data Contract

The **EGX Market Data Store** is the only authoritative engine input. Legacy JSON, UI state, search snippets, copied summaries, and external APIs are acquisition or forensic inputs only until they pass the evidence gates below.

## Immutable lineage order
1. Acquisition Run is opened for one expected EGX session.
2. Raw observations are appended with source identity, provider group, capture time, direct source URL and payload hash.
3. Acquisition is finalized to an immutable `rawDataVersion` hash.
4. Sources are reconciled; values are never averaged merely to hide disagreement.
5. A source manifest is frozen with source identities, provider groups, capture times, row hashes and conflicts.
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
- Historical bars must be strictly monotonic, must not extend beyond the decision session, and must belong to the versioned EGX exchange calendar.
- Once an acquisition or normalized snapshot is finalized, it cannot be mutated.

## Point-in-time fundamentals and features
Each fundamental record stores `reportPeriod`, `publicationDate`, `availableFrom`, `source`, and `verifiedAt`. Historical evaluation at time T may retrieve only records with `availableFrom <= T`. `availableFrom` cannot precede `publicationDate`.

Every feature bundle must carry immutable lineage (`sourceVersion`, `featureVersion`, `asOfSession`, `availableAt`, bundle hash). A feature published or available after the decision cutoff is a look-ahead violation and is blocked. Price-current/liquidity-stale combinations are `STALE` rather than silently reused.

## Authoritative Universe Contract
- A legacy ticker list is never sufficient evidence that a security is active.
- Production universe membership requires exhaustive official EGX inclusion evidence such as a verified official listed-securities snapshot or official daily bulletin.
- The boolean claim `exhaustive=true` is not sufficient. Inclusion evidence must be bound to a validated official source receipt and a verified document-scope proof.
- Every official snapshot/bulletin inclusion row must carry a valid `sourceReceiptHash` and `scopeProofHash`. Directly injected inclusion rows without those proofs are `UNPROVEN_OFFICIAL_INCLUSION_EVIDENCE` and blocked.
- The official source receipt must bind source ID, EGX domain URL, content hash, session/as-of date, direct provenance kind and receipt hash.
- The scope proof must explicitly attest `ALL_LISTED_EQUITIES`; a partial disclosure/news feed can never provide that proof.
- A declared equity total is mandatory for an exhaustive adapter result and must equal the canonical equity member count; a mismatch is a data conflict/incompleteness blocker.
- Corporate disclosures/listing news may prove identity or effective-date changes, but cannot by themselves prove universe completeness.
- Ticker↔ISIN conflicts are `DATA_CONFLICT` and block the universe.
- Universe membership is point-in-time: evidence effective after the requested `asOfDate` is excluded.

## Current-session Acquisition Policy
- Current production OHLCV requires an authoritative primary source (`OFFICIAL_EXCHANGE` or explicitly configured `LICENSED_EOD`).
- A public market page can cross-check but cannot silently become the current-session primary authority.
- Cross-check independence is measured by **provider group**, not source ID. Two endpoints/mirrors from the same provider do not count as independent evidence.
- Yahoo is history/backfill-only for EGX ONE unless independently re-qualified under a new evidence gate.
- A daily EOD observation captured before the official session close is blocked as `PRE_CLOSE_DAILY_BAR`.
- Search results/snippets and manual transcriptions cannot become authoritative current-session raw evidence.
- Runtime readiness requires a valid primary source receipt plus at least one valid independent-provider cross-check receipt for the same session.
- Identical payload hashes across allegedly independent providers are treated as suspicious and do not satisfy independence.

## Phase transition rule
A passing test suite is not a passing data gate. Phase 4 Baseline execution requires a machine-issued authorization token bound to the immutable Full-Universe Phase 3 `reportHash`. The token is issued only when the Full-Universe report is `PASS`, Phase 3 verdict is `PASS`, and `baselineAuthorized=true`. Report-hash mismatch or token tampering fails closed.
