#!/usr/bin/env python3
"""G07/main/V17 raw-history research merge. Fails closed on contested prices."""
import csv, gzip, hashlib, json, sqlite3, sys
from pathlib import Path
from collections import defaultdict
from datetime import date

def valid(r):
 try:
  day=str(r["date"]);date.fromisoformat(day)
  o,h,l,c,v=(float(r[k]) for k in ("open","high","low","close","volume"))
  return l>0 and v>=0 and l<=min(o,c) and h>=max(o,c) and day[:4].isdigit()
 except (ValueError,TypeError,KeyError,OverflowError):return False

def run(main_dir,ledger_dir,out_dir):
 main_dir,ledger_dir,out_dir=map(Path,(main_dir,ledger_dir,out_dir));out_dir.mkdir(parents=True,exist_ok=True)
 quality=json.loads((ledger_dir/"raw-long-history-quality.json").read_text())
 eligible={x["ticker"] for x in quality["stocks"] if x.get("researchHistoryCandidate") is True}
 db=out_dir/"egx_merged_research.sqlite"
 if db.exists():db.unlink()
 con=sqlite3.connect(db)
 con.executescript("""
 CREATE TABLE source_bars(ticker TEXT NOT NULL,date TEXT NOT NULL,source TEXT NOT NULL,open REAL,high REAL,low REAL,close REAL,volume REAL,source_sha256 TEXT,PRIMARY KEY(ticker,date,source));
 CREATE TABLE accepted_research(ticker TEXT NOT NULL,date TEXT NOT NULL,open REAL,high REAL,low REAL,close REAL,volume REAL,sources TEXT NOT NULL,official_verified INTEGER NOT NULL DEFAULT 0,trade_eligible INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(ticker,date));
 CREATE TABLE conflicts(ticker TEXT,date TEXT,reason TEXT,sources TEXT,detail TEXT);
 CREATE TABLE sources(name TEXT PRIMARY KEY, description TEXT,license_status TEXT);
 """)
 con.execute("INSERT INTO sources VALUES(?,?,?)",("main_history","Current main data/history stock JSON","unconfirmed"))
 con.execute("INSERT INTO sources VALUES(?,?,?)",("v17_raw_research","Archived Yahoo 10-year series; structural candidates only; corporate actions uncertified","unconfirmed"))
 stats=defaultdict(int);cand=defaultdict(list)
 def take(ticker,r,source,sha):
  if not valid(r):
   stats[source+"_invalid"]+=1;return
  day=r["date"]; vals=[float(r[k]) for k in ("open","high","low","close","volume")]
  try:
   con.execute("INSERT INTO source_bars VALUES (?,?,?,?,?,?,?,?,?)",(ticker,day,source,*vals,sha))
   cand[ticker,day].append((source,vals))
   stats[source+"_valid"]+=1
  except sqlite3.IntegrityError:
   stats[source+"_duplicate"]+=1
 for p in sorted(main_dir.glob("*.json")):
  try:
   raw=p.read_bytes();doc=json.loads(raw);ticker=str(doc.get("ticker","")).upper()
   if ticker!=p.stem.upper() or not isinstance(doc.get("sessions"),list):continue
   sha=hashlib.sha256(raw).hexdigest()
   for r in doc["sessions"]:take(ticker,r,"main_history",sha)
  except (ValueError,OSError) as e:stats["main_errors"]+=1
 for ticker in sorted(eligible):
  p=ledger_dir/"raw-long-history-gzip"/(ticker+".json.gz")
  if not p.exists():stats["v17_missing_files"]+=1;continue
  try:
   raw=p.read_bytes();doc=json.loads(gzip.decompress(raw));sha=hashlib.sha256(raw).hexdigest()
   if doc.get("ticker")!=ticker or doc.get("source")!="YAHOO_CHART_API" or doc.get("dataQualityStatus")!="VALID" or doc.get("symbolIdentity",{}).get("verified") is not True:
    stats["v17_rejected_identity"]+=1;continue
   for r in doc.get("sessions",[]):take(ticker,r,"v17_raw_research",sha)
  except (OSError,ValueError,EOFError):stats["v17_unreadable"]+=1
 for (ticker,day),rows in sorted(cand.items()):
  variants={tuple(x[1]) for x in rows}
  if len(variants)>1:
   con.execute("INSERT INTO conflicts VALUES (?,?,?,?,?)",(ticker,day,"PRICE_CONFLICT",",".join(x[0] for x in rows),json.dumps(rows)))
   stats["conflict_sessions"]+=1;continue
  vals=rows[0][1]
  con.execute("INSERT INTO accepted_research VALUES (?,?,?,?,?,?,?,?,0,0)",(ticker,day,*vals,",".join(x[0] for x in rows)))
  stats["research_sessions"]+=1
 coverage=con.execute("SELECT ticker,COUNT(*),MIN(date),MAX(date) FROM accepted_research GROUP BY ticker ORDER BY ticker").fetchall()
 with (out_dir/"coverage.csv").open("w",newline="",encoding="utf-8-sig") as f:
  w=csv.writer(f);w.writerow(["ticker","distinct_sessions","first","last","20","50","100","200"])
  for t,n,first,last in coverage:w.writerow([t,n,first,last,*[int(n>=k) for k in (20,50,100,200)]])
 stats["symbols"]=len(coverage);stats["symbols_over_200"]=sum(n>=200 for _,n,_,_ in coverage)
 stats["trade_eligible"]=0
 (out_dir/"summary.json").write_text(json.dumps({"stats":dict(stats),"eligible_v17_symbols":len(eligible),"source":"main data/history + egx-research-ledger V17 candidate gz","mode":"RESEARCH_ONLY","production_ready":False},indent=2))
 con.commit();integrity=con.execute("PRAGMA integrity_check").fetchone()[0];con.close()
 if integrity!="ok":raise RuntimeError(integrity)
 print(json.dumps(dict(stats),indent=2))
 return dict(stats)
if __name__=="__main__":
 if len(sys.argv)!=4:raise SystemExit("usage: merge.py MAIN_HISTORY LEDGER OUTPUT_DIR")
 run(*sys.argv[1:])
