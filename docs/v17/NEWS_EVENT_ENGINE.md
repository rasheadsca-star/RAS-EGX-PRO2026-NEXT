# V17 News and Event Engine

## Source audit

The hierarchy is deliberately conservative:

1. EGX official disclosures, FRA decisions, company investor-relations disclosures and official government/regulatory decisions.
2. Official company press releases and reporting that links to audited or official results.
3. Established attributable media.
4. Rumors, anonymous claims, social media and unverifiable content.

Tier 4 can be displayed as `خبر غير مؤكد`, but its decision impact is always zero. A missing source URL or official reference also makes an event ineligible for decision changes.

The current audit found the authoritative channels, but did not verify a stable structured market-wide automated feed. The current source state is therefore `FAILED` and coverage is zero; “no event in the input” is not presented as “no relevant news exists.” The machine-readable audit is `data/v17/historical-recovery/news/source-audit.json`.

## Event model

Every event records company or market scope, event type, date, source tier, source reference, sentiment, materiality, source confidence, temporary/structural duration, numeric facts and an Arabic summary.

Impact is not sentiment alone:

`impact = sentiment × materiality × source confidence × time relevance`

Temporary events use a 30-day half-life. Structural events use a 365-day half-life. Scores are clamped to -100 through +100.

## Deduplication

The event fingerprint combines company, event type, calendar date, numeric facts and official reference. Multiple articles describing the same underlying event count once. A higher-confidence copy can replace a lower-confidence copy without multiplying impact.

## Decision safety

- Positive news cannot rescue severe financial weakness, high value-trap risk, unresolved corporate-action uncertainty or inadequate financial data.
- A verified highly material negative event can immediately force `إعادة مراجعة مطلوبة`.
- Causality is not inferred beyond the supplied verified evidence.
