# G10 Golden-Master Historical Parity Certification

Status: **GREEN**

Production eligibility remains **1/18**. Historical parity eligibility accounts for **18/18** registered strategies, **33/33** materially distinct version source artifacts, and **20/20** engine capability lineages.

## Evidence-weighted metrics
- Externally anchored Golden cases: 5.
- Exact Golden cases: 1.
- Tolerance Golden cases: 4.
- Intentional documented differences: 2.
- Missing-evidence cases: 6.
- Not-comparable cases: 1.
- Material unresolved comparable mismatches: 0.

Synthetic source-rule regression fixtures are not counted as Golden Masters. Missing evidence is not converted into a pass percentage.

## Historical session replay
The preserved V16.9 basket for 2026-08-05 matches the issued four-stock basket exactly. Its four plan geometries match within a narrowly derived representation tolerance of **0.0007**. The bound follows directly from preserved ATR14 serialization to three decimals (±0.0005 hidden precision), the largest legacy ATR multiplier 1.2 (maximum propagation 0.0006), and four-decimal plan serialization. No tolerance applies to score, signal, eligibility, rank, tier, regime, support or resistance.

QUANT_EDGE remains **OUTPUT_INTEGRITY_ONLY** and is not algorithmically reproduced. The original pre-ensemble V18 REVERSAL algorithm and other versions without externally anchored ticker/session Golden outputs remain explicit evidence gaps rather than fabricated parity.

G10 did not cut over production, remove legacy runtime dependencies, or change G12. All 8 dependencies remain and G12 is PENDING. The G10 focused destructive review does not increment G19.
