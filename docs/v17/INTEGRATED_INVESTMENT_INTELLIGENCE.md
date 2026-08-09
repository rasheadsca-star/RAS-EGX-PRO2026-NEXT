# V17 Integrated Investment Intelligence

## Isolation

This system is independent from the daily recommendation basket. It reads the compact V17 historical-recovery dataset and V17-specific verified inputs only. It does not write shared history, the shared symbol map, `data/v17/current.json`, the V17 daily ledger, stable paths or V16.9 workflows.

## Integrated model

The following evidence remains visible and separate: historical discount, post-peak recovery position, recovery score, strength score, fundamental quality and components, valuation, financial risk, value-trap risk, news impact/confidence and overall data confidence.

When every required component is supportable, the non-financial integrated score uses:

| Evidence | Weight |
|---|---:|
| Fundamental quality | 30% |
| Recovery quality | 20% |
| Technical strength | 15% |
| Valuation | 15% |
| News/event evidence | 10% |
| Overall data confidence | 10% |

If fundamentals, valuation or news-source coverage are unavailable, the integrated score is `null`. The normal Arabic UI shows `بيانات مالية غير كافية`, not a fabricated neutral score.

## Positive gates

A positive investment-research classification requires medium/high fundamental confidence, acceptable financial risk, no high value-trap flag, valid historical data, resolved corporate-action status, valuation evidence, news-source coverage and technical recovery evidence. Severe verified negative news forces review.

## Immutable decisions and hysteresis

Each run creates a new immutable file under `data/v17/historical-recovery/intelligence/history/`. The index links snapshots in order, while `current.json` is only the latest pointer payload. Existing snapshot filenames may not be overwritten.

Adjacent classifications are held when the integrated-score move is below five points and no material evidence, risk, data-completeness or recovery-stage change occurred. This prevents small numerical changes from causing repeated flip-flops.

## Alerts

Alerts are generated only for material decision, risk, data-quality, trough-break or verified-news changes. Fingerprints prevent repeated alerts for the same state. A repeat is allowed only when severity or independent evidence changes.

External notification transport is not configured. The implementation therefore supplies a persistent in-app alert center and does not invent email, SMS or messaging delivery.

## EGX-aware monitoring

Calendar decisions use `Africa/Cairo` through `Intl.DateTimeFormat`, so Egypt daylight-saving changes do not depend on a fixed UTC offset. Trading weekdays are Sunday through Thursday.

- Pre-market: 07:30–09:30 Cairo.
- Intraday material-event monitor: 09:30–14:30 Cairo.
- Post-market: 14:30–18:00 Cairo.
- Weekly deep review: Friday.

GitHub cron has no exchange timezone. The V17 workflows trigger at both plausible UTC hours and use the Cairo-aware gate to execute only inside the intended local window. Friday and Saturday do not create trading-session freshness by themselves. Exchange holidays require an explicit calendar update and do not automatically produce a stale flag.

## Fail-closed publication

The builder validates the complete browser dataset before replacing the public file. A failed build remains uncommitted in GitHub Actions, so the last valid Pages dataset is preserved. Raw long-history files remain cache-only and ignored.
