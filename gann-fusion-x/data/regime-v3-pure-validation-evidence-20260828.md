# GANN PURE REGIME GATE V3 — Strict Validation Evidence

Generated from GitHub Actions run `33160268209` on 2026-08-28.

Acceptance: **FAIL**

## Design invariant
- Same production GANN candidate list is computed once per date and reused for baseline and gated versions.
- Candidate counts are exactly equal: **156 vs 156** over 60 sessions.
- Gate cannot add/reorder stocks or change entry, stop, target, or native A/B/C timing levels.
- Gate actions only: `ALLOW`, `REDUCE_SIZE`, `WAIT`, `BLOCK`.

## Regimes and actions
- RISK_ON: 39 sessions
- RISK_ON_DETERIORATING: 12 sessions
- RANGE: 9 sessions
- ALLOW: 73 candidate actions
- REDUCE_SIZE: 44 candidate actions
- WAIT: 42 candidate actions

## 60-session result
| Version | Candidates | Active | Exposure % | Positive % | Stop % | PF | Compound % | Max DD % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| GANN current | 156 | 156 | 100.0 | 40.2 | 6.2 | 0.79 | -12.739 | -21.691 |
| Pure Gate V3 | 156 | 117 | 60.9 | 41.8 | 7.6 | 1.02 | +0.500 | -9.367 |

## First 30 sessions
| Version | Candidates | Active | Exposure % | Positive % | Stop % | PF | Compound % | Max DD % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| GANN current | 75 | 75 | 100.0 | 34.1 | 13.6 | 0.50 | -16.263 | -21.691 |
| Pure Gate V3 | 75 | 43 | 32.0 | 31.0 | 20.7 | 0.51 | -6.314 | -9.367 |

## Last 30 sessions
| Version | Candidates | Active | Exposure % | Positive % | Stop % | PF | Compound % | Max DD % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| GANN current | 81 | 81 | 100.0 | 45.3 | 0.0 | 1.27 | +4.208 | -5.346 |
| Pure Gate V3 | 81 | 74 | 87.7 | 48.0 | 0.0 | 1.45 | +7.274 | -4.095 |

## Acceptance gate
- PF >= 1.25: false
- Compound positive: true
- Max drawdown >= -15%: true
- First 30 stable: false
- Last 30 stable: true
- Beats current GANN compound: true
- Beats current GANN drawdown: true
- Candidate counts equal: true
- Passed: false

## Interpretation
V3 materially improves capital preservation and turns the 60-session compounded result from negative to slightly positive, while cutting drawdown by more than half. However, the full-period PF remains only 1.02 and the first 30 sessions remain structurally weak. Therefore V3 is not eligible for production merge. No production engine or UI was changed.
