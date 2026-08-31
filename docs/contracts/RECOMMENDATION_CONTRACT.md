# Recommendation Contract

Only `BUY_CANDIDATE`, `WAIT_FOR_ENTRY`, `WATCH`, `REJECT` and `NO_TRADE` are top-level decision states. Every issued recommendation is append-only and versioned by `snapshotHash`, engine/config/model/feature versions and commit hash. Outcome observation can never mutate the original recommendation.

## Authority separation

Recommendation admission is separated by immutable Session Manifest authority:

- `appendRecommendation()` is production-only and requires the referenced Session Manifest to have `authorityMode=CERTIFIED_PRODUCTION`.
- `appendResearchRecommendation()` is research-only and requires `authorityMode=RESEARCH`.

The ledger stores its own `authority_mode` and database triggers require it to match the referenced Session Manifest. A research recommendation therefore cannot be relabeled as production either through the public API or through a direct ledger insert. Signal session must also equal the immutable Session Manifest market session.

Session Manifests and recommendation rows are append-only after admission. A production recommendation can only descend from the certified chain: official/certified observations → certified reconciliation → `CERTIFIED_PRODUCTION` normalized snapshot → `CERTIFIED_PRODUCTION` Session Manifest → production recommendation.
