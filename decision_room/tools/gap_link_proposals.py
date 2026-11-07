"""Read-only: propose name->ticker links for official bulletin rows left unmapped on 3/4/5 Nov.
Evidence per candidate (independent signals, none uses a future price):
  PREV: ticker's last bar close before the session vs the close implied by the bulletin row (close/(1+chg%)).
  VOL : exact equality of bulletin volume with the ticker's same-day bar volume (any provider).
  CHAIN: same bulletin name appears on the other days and its implied prevs chain to the previous bulletin close.
Output is a PROPOSAL only; nothing is written to any DB. Usage: gap_link_proposals.py DB OUT_CSV
"""
import sqlite3, sys, csv, re
from collections import defaultdict
DB, OUT = sys.argv[1], sys.argv[2]
DATES = ('2026-11-03', '2026-11-04', '2026-11-05')
TOL = 0.0015
c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
def norm(s): return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()
rows = c.execute("select session_date,name_en,close,chg_pct,volume,ticker,resolution_status,pdf_page,pdf_rank from official_session where session_date in (?,?,?)", DATES).fetchall()
bars = defaultdict(dict)
for t, d, cl, v, tier in c.execute("select ticker,date,close,volume,evidence_tier from canonical_bars where date>='2026-10-25'"):
    bars[t][d] = (cl, v, tier)
volidx = defaultdict(list)
for t, m in bars.items():
    for d, (cl, v, tier) in m.items():
        if v: volidx[(d, round(v))].append(t)
PRIOR = {'2026-11-03': '2026-11-02', '2026-11-04': '2026-11-03', '2026-11-05': '2026-11-04'}
def last_before(t, d):
    ds = [x for x in bars[t] if x == PRIOR[d]]
    return (ds[-1], bars[t][ds[-1]][0]) if ds else (None, None)
taken = defaultdict(set)
for d, n, cl, chg, vol, tk, st, pg, rk in rows:
    if tk: taken[d].add(tk)
byname = defaultdict(dict)
for d, n, cl, chg, vol, tk, st, pg, rk in rows: byname[norm(n)][d] = (cl, chg)
out = []
for d, n, cl, chg, vol, tk, st, pg, rk in sorted(rows):
    if tk or st.startswith('EXCLUDED'): continue
    imp = cl / (1 + chg / 100) if chg is not None else None
    vt = [t for t in volidx.get((d, round(vol)), []) if t not in taken[d]] if vol else []
    pt = []
    if imp:
        for t in bars:
            pd_, pc = last_before(t, d)
            if pc and abs(pc - imp) / imp <= TOL and t not in taken[d]: pt.append(t)
    both = sorted(set(vt) & set(pt))
    out.append(dict(session=d, name=n, close=cl, chg_pct=chg, volume=vol, v8_status=st, implied_prev=round(imp, 4) if imp else '',
                    vol_match=';'.join(sorted(vt)), prev_match=';'.join(sorted(pt)) if len(pt) <= 5 else f'{len(pt)} tickers',
                    both=';'.join(both)))
# aggregate per name
agg = defaultdict(list)
for r in out: agg[norm(r['name'])].append(r)
final = []
for k, rs in agg.items():
    # VOL: tickers whose same-day volume equals the bulletin volume on every day that has a candidate.
    vsets = [set(r['vol_match'].split(';')) - {''} for r in rs]
    nonempty = [v for v in vsets if v]
    cand = set.intersection(*nonempty) if nonempty else set()
    # PREV: only the first session (3 Nov) is checkable against a verified prior-day bar (2 Nov); later days chain through the same name.
    first = sorted(rs, key=lambda r: r['session'])[0]
    pc_all = set(first['prev_match'].split(';')) - {''} if first['session'] == '2026-11-03' and 'tickers' not in first['prev_match'] else set()
    both = cand & pc_all
    if len(both) == 1: cls = 'STRONG_VOL_AND_PREV_ALL_DAYS'
    elif len(cand) == 1: cls = 'VOL_ONLY_UNIQUE'
    elif len(pc_all) == 1: cls = 'PREV_ONLY_UNIQUE'
    else: cls = 'UNRESOLVED'
    pick = next(iter(both or cand or pc_all)) if cls != 'UNRESOLVED' and (len(both) == 1 or len(cand) == 1 or len(pc_all) == 1) else ''
    final.append(dict(name=rs[0]['name'], days=len(rs), proposed_ticker=pick, evidence=cls, vol_candidates=';'.join(sorted(cand)), prev_candidates=';'.join(sorted(pc_all)) if len(pc_all) <= 5 else f'{len(pc_all)}', avg_volume=round(sum(r['volume'] or 0 for r in rs) / len(rs))))
with open(OUT, 'w', newline='', encoding='utf-8') as f:
    w = csv.DictWriter(f, fieldnames=list(final[0].keys())); w.writeheader(); w.writerows(sorted(final, key=lambda r: -r['avg_volume']))
from collections import Counter
print(Counter(r['evidence'] for r in final), len(final))
