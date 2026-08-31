# Recommendation Contract
Only BUY_CANDIDATE, WAIT_FOR_ENTRY, WATCH, REJECT and NO_TRADE are top-level states. Every issued recommendation is append-only and versioned by snapshotHash, engine/config/model/feature versions and commit hash. Outcome observation can never mutate the original recommendation.
