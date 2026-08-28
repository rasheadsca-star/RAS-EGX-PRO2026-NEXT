# Regime Gate V2 — Backtest Evidence

Generated from GitHub Actions run 33136370481 on 2026-08-28.

Acceptance: **FAIL**

## Regime counts over 60 sessions
- V1: RISK_ON 51, RANGE 9
- V2: RISK_ON 37, RISK_ON_DETERIORATING 14, RANGE 9

## 60 sessions
| Engine | Signals | Fill % | Positive % | Target % | Stop % | Avg net % | PF | Compound % | Max DD % |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| GANN_CURRENT | 156 | 62.2 | 40.2 | 4.1 | 6.2 | -0.340 | 0.79 | -12.739 | -21.691 |
| SEPA_X_PROXY | 176 | 95.5 | 43.5 | 1.2 | 3.0 | +0.680 | 1.33 | +44.037 | -14.967 |
| REGIME_V1 | 167 | 61.1 | 41.2 | 3.9 | 4.9 | -0.254 | 0.84 | -9.979 | -17.021 |
| REGIME_V2 | 137 | 65.7 | 44.4 | 3.3 | 6.7 | -0.284 | 0.82 | -13.387 | -19.725 |

## First 30 / Last 30 — Regime V2
- First 30: PF 0.52, compound -15.938%, max DD -15.938%, positive trades 33.3%.
- Last 30: PF 1.25, compound +3.035%, max DD -6.392%, positive trades 54.2%.

## Common 15 sessions vs V16 LIVE
| Engine | Positive % | Avg net % | PF | Compound % | Max DD % |
|---|---:|---:|---:|---:|---:|
| V16_9_LIVE | 53.1 | +0.948 | 1.40 | +14.423 | -5.324 |
| GANN_CURRENT | 47.8 | +0.880 | 1.69 | +5.638 | -5.117 |
| SEPA_X_PROXY | 41.5 | +0.673 | 1.25 | +9.649 | -12.744 |
| REGIME_V1 | 55.0 | +0.454 | 1.28 | +1.705 | -8.404 |
| REGIME_V2 | 57.9 | +0.738 | 1.52 | +4.285 | -6.081 |

## Acceptance gate
- PF >= 1.25: false
- Compound positive: false
- Max drawdown >= -15%: false
- First 30 stable: false
- Last 30 stable: true
- Beats current GANN compound: false
- Beats current GANN drawdown: true
- Passed: false

No production engine or UI was modified.
