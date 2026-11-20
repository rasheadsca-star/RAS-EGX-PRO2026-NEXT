# Independent price evidence intake (research-only)

Run `node scripts/research/egx-price-evidence-triage-v1.cjs` after creating the attribution JSON. It produces a complete CSV review queue and JSON, preserving source close and main close without overwriting any historical candle.

Optional input: `data/research/egx-independent-price-evidence-input.json` (JSON array) with `ticker`, `date`, `evidenceType`, `sourceName`, `sourceUrl` (HTTPS), `documentSha256` (SHA-256 of the actual document), `capturedAt` (ISO timestamp), and `observedClose` for dated price evidence. Allowed types: EXCHANGE_OFFICIAL_CLOSE, OFFICIAL_CORPORATE_ACTION, INDEPENDENT_DATED_OHLCV, SECURITY_IDENTITY_DOCUMENT.

An HTTPS link or claimed evidence type is not proof. This tool validates **metadata format only**; it does not download/authenticate documents, verify exchange identity, validate adjusted prices, or approve manual review. Submitted evidence remains quarantined and no candle is promoted. The existing readiness gate remains BLOCKED_RESEARCH_ONLY.
