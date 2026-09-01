# EGX ONE refresh/deployment architecture

- `EGX ONE Research Market Refresh` is data/recommendation generation only.
- It must not invoke Vercel or build a partial Vercel bundle.
- Its snapshot commit triggers `EGX ONE Production UI Deploy`.
- The Production UI Deploy uses `scripts/prepare-egx-one-live-bundle.sh` and is the only Vercel deployment workflow.
- The complete bundle includes Chart V2.1, Realized KPI, live current-session research evidence, simulator and shadow ledger.
- All technical/KPI layers have zero scoring, recommendation-mutation, and execution authority.
