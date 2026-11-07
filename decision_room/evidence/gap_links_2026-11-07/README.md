# Proposed name links for unmapped official-bulletin rows, 3-5 Nov 2026 (PROPOSAL ONLY)

Tool: `tools/gap_link_proposals.py` (read-only on V8; writes only `proposals.csv`). Nothing here is merged into any DB; link approval is the owner's decision.

Evidence classes (86 unmapped bulletin names, 3 sessions):
| class | names | meaning |
|---|---|---|
| STRONG_VOL_AND_PREV_ALL_DAYS | 15 | bulletin volume equals the ticker's same-day bar volume AND implied prev close (close/(1+chg%)) equals the ticker's 2 Nov close within 0.15% |
| VOL_ONLY_UNIQUE | 10 | exact volume equality with exactly one ticker; prev-close not checkable (no 2 Nov bar) or contradicted |
| PREV_ONLY_UNIQUE | 5 | exactly one untaken ticker matches the implied 2 Nov close (includes COMI for CIB, ABUK) |
| UNRESOLVED | 56 | no unique candidate (no V8 bars/history for them) |

Caveats
- Volume equality uses non-official providers (mostly mubasher). It supports identity, not price: e.g. PHDC mubasher 2-3 Nov closes differ from the official close, and its 2 Nov close contradicts the implied prev (1.2%), so PHDC is VOL_ONLY and must be reviewed by hand.
- Price tolerance 0.15% can tie on low-priced names; candidates already mapped to another bulletin row that day are excluded.
- Even if approved, V8 still has no official 3/4/5 Nov bar for these names until a separate approved merge step; no OHLC is invented.
