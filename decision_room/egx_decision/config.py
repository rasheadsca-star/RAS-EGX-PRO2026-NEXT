"""Frozen gate parameters. Changing any value requires a new SCHEMA_VERSION and review."""
CALENDAR_MIN_TICKERS=50          # a date is a confirmed market session if >=50 RAW tickers have a bar
MIN_BARS=51                      # valid sessions needed for MA50 + momentum
WIN20=20; WIN51=51
MIN_ADV20_EGP=1_000_000
MIN_VOLUME_DAYS_20=15            # sessions with volume>0 among last 20
MAX_ABS_RET_1D=0.11              # unresolved jump inside the 51-session window => blocked
MAX_ORDER_ADV_FRAC=0.01          # order <= 1% of ADV20 (shown as capacity, not as advice)
STALE_SESSION_DAYS=4             # frontend/pipeline: session older than this vs today => stale banner
APPROVED_STRATEGIES=()           # none approved (NO_STRATEGY_APPROVED); levels stay disabled
H1_STATUS_ALLOWED="PROMISING_NEEDS_FORWARD_TEST"
REQUIRED_COLUMNS={
 "canonical_bars":{"ticker","date","price_basis","open","high","low","close","volume","evidence_tier"},
 "conflicts":{"ticker","date","kind","resolution"},
 "corporate_actions":{"ticker","date","status","raw_change_pct"},
 "quality_gates":{"ticker","research_ready","paper_ready","live_ready"},
 "symbol_identity":{"ticker","name_en","name_ar"},
}
