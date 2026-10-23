#!/usr/bin/env python3
"""Audited, isolated import of branch archives; never writes production datasets."""
import argparse, datetime, hashlib, json, sqlite3, subprocess
from pathlib import Path

SOURCES = [
 ("v18-global-strategy-ensemble-20260906", "data/stable/v18-forward-ledger.json", "signal"),
 ("v18-global-strategy-ensemble-20260906", "preview-v18/forward-ledger.json", "signal"),
 ("v18-global-strategy-ensemble-20260906", "preview-v18/data.json", "mixed"),
 ("v19-egx-chat-gpt", "data/v19/recorded-session-replay.json", "signal"),
 ("v19-egx-chat-gpt", "data/v19/native-challenger.json", "strategy"),
 ("research/egx-meta-engine-v1-20260829", "data/v20/forward-evaluation.json", "strategy"),
 ("research/egx-meta-engine-v1-20260829", "data/v20/forward-resolution-status.json", "strategy"),
]
# Raw OHLCV files are audited separately from legacy strategy artifacts.
SOURCES.extend((branch, f"data/history/{symbol}.json", "ohlcv") for branch in
 ("v18-global-strategy-ensemble-20260906", "v19-egx-chat-gpt", "research/egx-meta-engine-v1-20260829")
 for symbol in ("ABUK", "COMI"))
MAX_BYTES=8_000_000

def classify(obj):
    if not isinstance(obj,dict): return "NON_OBJECT"
    sessions=obj.get("sessions")
    if isinstance(sessions,list):
        if sessions and all(isinstance(r,dict) and all(k in r for k in ("date","high","low","close","volume")) for r in sessions):
            return "CANDIDATE_OHLCV_REQUIRES_AUDIT" if obj.get("ticker") or all(r.get("ticker") for r in sessions) else "SESSIONS_MISSING_SYMBOL"
        return "SESSIONS_NOT_CANDLE_SERIES"
    if isinstance(obj.get("records"),list): return "RECORDS_REQUIRE_SCHEMA_INSPECTION"
    return "NON_PRICE_EVIDENCE"

def init(db):
    db.execute("CREATE TABLE IF NOT EXISTS remote_store_manifest(branch TEXT,path TEXT,role TEXT,status TEXT,classification TEXT,bytes INTEGER,sha256 TEXT,error TEXT,PRIMARY KEY(branch,path))")
    db.execute("CREATE TABLE IF NOT EXISTS remote_price_candidates(branch TEXT,path TEXT,sha256 TEXT,symbol TEXT,session TEXT,high REAL,low REAL,close REAL,volume REAL,status TEXT NOT NULL DEFAULT 'QUARANTINED_UNVERIFIED',PRIMARY KEY(branch,path,sha256,symbol,session))")

def fetch_git(branch,path):
    subprocess.run(["git","fetch","--no-tags","--depth=1","origin",branch],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,timeout=90)
    return subprocess.run(["git","show",f"FETCH_HEAD:{path}"],check=True,capture_output=True,timeout=60).stdout

def run(output,fetch=fetch_git):
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    db=sqlite3.connect(output/"branch_evidence.sqlite")
    init(db);results=[]
    for branch,path,role in SOURCES:
        record=dict(branch=branch,path=path,role=role,status="FETCH_FAILED",classification="NOT_AVAILABLE",candidates=0)
        try:
            raw=fetch(branch,path)
            if len(raw)>MAX_BYTES: raise ValueError("FILE_OVER_8MB")
            obj=json.loads(raw.decode("utf-8"))
            digest=hashlib.sha256(raw).hexdigest();kind=classify(obj)
            record.update(status="FETCHED",classification=kind,bytes=len(raw),sha256=digest)
            if kind=="CANDIDATE_OHLCV_REQUIRES_AUDIT":
                for row in obj["sessions"]:
                    symbol=str(row.get("ticker") or obj.get("ticker") or "").strip().upper()
                    day=datetime.date.fromisoformat(str(row["date"])[:10]).isoformat()
                    h,l,c,v=[float(row[k]) for k in ("high","low","close","volume")]
                    if not symbol or min(h,l,c,v)<=0 or h<max(l,c) or l>c: continue
                    db.execute("INSERT OR IGNORE INTO remote_price_candidates(branch,path,sha256,symbol,session,high,low,close,volume) VALUES(?,?,?,?,?,?,?,?,?)",(branch,path,digest,symbol,day,h,l,c,v))
                    record["candidates"]+=1
        except Exception as e:
            record["error"]=str(e)[:240]
        db.execute("INSERT OR REPLACE INTO remote_store_manifest VALUES(?,?,?,?,?,?,?,?)",(branch,path,role,record["status"],record["classification"],record.get("bytes"),record.get("sha256"),record.get("error")))
        results.append(record)
    db.commit()
    integrity=db.execute("PRAGMA integrity_check").fetchone()[0]
    count=db.execute("SELECT COUNT(*) FROM remote_price_candidates").fetchone()[0]
    db.close()
    report={"generated_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),"scope":"remote branches only","production_data_modified":False,"candidate_count_quarantined":count,"sqlite_integrity":integrity,"files":results}
    (output/"report.json").write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    if integrity!="ok": raise RuntimeError("SQLITE_INTEGRITY_FAILED")
    return report

if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--output",default="artifacts/egx-central-audit");a=p.parse_args()
    print(json.dumps(run(a.output),ensure_ascii=False))
