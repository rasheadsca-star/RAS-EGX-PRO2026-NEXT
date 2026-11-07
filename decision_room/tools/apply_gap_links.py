"""Apply owner-approved NAME LINKS to a COPY of a DB for sessions 3-5 Nov. Never touches the source DB.
Rules: per (name, session) the bulletin row must be unresolved (ticker NULL, status QUARANTINED_NO_MATCH/PREVCLOSE_MISMATCH/PROPOSED_FUZZY), bounds_status OK,
and the previous-close chain must hold within TOL: implied prev (close/(1+chg%)) vs ticker's previous-session close, where for the 2nd/3rd session the previous close is the
official close just applied. Failing rows are logged NOT_APPLIED and change nothing. Existing non-official bars are archived in canonical_bars_superseded.
usage: apply_gap_links.py SRC_DB DST_DB approvals.json out_prefix"""
import sqlite3, sys, json, shutil, csv, re, pathlib
SRC, DST, APP, OUT = sys.argv[1:5]
TOL = 0.0015
PRIOR = {'2026-11-03': '2026-11-02', '2026-11-04': '2026-11-03', '2026-11-05': '2026-11-04'}
def norm(s): return re.sub(r'[^a-z0-9]+', ' ', s.lower()).strip()
shutil.copy(SRC, DST)
c = sqlite3.connect(DST)
appr = json.load(open(APP)); ref = appr['approval_date']
by = {norm(e['bulletin_name']): e['ticker'] for e in appr['approvals']}
c.execute("create table if not exists approved_name_matches(session_date,source_name,pdf_page,pdf_rank,ticker,implied_prev_close,ticker_prev_close,prev_diff_pct,status,evidence,action,baseline_tier,baseline_close,new_close,approval_scope,approval_ref)")
log = []
rows = c.execute("select session_date,pdf_page,pdf_rank,name_en,open,high,low,close,volume,chg_pct,resolution_status,bounds_status,ticker from official_session where session_date in ('2026-11-03','2026-11-04','2026-11-05') order by session_date").fetchall()
applied_close = {}
for sd, pg, rk, nm, o, h, l, cl, vol, chg, st, bs, tk in rows:
    t = by.get(norm(nm))
    if not t: continue
    implied = cl / (1 + chg / 100) if chg is not None else None
    if sd == '2026-11-03':
        r = c.execute("select close from canonical_bars where ticker=? and date='2026-11-02' and price_basis='RAW'", (t,)).fetchone(); prev = r[0] if r else None
    else:
        prev = applied_close.get((t, PRIOR[sd]))
    base = c.execute("select evidence_tier,close,providers,selected_source_id,n_observations,notes,open,high,low,volume from canonical_bars where ticker=? and date=? and price_basis='RAW'", (t, sd)).fetchone()
    diff = abs(implied / prev - 1) if implied and prev else None
    ok = tk is None and bs == 'OK' and st in ('QUARANTINED_NO_MATCH', 'QUARANTINED_ALIAS_PREVCLOSE_MISMATCH', 'PROPOSED_FUZZY_NEEDS_APPROVAL') and diff is not None and diff <= TOL
    if not ok:
        why = 'prev_chain_fail' if (diff is None or diff > TOL) else f'status_{st}_{bs}'
        log.append((sd, nm, pg, rk, t, implied, prev, None if diff is None else round(diff * 100, 4), st, why, 'NOT_APPLIED_' + why.upper(), base[0] if base else None, base[1] if base else None, None, 'NAME_LINK_ONLY', ref)); continue
    act = 'ADDED_OFFICIAL_BAR'
    if base:
        act = 'ALREADY_OFFICIAL' if base[0] == 'OFFICIAL_EGX' else 'SUPERSEDED_' + base[0]
        if base[0] != 'OFFICIAL_EGX':
            c.execute("insert into canonical_bars_superseded select ticker,date,price_basis,open,high,low,close,volume,evidence_tier,providers,selected_source_id,n_observations,notes,?,null,? from canonical_bars where ticker=? and date=? and price_basis='RAW'", ('S7_EGX_OFFICIAL_' + sd.replace('-', '') + ' (approved name link ' + ref + ')', round((cl / base[1] - 1) * 100, 4), t, sd))
            c.execute("delete from canonical_bars where ticker=? and date=? and price_basis='RAW'", (t, sd))
    if act != 'ALREADY_OFFICIAL':
        c.execute("insert into canonical_bars(ticker,date,price_basis,open,high,low,close,volume,evidence_tier,providers,selected_source_id,n_observations,notes) values(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                  (t, sd, 'RAW', o, h, l, cl, vol, 'OFFICIAL_EGX', 'egx_official', 'S7_EGX_OFFICIAL_' + sd.replace('-', ''), 1, f'Official PDF; name link approved {ref}; previous-close chain verified; raw not adjusted'))
    c.execute("update official_session set ticker=?, resolution_status='RESOLVED_ALIAS_PREVCLOSE', resolution_evidence=? where session_date=? and pdf_page=? and pdf_rank=?", (t, f'approved name link {ref};prev_diff={diff:.5f}', sd, pg, rk))
    applied_close[(t, sd)] = cl
    log.append((sd, nm, pg, rk, t, implied, prev, round(diff * 100, 4), 'RESOLVED_ALIAS_PREVCLOSE', f'approved name link;prev_diff={diff:.5f}', act, base[0] if base else None, base[1] if base else None, cl, 'NAME_LINK_ONLY', ref))
c.executemany("insert into approved_name_matches values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", log)
c.commit()
w = csv.writer(open(OUT + '_applied.csv', 'w', newline='', encoding='utf-8'))
w.writerow(['session_date','source_name','pdf_page','pdf_rank','ticker','implied_prev_close','ticker_prev_close','prev_diff_pct','status','evidence','action','baseline_tier','baseline_close','new_close','approval_scope','approval_ref']); w.writerows(log)
from collections import Counter
print(Counter(r[10] for r in log)); print('integrity', c.execute('pragma integrity_check').fetchone())
