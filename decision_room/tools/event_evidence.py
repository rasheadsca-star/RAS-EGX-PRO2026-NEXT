#!/usr/bin/env python3
"""Attach PENDING (press-reported) corporate-event and price-limit evidence to a NEW db copy and test it numerically against the data. Nothing in canonical_bars, corp_action_factors
or any gate is touched. Tables: pending_corporate_events, pending_event_checks, price_limit_evidence, price_limit_checks.
usage: event_evidence.py --src-db a.sqlite --dst-db b.sqlite --config pending_evidence.json [--report r.json]"""
import argparse,json,os,sqlite3,sys
def main(argv=None):
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k.replace("_","-"),required=True) for k in("src_db","dst_db","config")];ap.add_argument("--report");a=ap.parse_args(argv)
    if os.path.exists(a.dst_db):sys.exit("dst exists: refusing to overwrite")
    s=sqlite3.connect(f"file:{a.src_db}?mode=ro",uri=True);d=sqlite3.connect(a.dst_db);s.backup(d);s.close();cfg=json.load(open(a.config));rep={}
    d.execute("create table pending_corporate_events(ticker,kind,entitlement_last_session,first_ex_session,new_shares_per_old,price_factor,status,used_in_series,facts,sources_json,needed_official)")
    d.execute("create table pending_event_checks(ticker,check_name,value,expected,diff_pct,consistent,note)")
    for e in cfg["corporate_events"]:
        f=1/(1+e["new_shares_per_old"]);t=e["ticker"]
        d.execute("insert into pending_corporate_events values(?,?,?,?,?,?,?,?,?,?,?)",(t,e["kind"],e["entitlement_last_session"],e["first_ex_session"],e["new_shares_per_old"],f,e["status"],e["used_in_series"],e["facts"],json.dumps(e["sources"],ensure_ascii=False),e["needed_official"]))
        px=lambda dt:d.execute("select close from canonical_bars where ticker=? and price_basis='RAW' and date=?",(t,dt)).fetchone()
        prev=d.execute("select date,close,evidence_tier from canonical_bars where ticker=? and price_basis='RAW' and date<? order by date desc limit 1",(t,e["first_ex_session"])).fetchone();ex=px(e["first_ex_session"])
        ch=ex[0]/prev[1] if prev and ex else None
        d.execute("insert into pending_event_checks values(?,?,?,?,?,?,?)",(t,"raw_close_ratio_ex_vs_prev",ch,f,None if ch is None else round((ch/f-1)*100,3),int(ch is not None and abs(ch/f-1)<0.06),f"prev {prev[0] if prev else None} ({prev[2] if prev else None}); a drop near the factor plus ordinary market move (|move|<6%)"))
        r=d.execute("select avg(y.close/m.close),min(y.close/m.close),max(y.close/m.close),count(*) from (select date,close from raw_observations where ticker=? and provider_family='yahoo' and date<? and date>=date(?,'-9 day')) y join (select date,close from raw_observations where ticker=? and provider_family='mubasher' and source_id='S1_MAIN_HISTORY' and date<? and date>=date(?,'-9 day')) m using(date)",(t,e["first_ex_session"],e["first_ex_session"],t,e["first_ex_session"],e["first_ex_session"])).fetchone()
        if r and r[3]:d.execute("insert into pending_event_checks values(?,?,?,?,?,?,?)",(t,"yahoo_over_mubasher_pre_event_ratio",r[0],f,round((r[0]/f-1)*100,3),int(abs(r[0]/f-1)<0.005),f"n={r[3]} days, min {r[1]:.5f} max {r[2]:.5f}: Yahoo history is back-adjusted by this factor, Mubasher is RAW"))
        rep[t]=d.execute("select check_name,value,expected,diff_pct,consistent from pending_event_checks where ticker=?",(t,)).fetchall()
    d.execute("create table price_limit_evidence(scope,rule,status,sources_json,needed_official)");d.execute("create table price_limit_checks(session_date,official_rows,rows_over_20pct,rows_ge_19_9pct,max_abs_chg_pct,rows_over_10pct)")
    for p in cfg["price_limits"]:d.execute("insert into price_limit_evidence values(?,?,?,?,?)",(p["scope"],p["rule"],p["status"],json.dumps(p["sources"],ensure_ascii=False),p["needed_official"]))
    for sd,n,o20,o199,mx,o10 in d.execute("select session_date,count(*),sum(abs(chg_pct)>20.05),sum(abs(chg_pct)>=19.9),max(abs(chg_pct)),sum(abs(chg_pct)>10.05) from official_session where market is null and currency='EGP' and chg_pct is not null group by 1").fetchall():
        d.execute("insert into price_limit_checks values(?,?,?,?,?,?)",(sd,n,o20,o199,mx,o10))
    rep["price_limit_checks"]=d.execute("select * from price_limit_checks").fetchall()
    d.commit();ok=d.execute("pragma integrity_check").fetchone()[0];d.close();rep["integrity"]=ok
    if a.report:json.dump(rep,open(a.report,"w"),indent=1,default=str)
    print(json.dumps(rep,default=str)[:1500])
if __name__=="__main__":main()
