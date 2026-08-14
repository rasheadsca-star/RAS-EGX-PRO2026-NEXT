# V20 Phase 11 — Explainable Decision Intelligence

## Objective
Add a transparent V20 research decision score without relabeling the legacy ranking as V20 intelligence, without manufacturing model confidence, and without allowing the new score to alter V17 execution permission, production allocation, Champion selection, or automatic promotion.

## Why a new layer is required
`data/final-opportunity-ranking.json` is retained as a legacy reference. Its `finalScore`, `targetProbability`, historical R/R and confidence fields come from an older composite method. V20 already proved that legacy R/R can materially diverge from conservative entry-range-based net R/R, so the old score must not be silently treated as a current calibrated probability or confidence measure.

## V20 Research Decision Score
The new score is **shadow research only and uncalibrated**. It combines seven explicit components whose weights sum to 100%:

- Legacy opportunity reference: 25%
- Current data evidence: 20%
- Liquidity evidence: 15%
- Support/resistance evidence: 10%
- Conservative net R/R after round-trip costs: 15%
- Current-price / trade-plan alignment: 10%
- Current point-in-time technical evidence: 5%

These are transparent research heuristics, not calibrated alpha weights. Missing components are excluded from both numerator and denominator and reduce `scoreEvidenceCoveragePct`; missing technical history is never converted to a neutral or positive technical score.

## Deterministic research tiers
Tiers have **no execution meaning** and require at least 70% evidence coverage:

- `RESEARCH_A`: score >= 80
- `RESEARCH_B`: score >= 65
- `RESEARCH_C`: score >= 50
- `RESEARCH_D`: score < 50
- `UNRATED_INSUFFICIENT_EVIDENCE`: evidence coverage below 70%

## Defensive caps
Caps are operational sanity controls, not alpha calibration:

- Invalid/rebuild-required trade plan: score <= 39
- Critical source conflict: score <= 35
- Missing critical symbol evidence: score <= 50
- Price above entry range / do-not-chase state: score <= 55

The cap does not diagnose the cause of price-scale or staleness anomalies.

## Separation contract
The score:
- is not confidence;
- cannot infer model confidence;
- cannot open V17 execution gate;
- cannot create `ACTIONABLE`;
- cannot change issued position weights;
- cannot alter production allocation;
- cannot change frozen V16.9 Champion;
- cannot trigger automatic promotion;
- cannot replace production Champion ranking without fresh independent validation.

Current market/data/model/execution confidence dimensions remain separate and are copied from the existing Stock Profile without inference from the research score.

## Validation requirement
Before any production use, the score architecture requires both forward evidence and independent holdout/walk-forward validation. Phase 9 forward evidence remains authoritative for future point-in-time outcomes.
