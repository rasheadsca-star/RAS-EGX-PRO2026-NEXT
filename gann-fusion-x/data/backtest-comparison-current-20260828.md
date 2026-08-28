# EGX GANN FUSION X — Walk-Forward Comparison

Generated: 2026-08-28T02:08:36.777Z

Holding: 3 sessions · Round-trip cost: 0.6% · Same-bar target/stop: STOP (conservative)

## Common-date comparison
| Rank | Engine | Signals | Fill % | Positive % | Target % | Stop % | Avg net % | PF | Avg basket % | Compound % | Max DD % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | GANN_FUSION_X | 36 | 63.9 | 47.8 | 8.7 | 0 | 0.88 | 1.69 | 0.423 | 5.638 | -5.117 |
| 2 | V16_9_LIVE | 50 | 98 | 53.1 | 51 | 46.9 | 0.948 | 1.4 | 0.955 | 14.423 | -5.324 |
| 3 | SEPA_X_PROXY | 43 | 95.3 | 41.5 | 2.4 | 2.4 | 0.673 | 1.25 | 0.76 | 9.649 | -12.744 |

## Extended walk-forward (Gann vs SEPA proxy)
| Rank | Engine | Signals | Fill % | Positive % | Avg net % | PF | Compound % | Max DD % |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | SEPA_X_PROXY | 176 | 95.5 | 43.5 | 0.68 | 1.33 | 44.037 | -14.967 |
| 2 | GANN_FUSION_X | 156 | 62.2 | 40.2 | -0.34 | 0.79 | -12.739 | -21.691 |

## Important
- V16.9 is based on logged live recommendations.
- SEPA-X is a backfilled proxy because the Stable V8 app does not expose an immutable historical recommendation ledger per session.
- Neutral fundamentals are used in backfilled engines to prevent look-ahead leakage.
- Historical results do not guarantee future results.

## Current-production GANN adapter
- GANN candidates are ACTIONABLE only and ranked by Execution Quality `rankScore`.
- Grade B cannot enter below Trigger.
- Grade C can enter only after revisiting the announced Pullback zone.
- Historical fundamentals/non-reconstructable metadata stay neutral to avoid look-ahead.
