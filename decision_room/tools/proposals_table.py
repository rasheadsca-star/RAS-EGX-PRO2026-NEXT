#!/usr/bin/env python3
"""Aggregate fuzzy name proposals from stage_official reports into a review table (NOTHING is applied). Confidence rule (documented, simple):
HIGH  = name similarity >= 0.85 AND |prev-close diff| <= 0.6% AND consistent in >=2 sessions AND (if an independent public close exists) it agrees within 0.5%
MEDIUM= similarity >= 0.80 OR (>=2 consistent sessions) ; LOW = otherwise.  CONFLICT = same name -> different tickers, or ticker claimed by >1 names.
usage: proposals_table.py --reports dir --mainhist dir --out-prefix path"""
import argparse,collections,csv,glob,json,os,re
def main():
    ap=argparse.ArgumentParser();ap.add_argument("--reports");ap.add_argument("--mainhist");ap.add_argument("--out-prefix");a=ap.parse_args()
    agg=collections.defaultdict(list)
    for f in sorted(glob.glob(a.reports+"/stage_*.json")):
        r=json.load(open(f))
        for p in r["proposals"]:
            page,rank,name,tk,ev=p;m=re.search(r"sim=([\d.]+);prev_diff=([\d.]+)",ev)
            agg[(name,tk)].append(dict(session=r["session"],page=page,rank=rank,sim=float(m[1]),prev=float(m[2])))
    byname=collections.defaultdict(set);bytk=collections.defaultdict(set)
    for (n,t) in agg:byname[n].add(t);bytk[t].add(n)
    offc=json.load(open(a.reports+"/official_closes.json")) if os.path.exists(a.reports+"/official_closes.json") else {}
    rows=[]
    for (n,t),v in sorted(agg.items()):
        sims=[x["sim"] for x in v];prevs=[x["prev"] for x in v];ns=len({x["session"] for x in v})
        pub=None
        try:
            h=json.load(open(f"{a.mainhist}/{t}.json"));ms={s["date"]:s["close"] for s in h["sessions"]}
            hits=[(x["session"],abs(ms[x["session"]]/offc[x["session"]][f'{x["page"]}:{x["rank"]}']-1)) for x in v if x["session"] in ms and offc.get(x["session"],{}).get(f'{x["page"]}:{x["rank"]}')]
            pub=max((d for _,d in hits),default=None) if hits else None
        except Exception:pass
        conf="LOW"
        if len(byname[n])>1 or len(bytk[t])>1:conf="CONFLICT"
        elif min(sims)>=0.85 and max(prevs)<=0.006 and ns>=2 and (pub is None or pub<=0.005):conf="HIGH"
        elif min(sims)>=0.80 or ns>=2:conf="MEDIUM"
        rows.append(dict(name_in_bulletin=n,proposed_ticker=t,confidence=conf,sessions=ns,min_sim=round(min(sims),2),max_prev_close_diff_pct=round(max(prevs)*100,3),max_diff_vs_public_close_pct=None if pub is None else round(pub*100,2),applied="NO — owner approval required"))
    w=csv.DictWriter(open(a.out_prefix+".csv","w",newline="",encoding="utf-8"),fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
    md="| الاسم في النشرة | الرمز المقترح | الثقة | جلسات | أدنى تشابه | فرق الإغلاق السابق % | فرق عن إغلاق عام % | مُطبَّق |\n|---|---|---|---|---|---|---|---|\n"+"\n".join(f"| {r['name_in_bulletin']} | {r['proposed_ticker']} | {r['confidence']} | {r['sessions']} | {r['min_sim']} | {r['max_prev_close_diff_pct']} | {r['max_diff_vs_public_close_pct']} | لا |" for r in rows)
    open(a.out_prefix+".md","w").write(md);print(collections.Counter(r["confidence"] for r in rows),len(rows))
if __name__=="__main__":main()
