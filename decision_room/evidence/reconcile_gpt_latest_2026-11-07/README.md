# Reconciliation: GPT `paper-v4/official-session-latest.json` (main @1f60821) vs Claude V8 (5 Nov OFFICIAL bars)
Read-only comparison; nothing in `main` or Vercel was touched. GPT JSON sha256 b4b3ad4ec1034a077917de6f5c97e16752d6c2d271dfa59c2c36327ecd34ead1 (matches the hash GPT reported). V8 = final_v8.sqlite (sha256 9c891244...8a28), 147 OFFICIAL_EGX bars on 2026-11-05. Per-row result: `reconciliation.csv`.

| status | rows |
|---|---|
| AGREE (GPT ticker + exact open/high/low/close equal V8) | 85 |
| CONFLICT: GPT's `ICID` row has OHLC 2.05/2.12/2.05/2.11; V8's official ICID is 17.24/17.98/17.0/17.98 and V8 maps that row to `EHDR` => GPT's name match is WRONG | 1 |
| GPT mapped, V8 has no 5 Nov bar (21 with history, 10 with no history in V8) | 31 |
| GPT unmapped, V8 identifies a unique ticker by exact OHLC (identity chain via V8's alias + prev-close rule) | 60 |
| Unmapped on both sides | 37 |

Notes
- The 31 'no V8 bar' rows include the most liquid names (COMI, ABUK, TMGH, PHDC, ADIB, ISPH, CLHO, EAST ...). V8's last bar for most of them is 2-3 Nov, i.e. V8 itself lacks their 3/4/5 Nov bars; implied previous close from the 5 Nov row therefore cannot be validated against V8 (10 have no history at all: CRST, KORA, TYCN, NAPR, GPIM, QNBE, AIHC, VALU, TAQA, ACAP). So V8 coverage of top-liquidity names on the latest day is a real gap, not just GPT's.
- 34 GPT rows are MANUAL_PROVISIONAL; 21 of them agree with V8 on exact OHLC, 13 have no V8 bar. Agreement of OHLC is evidence of the right row, not of ISIN.
- Consequence: `official-session-latest.json` should not be treated as an identity source; promotion needs a reviewed mapping (see runbook) and the ICID row corrected.
