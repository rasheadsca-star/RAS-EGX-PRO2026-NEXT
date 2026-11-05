"""Quarantines carried-forward 'phantom' sessions: moves RAW bars of a session into canonical_bars_superseded (no deletion
of evidence; raw_observations untouched). Refuses unless >=90% of that session's bars equal the previous session's bar
(close AND volume>0) and no bar is OFFICIAL_EGX. usage: quarantine_phantom_sessions.py --db in --out out DATE [DATE...]"""
import argparse,shutil,sqlite3,sys
def main(argv=None):
    a=argparse.ArgumentParser();a.add_argument("--db",required=True);a.add_argument("--out",required=True);a.add_argument("dates",nargs="+");x=a.parse_args(argv)
    shutil.copyfile(x.db,x.out);c=sqlite3.connect(x.out)
    c.execute("create table if not exists phantom_session_quarantine(session text,prev_session text,n_bars integer,n_identical_to_prev integer,share real,reason text)")
    cols="ticker,date,price_basis,open,high,low,close,volume,evidence_tier,providers,selected_source_id,n_observations,notes"
    for d in x.dates:
        prev=c.execute("select max(date) from canonical_bars where price_basis='RAW' and date<?",(d,)).fetchone()[0]
        n,s,off=c.execute("""select count(*),sum(a.close=b.close and a.volume=b.volume and a.volume>0),sum(a.evidence_tier='OFFICIAL_EGX') from canonical_bars a
          left join canonical_bars b on a.ticker=b.ticker and b.date=? and b.price_basis='RAW' where a.date=? and a.price_basis='RAW'""",(prev,d)).fetchone()
        if not n:raise SystemExit(f"{d}: no bars")
        if off:raise SystemExit(f"{d}: contains OFFICIAL bars; refusing")
        if (s or 0)/n<0.9:raise SystemExit(f"{d}: only {(s or 0)}/{n} identical to {prev}; refusing")
        c.execute(f"insert into canonical_bars_superseded({cols},superseded_by_source,superseded_by_pdf_sha256,diff_pct) select {cols},'PHANTOM_SESSION_QUARANTINE',NULL,NULL from canonical_bars where date=? and price_basis='RAW'",(d,))
        c.execute("delete from canonical_bars where date=? and price_basis='RAW'",(d,))
        c.execute("insert into phantom_session_quarantine values(?,?,?,?,?,?)",(d,prev,n,s,round(s/n,4),"carried-forward copy of previous session; single-provider; no official evidence"))
        print(d,n,s,"quarantined")
    c.commit();print(c.execute("pragma integrity_check").fetchone()[0]);return 0
if __name__=="__main__":sys.exit(main())
