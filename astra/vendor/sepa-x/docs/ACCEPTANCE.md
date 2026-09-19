# Acceptance criteria

- Coverage: every selected universe symbol is attempted and every failure is logged.
- Freshness: stale symbols fail the data gate.
- Explainability: stage outputs preserve raw values and reason codes.
- Determinism: same input/config => same calculation.
- No hallucination: missing data remains null/UNKNOWN.
- No chasing: EXTENDED => WAIT FOR NEW SETUP.
- Full ranking: analyzed symbols receive market rank.
- Top opportunity: Top 5 is readiness-aware, not merely highest momentum.
- Historical validation: recommendation history and transition logs are persisted by the scanner.
- Backtest integrity: point-in-time guards are implemented; a full historical P&L is not claimed unless point-in-time market/fundamental/catalyst snapshots are available.
