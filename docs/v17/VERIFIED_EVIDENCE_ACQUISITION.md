# V17 Verified Evidence Acquisition

## Scope and independence

This layer belongs only to the independent V17 Historical Recovery / Investment Intelligence module. It does not read from or write to V16.9, the daily recommendation engine, `data/v17/current.json`, the recommendation ledger, shared `data/history/**`, or `data/symbol-map.json`.

Phase A is deliberately limited to `SKPC`, `ELEC`, `SUGR`, `SPMD`, `IRON`, `AREH`, `NAHO`, `ODIN`, and `CFGH`. The source and parser gates, not a coverage target, decide how many companies enter the model.

## Evidence hierarchy and adapters

Primary evidence is EGX, FRA, or an issuer's official investor-relations document. Reputable secondary sources may locate or cross-check evidence but cannot replace an official financial statement. Search results and snippets are discovery-only. Yahoo history is not authoritative corporate-financial or corporate-action evidence.

Adapters implement `discover`, `fetchIndex`, `fetchDocument`, `parse`, `normalize`, `validate`, and `healthCheck`. The source registry records authority, supported content, access method, automation suitability, legal limitations, and health. HTTP acquisition permits HTTPS URLs only on each adapter's allowlisted domain, uses conservative timeouts and conditional headers, and never bypasses access controls.

## Identity resolution

The V17 identity registry connects the canonical ticker, Arabic and English legal/display names, security identifiers when verified, historical names, official domain, IR page, exchange, currency, sector, and security class.

An accepted report needs multiple corroborating signals. A conflict in ticker, exchange, currency, security class, or security identifier rejects the candidate even if the name looks similar. `LOW` and `REJECTED` identity evidence cannot enter the financial model.

## Document evidence and storage

The compact document index stores document ID, ticker, source, canonical URL, type, reporting period, publication/effective/retrieval dates, language, currency, unit, statement scope, period type, SHA-256 hash, parser version, confidence, and revision relationship. Raw PDFs remain in the ignored local cache; Git stores only compact metadata and normalized evidence.

Text extraction runs before any OCR. If currency, statement scope, text length, or tables are ambiguous, the document is marked `PARSER_REVIEW_REQUIRED`. OCR-derived values are never published automatically.

## Financial normalization

Each normalized datapoint retains:

- metric, reporting period, period type, and statement scope;
- currency and unit scale;
- reported and normalized values;
- normalization or safe-derivation method;
- document ID, page references, and effective-availability date.

Parentheses are negative; a dash is missing, not zero. Arabic digits and Arabic/English separators are supported. Unit scales are explicit. Mixed currencies or statement scopes fail closed. A 9-month YTD period remains YTD; it is not treated as a quarter. Balance-sheet snapshots are never summed. TTM is unavailable without an explicit, consistent derivation trail.

Consolidated statements are preferred for group analysis. Standalone statements remain clearly labelled and are never mixed with consolidated periods. A trend requires at least two comparable annual periods. CFGH's 2024 comparison in the 2025 statement covers eleven months, so it is retained as reference but excluded from annual growth.

## Sector models and valuation

The fundamental model selects sector-aware schemas. Bank and non-bank financial companies do not inherit industrial leverage rules. Missing sector metrics remain unavailable.

Valuation uses the latest validated V17 price, explicitly evidenced shares outstanding, and a matching financial currency. No FX conversion is performed in the pilot. A share count under corporate-action review blocks valuation. P/E and P/B use same-currency market capitalization; EV/EBITDA and dividend yield remain unavailable unless their inputs are explicitly verified.

## Point-in-time and restatements

Every document has reporting-period, publication/effective-availability, and retrieval dates. A document published after a decision cannot affect it. A report discovered later cannot rewrite immutable historical snapshots unless an explicit reconstruction mode is selected. Restatements create a new immutable version; the old version remains auditable and becomes inactive only from the replacement's effective date.

When an official publication timestamp is unknown, the pilot conservatively uses retrieval time as the earliest effective date. Such a report can inform the current evidence layer but cannot be represented as a newly timed company event.

## Disclosures, news, and deduplication

Official disclosures and company releases have a separate ingestion path. Events retain factual fields, source tier, URL/reference, timestamp, hash, identity/source confidence, materiality state, and parser version. Event fingerprints use ticker, type, official reference, date window, and numeric facts. One official event with many articles remains one canonical event with primary and secondary evidence.

Facts and model interpretation are separate. Article tone and subsequent price reaction do not establish event direction. Company-specific macro impact requires a supported exposure mapping. Untimed or ambiguous disclosures stay in the review queue and do not change `NEWS_IMPACT_SCORE`.

## Confidence and fail-safe rules

Fundamental confidence reflects identity, source authority, comparable history, completeness, freshness, currency/scope consistency, restatements, and conflicts. Positive integrated labels still require adequate fundamental confidence, valuation, source coverage, acceptable risk, and technical confirmation. Sparse evidence yields partial or unavailable output, never guessed neutral scores.

Every source keeps `lastKnownValid`, `currentAttempt`, status, last success, and failure count. A timeout, HTTP error, parser failure, invalid document, or source outage cannot replace valid evidence with an empty dataset. Source/system alerts remain distinct from stock events.

## Review queues

The acquisition output exposes separate queues for company identity, financial documents, currency/units, source differences, corporate actions, disclosures, and news classification. Evidence is not silently discarded.

## Workflow schedule

- Pre-market validates source/evidence state and the last public result. It does not manufacture data when a source is unavailable.
- Post-market rebuilds the curated acquisition artifacts, validates them, then recalculates the integrated snapshot and publishes only after all gates pass.
- Weekly review rebuilds the pilot audit, retries missing official documents under conservative access rules, reviews stale/conflicting evidence, and runs the full deterministic suite.

Expansion to the strongest 30 remains blocked until the pilot has no unresolved parser-critical failures and identity, unit/currency, scope, point-in-time, restatement, deduplication, and failure-safe tests all pass.
