#!/usr/bin/env python3
"""Fail-closed preconditions for the scheduled daily job. Exit 2 with a clear list of problems; never prints secret values.
  env       --require NAME [NAME...]            all must be non-empty
  source    --src data/history --max-age-days N  newest session across files must be within N calendar days of today (stale data is never passed off as fresh)
  db        --db central.sqlite --max-age-days N  last canonical RAW session within N days of today
  deploy    --url URL --sha256 HEX                deployed preview serves the expected snapshot and the NO_STRATEGY_APPROVED banner"""
import argparse,os,sys,json,glob,sqlite3,datetime,urllib.request,urllib.error
def _age(last,today):return (today-datetime.date.fromisoformat(last)).days
def check_env(names,env=None):
    env=os.environ if env is None else env;miss=[n for n in names if not env.get(n)]
    return [f"missing required setting: {n}" for n in miss]
def check_source(src,max_age,today):
    files=sorted(glob.glob(os.path.join(src,"*.json")))
    if not files:return [f"no source files in {src}"]
    last=None;bad=0
    for f in files:
        try:
            ses=json.load(open(f,encoding="utf-8"))["sessions"];d=max(r["date"] for r in ses if isinstance(r,dict) and "date" in r)
            last=d if last is None or d>last else last
        except Exception:bad+=1
    if last is None:return ["no readable session dates in source"]
    if bad>0.1*len(files):return [f"{bad}/{len(files)} source files unreadable"]
    a=_age(last,today)
    return [f"source is STALE: newest session {last} is {a} days old (> {max_age})"] if a>max_age or a<0 else []
def check_db(db,max_age,today):
    try:
        c=sqlite3.connect(f"file:{db}?mode=ro",uri=True);last=c.execute("select max(date) from canonical_bars where price_basis='RAW'").fetchone()[0];c.close()
    except Exception as e:return [f"central DB unreadable: {type(e).__name__}"]
    if not last:return ["central DB has no RAW bars"]
    a=_age(last,today)
    return [f"central DB is STALE: last session {last} is {a} days old (> {max_age})"] if a>max_age or a<0 else []
def check_deploy(url,sha,timeout=30):
    try:
        req=urllib.request.Request(url,headers={"User-Agent":"egx-preflight"})
        with urllib.request.urlopen(req,timeout=timeout) as r:
            body=r.read().decode("utf-8","replace");code=r.status;cc=r.headers.get("Cache-Control","")
    except urllib.error.HTTPError as e:return [f"preview returned HTTP {e.code} (deployment protection? set a bypass secret)"]
    except Exception as e:return [f"preview unreachable: {type(e).__name__}"]
    p=[]
    if code!=200:p.append(f"HTTP {code}")
    if sha not in body:p.append("preview does not serve the expected snapshot hash")
    if "NO_STRATEGY_APPROVED" not in body:p.append("NO_STRATEGY_APPROVED banner missing")
    if "no-store" not in cc:p.append("Cache-Control no-store header missing")
    return p
def main(argv=None):
    ap=argparse.ArgumentParser();sub=ap.add_subparsers(dest="cmd",required=True)
    e=sub.add_parser("env");e.add_argument("--require",nargs="+",required=True)
    for n,k in(("source","--src"),("db","--db")):
        s=sub.add_parser(n);s.add_argument(k,required=True);s.add_argument("--max-age-days",type=int,default=4);s.add_argument("--today")
    d=sub.add_parser("deploy");d.add_argument("--url",required=True);d.add_argument("--sha256",required=True)
    x=ap.parse_args(argv);today=datetime.date.fromisoformat(x.today) if getattr(x,"today",None) else datetime.datetime.now(datetime.timezone.utc).date()
    probs=check_env(x.require) if x.cmd=="env" else check_source(x.src,x.max_age_days,today) if x.cmd=="source" else check_db(x.db,x.max_age_days,today) if x.cmd=="db" else check_deploy(x.url,x.sha256)
    print(json.dumps(dict(check=x.cmd,status="FAILED" if probs else "OK",problems=probs),ensure_ascii=False));return 2 if probs else 0
if __name__=="__main__":sys.exit(main())
