# V20 Shadow S/R Simulation Retirement

The earlier experimental `build-sr-shadow-remediation.cjs` path is retired and is not accepted evidence.

Reason: the experiment refreshed `data/history/<ticker>.json`, while the authoritative V17 Internal OHLC S/R builder reads `data/history-50.json`. Therefore the experiment did not actually test the intended upstream input path and could not support a trustworthy remediation claim.

V20 does not relabel Yahoo history as V17 trusted execution provenance and does not mutate V17 evidence. The accepted replacement is the read-only S/R remediation audit (`scripts/v20/build-sr-remediation-audit.cjs` + regression), which diagnoses the current authoritative V17 gaps and requires an intentional governed V17 Internal S/R rebuild and resilient-session gate rebuild after any real upstream evidence remediation.
