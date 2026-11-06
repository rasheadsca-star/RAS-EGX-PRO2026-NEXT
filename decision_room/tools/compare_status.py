#!/usr/bin/env python3
"""Before/after comparison of two build_phase_outputs result dirs: qualified counts, per-stock status changes with reason and the evidence-tier mix of the last 60 bars.
usage: compare_status.py --before dirB --after dirA --db-after after.sqlite --out-prefix p"""
import argparse,csv,json,sqlite3
def main(argv=None):
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k.replace("_","-"),required=True) for k in("before","after","db_after","out_prefix")];a=ap.parse_args(argv)
    ld=lambda d:{r["ticker"]:r for r in csv.DictReader(open(d+"/symbols_status.csv",encoding="utf-8"))}
    rk=lambda d:{r["ticker"]:r for r in json.load(open(d+"/ranking.json"))}
    sb,sa,rb,ra=ld(a.before),ld(a.after),rk(a.before),rk(a.after);con=sqlite3.connect(f"file:{a.db_after}?mode=ro",uri=True)
    st=lambda t,s,r:("RANKED" if r.get(t,{}).get("list")=="RANKED" else "WATCHLIST" if t in r else "BLOCKED")
    rows=[]
    for t in sorted(set(sb)|set(sa)):
        b,x=st(t,sb,rb),st(t,sa,ra)
        if b==x and sb.get(t,{}).get("first_blocking_reason")==sa.get(t,{}).get("first_blocking_reason"):continue
        tiers=dict(con.execute("select evidence_tier,count(*) from (select evidence_tier from canonical_bars where ticker=? and price_basis='RAW' order by date desc limit 60) group by 1",(t,)).fetchall())
        rows.append(dict(ticker=t,before=b,after=x,reason_before=sb.get(t,{}).get("all_reasons"),reason_after=sa.get(t,{}).get("all_reasons"),last_bar_tier_after=sa.get(t,{}).get("last_bar_tier"),last_official_date_after=sa.get(t,{}).get("last_official_date"),last60_tiers_after=json.dumps(tiers),became_qualified=b=="BLOCKED" and x!="BLOCKED",lost_qualification=b!="BLOCKED" and x=="BLOCKED"))
    q=lambda r:len(r);summ=dict(qualified_before=q(rb),qualified_after=q(ra),ranked_before=sum(1 for v in rb.values() if v["list"]=="RANKED"),ranked_after=sum(1 for v in ra.values() if v["list"]=="RANKED"),tickers_changed=len(rows),newly_qualified=[r["ticker"] for r in rows if r["became_qualified"]],lost=[r["ticker"] for r in rows if r["lost_qualification"]])
    if rows:
        w=csv.DictWriter(open(a.out_prefix+".csv","w",newline="",encoding="utf-8"),fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
    json.dump(summ,open(a.out_prefix+".json","w"),indent=1,ensure_ascii=False);print(json.dumps(summ,ensure_ascii=False))
if __name__=="__main__":main()
