# V19 EGX CHAT GPT — Isolated Native Challenger

## Scope

V19 is an isolated research/shadow container inside the repository. It lives only on branch `v19-egx-chat-gpt` and writes only to `scripts/v19/`, `data/v19/`, `docs/v19/`, and `.github/workflows/v19-egx-chat-gpt.yml`.

V16 and V17 are read-only references. V19 does not mutate their code, ledgers, hashes, recommendations, or promotion state.

## Recommendation technique

V19 changes the selection question from “which stocks are most likely to be Top 10 next session?” to “which stocks have the strongest probability-adjusted, risk-aware, liquidity-confirmed and structurally executable opportunity?”

The native model trains three probabilities with no future leakage:

- probability of being Top 10 next session;
- probability of a positive next-session return after the 0.60% cost assumption;
- probability of a large loss (<= -2%).

The ranking score is the geometric mean of `P_TOP10`, `P_NET_POSITIVE`, and `1 - P_LARGE_LOSS`. This avoids arbitrary hand-weighted score soup while keeping each probability inspectable.

## Factor groups and ablation

The engine measures nested variants so every new layer can be tested rather than assumed useful:

1. Core: the existing technical/predictive feature foundation.
2. Core + Liquidity/SR: adds liquidity behavior and Classic Pivot structural support/resistance.
3. Full V19: adds market regime and breadth context.

Ablation metrics are stored independently.

## Entry / stop / target

The signal-session OHLC derives Classic Pivot support/resistance. Entry, stop and target are ATR-bounded but structurally anchored. A candidate is execution-eligible only when transparent liquidity, chase-risk and minimum risk/reward checks pass.

Historical evaluation never invents intraday ordering. Entry counts only when the next session opens inside the entry range. If target and stop are both touched in the same daily candle, the outcome is treated as stop loss.

Unfilled or ineligible basket slots remain cash and are not redistributed.

## Backtesting and leakage controls

- Expanding walk-forward scoring starts only after a warm-up window.
- Basket size 3/4/5 is selected only from prior validation sessions and then applied forward.
- The final 20 sessions are a strict independent frozen holdout. Holdout labels are never used to refit model weights.
- Transaction cost assumption is 0.60%, not lower than the V16 champion assumption.
- Automatic promotion is forbidden.

## Retroactive V16/V17 replay

V19 reads the recorded V16 exact-method sessions and the V17 native ledger / track-record dates. Each recorded date is replayed using only information that would have been available before that date. Reconstructed rankings are tagged `RETROACTIVE_AS_OF_DATE_REPLAY_NOT_LIVE_V19_EVIDENCE`.

The replay is a comparison/research artifact only. It does not rewrite the V16/V17 ledgers and does not count as native live V19 evidence.

## Promotion governance

The champion remains `V16_9_EQUAL_WEIGHT_BASKET`. V19 can only become `CHALLENGER_ELIGIBLE_FOR_RELEASE_REVIEW` if the independent holdout and development evidence clear the explicit gate. Even then `promotionAllowed=false`; a separate release review is mandatory.
