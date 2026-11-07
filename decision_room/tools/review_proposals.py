#!/usr/bin/env python3
"""Per-proposal evidence review of fuzzy name matches (NOTHING applied). For every (bulletin name -> ticker) and every session:
implied previous close = close/(1+chg%) vs the ticker's last RAW close before the session (abs EGP, %, tier of that prior bar);
rivals = OTHER EGP tickers whose previous close is within 0.7% of the implied one (price coincidence risk); name similarity to symbol_identity; public close check;
corporate events touching the ticker. Recommendation = RECOMMEND_APPROVE only if ALL: sim>=0.85 (or HIGH conf), every session diff <= max(0.01 EGP,0.15%), no rival with sim>=0.6
  OR diff<=0.15% when rival exists is NOT enough (rival => HOLD), public close within 0.5% when available, no corporate event. Otherwise HOLD with reasons. Final approval stays with the owner.
usage: review_proposals.py --db staged.sqlite --reports dir --proposals match_proposals.csv --out-prefix path"""
import argparse,csv,glob,json,pathlib,sqlite3,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
import official_map as om
def main(argv=None):
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k.replace("_","-"),required=True) for k in("db","reports","proposals","out_prefix")];a=ap.parse_args(argv)
    con=sqlite3.connect(f"file:{a.db}?mode=ro",uri=True);ident={t:(en,cu) for t,en,cu in con.execute("select ticker,name_en,currency from symbol_identity") if en}
    conf={(r["name_in_bulletin"],r["proposed_ticker"]):r for r in csv.DictReader(open(a.proposals,encoding="utf-8"))}
    ev={};[ev.setdefault(t,[]).append(s) for s,t in con.execute("select session,ticker from official_corporate_events where ticker is not null")]
    per={}
    for f in sorted(glob.glob(a.reports+"/stage_*.json")):
        r=json.load(open(f));ses=r["session"]
        for page,rank,name,tk,_ in r["proposals"]:
            o=con.execute("select close,chg_pct from official_session where session_date=? and pdf_page=? and pdf_rank=? and market is null",(ses,page,rank)).fetchone()
            if not o or o[1] is None:continue
            implied=o[0]/(1+o[1]/100);pc=om.prev_closes(con,ses);pv=pc.get(tk)
            tier=con.execute("select evidence_tier from canonical_bars where ticker=? and price_basis='RAW' and date<? order by date desc limit 1",(tk,ses)).fetchone()
            riv=sorted(((round(om.sim(name,en),2),t2) for t2,(en,cu) in ident.items() if t2!=tk and cu=="EGP" and t2 in pc and abs(implied/pc[t2]-1)<=0.007 and om.sim(name,en)>=0.6),reverse=True)[:3]
            per.setdefault((name,tk),[]).append(dict(session=ses,implied=round(implied,4),prev=pv,abs=None if pv is None else round(abs(implied-pv),4),rel=None if pv is None else round(abs(implied/pv-1)*100,3),tier=tier[0] if tier else None,rivals=riv))
    rows=[]
    for (name,tk),ss in sorted(per.items(),key=lambda kv:kv[0][1]):
        c=conf.get((name,tk),{});why=[];sim=om.sim(name,ident[tk][0]) if tk in ident else 0
        worst=max((s["rel"] for s in ss if s["rel"] is not None),default=None);big=[s for s in ss if s["rel"] is not None and s["abs"]>max(0.01,0.0015*s["prev"])]
        if sim<0.85:why.append(f"name_sim={sim:.2f}<0.85")
        if big:why.append("prev-close gap not rounding-explainable: "+", ".join(f"{s['session']} {s['rel']}%({s['abs']} EGP, prior bar {s['tier']})" for s in big))
        if any(s["rivals"] for s in ss):why.append("price-coincidence rival(s): "+"; ".join(f"{s['session']}:{s['rivals']}" for s in ss if s["rivals"]))
        pub=c.get("max_diff_vs_public_close_pct")
        if pub not in(None,"") and float(pub)>0.5:why.append(f"public close differs {pub}%")
        if pub in(None,""):why.append("no independent public close to compare")
        if tk in ev:why.append(f"corporate event(s) {ev[tk]}")
        if c.get("confidence")=="CONFLICT":why.append("CONFLICT: name/ticker claimed more than once")
        hard=[w for w in why if not w.startswith("no independent")]
        rows.append(dict(bulletin_name=name,proposed_ticker=tk,registry_name=ident.get(tk,("",))[0],tool_confidence=c.get("confidence"),sessions=len(ss),name_sim=round(sim,2),worst_prev_gap_pct=worst,prior_bar_tiers="/".join(sorted({str(s['tier']) for s in ss})),public_close_diff_pct=pub,recommendation="HOLD" if hard else "RECOMMEND_APPROVE",reasons=" | ".join(why) or "all checks passed",applied="NO — owner approval required"))
    w=csv.DictWriter(open(a.out_prefix+".csv","w",newline="",encoding="utf-8"),fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
    md="| الرمز | الاسم في النشرة | الاسم في السجل | ثقة الأداة | تشابه | أسوأ فرق إغلاق سابق % | التوصية | الأسباب |\n|---|---|---|---|---|---|---|---|\n"+"\n".join(f"| {r['proposed_ticker']} | {r['bulletin_name']} | {r['registry_name']} | {r['tool_confidence']} | {r['name_sim']} | {r['worst_prev_gap_pct']} | {r['recommendation']} | {r['reasons']} |" for r in rows)
    open(a.out_prefix+".md","w",encoding="utf-8").write(md)
    from collections import Counter;print(Counter((r["tool_confidence"],r["recommendation"]) for r in rows))
if __name__=="__main__":main()
