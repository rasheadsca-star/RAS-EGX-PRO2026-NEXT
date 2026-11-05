#!/usr/bin/env python3
"""Build the inspectable outputs of the staged phase from a STAGED DB (read-only): per-session report, per-symbol status (last trusted date),
ranking table (+ research-only paper scenarios if a PR#198 snapshot is supplied), and static SVG charts (HLC bars + close-based MA20/MA50 - the
official 'open' is deliberately NOT drawn or used). usage: build_phase_outputs.py --db staged.sqlite --reports dir --out dir [--scenarios snapshot198.json]"""
import argparse,collections,csv,glob,html,json,os,pathlib,sqlite3,sys
import pandas as pd
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent))
from egx_decision import snapshot
SESS=["2026-10-29","2026-11-01","2026-11-02","2026-11-03","2026-11-04"]
def strict_set(db):
    from egx_decision import quality
    orig=snapshot.evaluate
    def strict(data,session=None):
        d=dict(data);b=d["bars"].copy();b["evidence_tier"]=b["evidence_tier"].replace("OFFICIAL_EGX","X");d["bars"]=b;return orig(d,session)
    snapshot.evaluate=strict
    try:s=snapshot.build(db)
    finally:snapshot.evaluate=orig
    return {r["ticker"] for r in s["ranked"]+s["watchlist"]}
def svg_chart(g,w=860,h=300):
    g=g.tail(120).reset_index(drop=True);n=len(g)
    if n<2:return ""
    lo=float(g.low.min());hi=float(g.high.max());pad=(hi-lo)*0.05 or 1;lo-=pad;hi+=pad;ph=h-80
    X=lambda i:50+i*(w-70)/(n-1);Y=lambda v:10+(hi-v)/(hi-lo)*ph
    col={"OFFICIAL_EGX":"#1a7f37","CORROBORATED_2_PROVIDERS":"#0969da","SINGLE_PROVIDER":"#6e7781"}
    p=[f'<svg viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" role="img" style="width:100%;max-width:{w}px;background:#fff">']
    for k in range(5):
        v=lo+(hi-lo)*k/4;p.append(f'<line x1="50" x2="{w-20}" y1="{Y(v):.1f}" y2="{Y(v):.1f}" stroke="#eee"/><text x="2" y="{Y(v)+4:.1f}" font-size="10" fill="#555">{v:.2f}</text>')
    vm=float(g.volume.max()) or 1
    for i,r in g.iterrows():
        c=col.get(r.evidence_tier,"#6e7781");x=X(i)
        p.append(f'<line x1="{x:.1f}" x2="{x:.1f}" y1="{Y(r.high):.1f}" y2="{Y(r.low):.1f}" stroke="{c}"/><line x1="{x:.1f}" x2="{x+3:.1f}" y1="{Y(r.close):.1f}" y2="{Y(r.close):.1f}" stroke="{c}" stroke-width="2"/>')
        bh=float(r.volume)/vm*40;p.append(f'<rect x="{x-1:.1f}" y="{h-bh-8:.1f}" width="2" height="{bh:.1f}" fill="{c}" opacity=".35"/>')
    for ma,cl in((20,"#bf3989"),(50,"#9a6700")):
        s=g.close.rolling(ma).mean();pts=" ".join(f"{X(i):.1f},{Y(v):.1f}" for i,v in s.items() if v==v)
        if pts:p.append(f'<polyline fill="none" stroke="{cl}" stroke-width="1.3" points="{pts}"/>')
    p.append(f'<text x="52" y="{h-1}" font-size="10" fill="#555">{g.date.iloc[0]} → {g.date.iloc[-1]}</text></svg>');return "".join(p)
def main(argv=None):
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k,required=True) for k in("db","reports","out")];ap.add_argument("--scenarios");a=ap.parse_args(argv)
    os.makedirs(a.out,exist_ok=True);snap=snapshot.build(a.db);strict=strict_set(a.db)
    con=sqlite3.connect(f"file:{a.db}?mode=ro",uri=True)
    q=lambda s,*x:con.execute(s,x).fetchall()
    nsym=q("select count(distinct ticker) from canonical_bars where price_basis='RAW'")[0][0]
    # --- per session
    fill=json.load(open(a.reports+"/fill_holes.json"));sr=[]
    for s in SESS:
        rp=json.load(open(a.reports+f"/stage_{s}.json"));st=rp["statuses"]
        tiers=dict(q("select evidence_tier,count(*) from canonical_bars where price_basis='RAW' and date=? group by 1",s))
        sr.append(dict(session=s,pdf_sha256=rp["pdf_sha256"],bulletin_rows=rp["rows"],egp_rows=rp["rows"]-st.get("EXCLUDED_NON_EGP",0),usd_rows_excluded=st.get("EXCLUDED_NON_EGP",0),
            official_bars_in_db=tiers.get("OFFICIAL_EGX",0),imported_new_official=st.get("RESOLVED_ALIAS_PREVCLOSE",0),already_official=st.get("ALREADY_HAS_OFFICIAL_BAR",0),
            superseded_unofficial=st.get("SUPERSEDES_UNOFFICIAL_BAR",0),excluded_no_match=st.get("QUARANTINED_NO_MATCH",0),excluded_prevclose_mismatch=st.get("QUARANTINED_ALIAS_PREVCLOSE_MISMATCH",0),
            excluded_price_bounds=st.get("QUARANTINED_PRICE_BOUNDS",0),proposals_pending_approval=st.get("PROPOSED_FUZZY_NEEDS_APPROVAL",0),
            symbols_with_bar_total=sum(tiers.values()),symbols_missing_bar=nsym-sum(tiers.values()),tier_mix=tiers,
            holefill=fill["by_date"].get(s,{}),open_conflicts_on_date=q("select count(*) from conflicts where date=? and resolution='OPEN'",s)[0][0],
            open_outside_range_recorded=q("select count(*) from field_definition_issues where date=?",s)[0][0],events=[e["kind"]+":"+(e.get("name") or "") for e in rp["events"]],
            official_vs_existing_close_disagreements_gt_0_1pct=len(rp["disagree_with_existing_bar"]),superseded_max_diff_pct=max([x[4] for x in rp["superseded"]],default=0)))
    json.dump(dict(registry_symbols=243,symbols_with_any_bar=nsym,hole_fill=fill["summary"],sessions=sr),open(a.out+"/session_report.json","w"),ensure_ascii=False,indent=1)
    # --- symbol status
    pend=set(t for (t,) in q("select distinct ticker from identity_review where status='LEGACY_IDENTITY_PENDING_REVIEW'")) if q("select 1 from sqlite_master where name='identity_review'") else set()
    for k in("ranked","watchlist"):
        drop=[r for r in snap[k] if r["ticker"] in pend];snap[k]=[r for r in snap[k] if r["ticker"] not in pend]
        snap["blocked"]+= [dict(ticker=r["ticker"],reasons=["IDENTITY_PENDING_REVIEW: LEGACY_IDENTITY_PENDING_REVIEW"]) for r in drop]
    for b in snap["blocked"]:
        if b["ticker"] in pend and not any(x.startswith("IDENTITY_PENDING") for x in b["reasons"]):b["reasons"]=list(b["reasons"])+["IDENTITY_PENDING_REVIEW: LEGACY_IDENTITY_PENDING_REVIEW"]
    reasons={b["ticker"]:b["reasons"] for b in snap["blocked"]};cat={r["ticker"]:"RANKED" for r in snap["ranked"]};cat.update({r["ticker"]:"WATCHLIST" for r in snap["watchlist"]})
    last={t:(d,tier) for t,d,tier in q("select b.ticker,b.date,b.evidence_tier from canonical_bars b where b.price_basis='RAW' and b.date=(select max(date) from canonical_bars where ticker=b.ticker and price_basis='RAW')")}
    lo={t:d for t,d in q("select ticker,max(date) from canonical_bars where price_basis='RAW' and evidence_tier='OFFICIAL_EGX' group by 1")}
    names={t:n for t,n in q("select ticker,name_en from symbol_identity")}
    with open(a.out+"/symbols_status.csv","w",newline="",encoding="utf-8") as f:
        w=csv.writer(f);w.writerow(["ticker","name_en","status","last_bar_date","last_bar_tier","last_official_date","first_blocking_reason","all_reasons"])
        for t in sorted(names):
            ld=last.get(t,("","")); rs=reasons.get(t,[])
            w.writerow([t,names[t],cat.get(t,"NO_BARS" if t not in last else "BLOCKED"),ld[0],ld[1],lo.get(t,""),(rs[0].split(":")[0] if rs else "")," | ".join(rs)])
    # --- ranking + charts
    sc={}
    if a.scenarios:
        s2=json.load(open(a.scenarios));sc={r["ticker"]:r.get("paper_scenarios") for r in s2["ranked"]+s2["watchlist"]}
    rows=[];bars_all=pd.read_sql("select ticker,date,close,evidence_tier from canonical_bars where price_basis='RAW' and close>0 order by ticker,date",con)
    for kind in("ranked","watchlist"):
        for i,r in enumerate(snap[kind],1):
            p=sc.get(r["ticker"]) or {};s0=(p.get("scenarios") or [None])[0]
            rows.append(dict(rank=len(rows)+1,list=kind.upper(),ticker=r["ticker"],name=r["name"],last_date=r["date"],last_close=r["last"],ma20=r["ma20"],ma50=r["ma50"],momentum20_pct=r["momentum20"],adv20_egp=r["adv20"],score=r["score"],trend=r["trend"],
                depends_on_official_open_exemption=r["ticker"] not in strict,last_bar_tier=last[r["ticker"]][1],last_official_date=lo.get(r["ticker"],""),
                stop_bar_date=(lambda g10:g10.loc[g10.close.idxmin(),"date"])(bars_all[bars_all.ticker==r["ticker"]].tail(10)),stop_bar_tier=(lambda g10:g10.loc[g10.close.idxmin(),"evidence_tier"])(bars_all[bars_all.ticker==r["ticker"]].tail(10)),
                paper_entry=s0 and s0["entry_raw"],paper_stop=s0 and s0["stop_raw"],paper_target1=s0 and s0["target1_raw"],paper_target2=s0 and s0["target2_raw"],executable=False,status="RESEARCH_ONLY_NO_STRATEGY_APPROVED"))
            # stop/targets are derived from the lowest close of the last 10 bars: unless THAT bar is official or corroborated by 2 providers the level is NOT presented as reliable
            x=rows[-1]
            if x["paper_entry"] and x["stop_bar_tier"] not in("OFFICIAL_EGX","CORROBORATED_2_PROVIDERS"):
                x.update(paper_stop_candidate_untrusted=x["paper_stop"],paper_target1_candidate_untrusted=x["paper_target1"],paper_target2_candidate_untrusted=x["paper_target2"],paper_stop=None,paper_target1=None,paper_target2=None,paper_levels_status=f"WITHHELD_STOP_BAR_{x['stop_bar_date']}_{x['stop_bar_tier']}_UNVERIFIED")
            else:x["paper_levels_status"]="STOP_BAR_VERIFIED" if x["paper_entry"] else "NO_SCENARIO"
    cols=[]
    for r_ in rows:
        for k in r_:
            if k not in cols:cols.append(k)
    for r_ in rows:
        for k in cols:r_.setdefault(k,None)
    if rows:
        with open(a.out+"/ranking.csv","w",newline="",encoding="utf-8") as f:
            w=csv.DictWriter(f,fieldnames=cols);w.writeheader();w.writerows(rows)
    json.dump(rows,open(a.out+"/ranking.json","w"),ensure_ascii=False,indent=1)
    bars=pd.read_sql("select ticker,date,open,high,low,close,volume,evidence_tier from canonical_bars where price_basis='RAW' and close>0 order by ticker,date",con)
    H=['<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>EGX PRO — staged charts 2026-11-04</title><body style="font-family:system-ui;margin:16px;max-width:900px"><h1>الشارتات من القاعدة المرحلية (بحث فقط)</h1><p>أعمدة High–Low مع علامة الإغلاق؛ <b>سعر الفتح الرسمي غير مستخدم</b> (تعريفه غير مؤكد). MA20 (وردي) وMA50 (بني) من الإغلاق. اللون = مستوى الدليل: أخضر رسمي، أزرق مؤكد من مزودين، رمادي مزود واحد. المسافات الفارغة = جلسات بلا شمعة موثوقة. <b>NO_STRATEGY_APPROVED</b> — لا توصية تداول.</p>']
    for r in rows:
        g=bars[bars.ticker==r["ticker"]]
        H.append(f'<h2>{html.escape(r["ticker"])} — {html.escape(r["name"])} <small>({r["list"]})</small></h2><p>آخر شمعة موثوقة: <b>{r["last_date"]}</b> ({r["last_bar_tier"]}) · آخر شمعة رسمية: {r["last_official_date"] or "—"} · إغلاق {r["last_close"]} · MA20 {r["ma20"]} · MA50 {r["ma50"]}'+(" · <b>يعتمد تأهله على استثناء فتح الرسمي</b>" if r["depends_on_official_open_exemption"] else "")+((f' · سيناريو ورقي غير تنفيذي: دخول {r["paper_entry"]} / وقف {r["paper_stop"]} / هدف1 {r["paper_target1"]}' if r["paper_stop"] else f' · مستوى الوقف والأهداف محجوب: شمعة الوقف ({r["stop_bar_date"]}) غير مثبتة ({r["stop_bar_tier"]})') if r["paper_entry"] else "")+"</p>"+svg_chart(g))
    open(a.out+"/charts.html","w",encoding="utf-8").write("".join(H)+"</body>")
    print(json.dumps(dict(qualified=len(rows),ranked=len(snap["ranked"]),watchlist=len(snap["watchlist"]),blocked=len(snap["blocked"]),content_sha256=snap["content_sha256"])))
if __name__=="__main__":main()
