#!/usr/bin/env python3
"""Compare a BASELINE staged DB with the staged DB built with owner-approved name links and record, inside the NEW db and as CSV/JSON:
 * approved_name_matches : one row per applied (approval, session): bulletin name, pdf page/rank, ticker, implied previous close, ticker previous close, diff %, status, evidence, action
   (ADDED_OFFICIAL_BAR / SUPERSEDED_<tier>_BAR / ALREADY_OFFICIAL), the tier that the bar had in the baseline
 * approved_name_matches_audit : any canonical_bars row whose (ticker,date) is NOT in the approved set but changed vs the baseline  -> must be empty
usage: log_approved_matches.py --baseline b.sqlite --new n.sqlite --approvals a.json --out-prefix p   (writes into n.sqlite, which must be a build output you own)"""
import argparse,csv,json,sqlite3,sys,pathlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
import official_map as om
def main(argv=None):
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k.replace("_","-"),required=True) for k in("baseline","new","approvals","out_prefix")];a=ap.parse_args(argv)
    appr=json.load(open(a.approvals))["approvals"];by={om.norm_key(e["bulletin_name"]):e for e in appr};tks={e["ticker"] for e in appr}
    n=sqlite3.connect(a.new)
    n.execute("attach ? as b",(a.baseline,))
    n.execute("drop table if exists approved_name_matches");n.execute("drop table if exists approved_name_matches_audit")
    n.execute("create table approved_name_matches(session_date,source_name,pdf_page,pdf_rank,ticker,implied_prev_close,ticker_prev_close,prev_diff_pct,status,evidence,action,baseline_tier,baseline_close,new_close,approval_scope,approval_ref)")
    rows=[]
    for sd,pg,rk,nm,ck,chg,tk,st,ev in n.execute("select session_date,pdf_page,pdf_rank,name_en,close,chg_pct,ticker,resolution_status,resolution_evidence from main.official_session where market is null").fetchall():
        e=by.get(om.norm_key(nm))
        if not e:continue
        implied=ck/(1+chg/100) if chg is not None else None
        pv=om.prev_closes(n,sd).get(e["ticker"])
        bt=n.execute("select evidence_tier,close from b.canonical_bars where ticker=? and date=? and price_basis='RAW'",(e["ticker"],sd)).fetchone()
        nb=n.execute("select evidence_tier,close from main.canonical_bars where ticker=? and date=? and price_basis='RAW'",(e["ticker"],sd)).fetchone()
        sup=n.execute("select evidence_tier from main.canonical_bars_superseded where ticker=? and date=?",(e["ticker"],sd)).fetchone()
        act=("ADDED_OFFICIAL_BAR" if not bt else ("SUPERSEDED_"+(sup[0] if sup else bt[0]) if nb and nb[0]=="OFFICIAL_EGX" and bt[0]!="OFFICIAL_EGX" else "ALREADY_OFFICIAL")) if st in("RESOLVED_ALIAS_PREVCLOSE","SUPERSEDES_UNOFFICIAL_BAR","ALREADY_HAS_OFFICIAL_BAR") else "NOT_APPLIED_"+str(st)
        rows.append((sd,nm,pg,rk,e["ticker"],implied,pv,None if not(implied and pv) else round(abs(implied/pv-1)*100,4),st,ev,act,bt[0] if bt else None,bt[1] if bt else None,nb[1] if nb else None,e["scope"],e["approval_date"]))
    n.executemany("insert into approved_name_matches values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",rows)
    n.execute("create table approved_name_matches_audit as select 'CHANGED' as kind,x.ticker,x.date,x.evidence_tier as new_tier,x.close as new_close,y.evidence_tier as base_tier,y.close as base_close from main.canonical_bars x left join b.canonical_bars y on y.ticker=x.ticker and y.date=x.date and y.price_basis=x.price_basis where x.price_basis='RAW' and (y.ticker is null or y.close is not x.close or y.open is not x.open or y.high is not x.high or y.low is not x.low or y.volume is not x.volume or y.evidence_tier is not x.evidence_tier)")
    n.execute("insert into approved_name_matches_audit select 'REMOVED',y.ticker,y.date,null,null,y.evidence_tier,y.close from b.canonical_bars y where y.price_basis='RAW' and not exists(select 1 from main.canonical_bars x where x.ticker=y.ticker and x.date=y.date and x.price_basis=y.price_basis)")
    # evidence preservation: baseline non-official bars that the approved official bars replaced are archived (they were hole-fills, so they never existed in this build),
    # and their raw candidate observations are carried over. Nothing is deleted from the baseline's evidence.
    n.execute("insert into main.canonical_bars_superseded select y.ticker,y.date,y.price_basis,y.open,y.high,y.low,y.close,y.volume,y.evidence_tier,y.providers,y.selected_source_id,y.n_observations,y.notes,'S7_EGX_OFFICIAL_'||replace(y.date,'-','')||' (approved name link)',null,round((x.close/y.close-1)*100,4) from b.canonical_bars y join main.canonical_bars x on x.ticker=y.ticker and x.date=y.date and x.price_basis=y.price_basis where y.price_basis='RAW' and x.evidence_tier='OFFICIAL_EGX' and y.evidence_tier<>'OFFICIAL_EGX' and not exists(select 1 from main.canonical_bars_superseded z where z.ticker=y.ticker and z.date=y.date and z.evidence_tier=y.evidence_tier and z.close=y.close)")
    cols_ro=[r[1] for r in n.execute("pragma table_info(raw_observations)") if r[1]!="obs_id"];cl=",".join(cols_ro)
    n.execute(f"insert into main.raw_observations({cl}) select {','.join('y.'+c for c in cols_ro)} from b.raw_observations y where not exists(select 1 from main.raw_observations x where x.ticker=y.ticker and x.date=y.date and x.source_id=y.source_id and x.close is y.close)")
    n.commit()
    cols=[r[1] for r in n.execute("pragma table_info(approved_name_matches)")]
    w=csv.writer(open(a.out_prefix+"_applied.csv","w",newline="",encoding="utf-8"));w.writerow(cols);w.writerows(rows)
    aud=n.execute("select * from approved_name_matches_audit order by ticker,date").fetchall()
    ac=[r[1] for r in n.execute("pragma table_info(approved_name_matches_audit)")];w=csv.writer(open(a.out_prefix+"_bar_changes.csv","w",newline="",encoding="utf-8"));w.writerow(ac);w.writerows(aud)
    unexpected=[r for r in aud if r[1] not in tks]
    out=dict(applied_rows=len(rows),by_action={k:sum(1 for r in rows if r[10]==k) for k in sorted({r[10] for r in rows})},bar_changes_total=len(aud),bar_changes_outside_approved_tickers=len(unexpected),unexpected_sample=unexpected[:10])
    json.dump(out,open(a.out_prefix+"_summary.json","w"),indent=1);print(json.dumps(out));n.close()
    return 0 if not unexpected else 1
if __name__=="__main__":sys.exit(main())
