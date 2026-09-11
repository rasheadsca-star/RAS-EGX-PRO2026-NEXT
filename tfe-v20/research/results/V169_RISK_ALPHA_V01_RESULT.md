# V16.9-RiskAlpha v0.1 — Frozen One-Shot Result

- GitHub Actions run: `33265619302`
- Research workflow: `V16.9 RiskAlpha Research`
- Source branch: `agent/egx-meta-engine-v1-20260829`
- Source commit: `e714fcae588a7da1d6ee9a3cbac8f41b6b0baf45`
- Artifact: `v169-riskalpha-research`
- Artifact ID: `9718551698`
- Artifact ZIP SHA-256: `4bb608568a2f17ee74516e22f983d301df0873d0ad70e428cff9cf0ae4636e51`
- Extracted report SHA-256: `c124a917255ab4e2d1b93a1244ad5853d527513a90991e5145966a489ead5385`
- Evidence window: 45 sessions, signal dates 2026-06-24 through 2026-08-26, last outcome 2026-08-27.

## Baseline V16.9
- Average Net Return: **1.6624%**
- Profit Factor: **2.532**
- Maximum Drawdown: **-10.877%**
- Winning Session Rate: **55.556%**
- Conservative Target Rate: **28.91%**
- Stop Rate: **28.91%**

## V16.9-RiskAlpha v0.1
- Average Net Return: **2.1773%**
- Profit Factor: **3.315**
- Maximum Drawdown: **-10.361%**
- Winning Session Rate: **60.0%**
- Conservative Target Rate after guard: **31.09%**
- Stop Rate after guard: **26.89%**
- Vetoed members: **14**
- Vetoed stops: **5**
- Vetoed conservative targets: **0**

## Deltas
- Average Return: **+0.5149 pp**
- Profit Factor: **+0.783**
- Maximum Drawdown improvement: **+0.516 pp**
- Stop Rate reduction: **2.02 pp**
- Conservative Target Rate: **+2.18 pp**

## Frozen acceptance outcome
Passed: session count, veto count, Average Return improvement, Profit Factor improvement, Target Rate preservation, anti-lookahead construction.

Failed: required Max Drawdown improvement >= 1.0 pp; achieved 0.516 pp. Required Stop Rate reduction >= 5.0 pp; achieved 2.02 pp.

**Formal verdict: `NOT_ACCEPTED_NO_RETUNE`.**

Disposition: `KEEP_V16_9_CHAMPION_REJECT_RISKALPHA_V0_1_NO_RETUNE`.

The result is intentionally frozen. The v0.1 thresholds/guard must not be retuned on this evidence window. Any further improvement must target a different independently identified residual failure mechanism and receive its own preregistered one-shot test and forward evaluation. No production authority, no promotion, no main-branch mutation.
