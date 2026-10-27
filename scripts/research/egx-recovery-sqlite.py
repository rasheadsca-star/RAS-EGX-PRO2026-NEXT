#!/usr/bin/env python3
"""Research-only central EGX archive. Never an executable G11/G09 source."""
import hashlib
import json
import os
import pathlib
import sqlite3
import datetime

ROOT=pathlib.Path(os.getenv("GITHUB_WORKSPACE", os.getcwd())).resolve()
OUT=pathlib.Path(os.getenv("EGX_RECOVERY_OUT",ROOT/"artifacts/history-recovery")).resolve()
def load(p):
    with open(p,encoding="utf-8") as f:
        return json.load(f)

def valid(ticker,row,cutoff):
    try:
        date=datetime.date.fromisoformat(str(row["date"]))
        if date.isoformat()>cutoff or str(row.get("ticker",ticker)).upper()!=ticker:return None
        vals=[float(row[x]) for x in ("open","high","low","close")]
        volume=row.get("volume")
        if volume is None or not isinstance(volume,(int,float)) or volume<0 or int(volume)!=volume:return None
        op,hi,lo,cl=vals
        if min(vals)<=0 or hi<max(op,cl) or lo>min(op,cl):return None
        return [date.isoformat(),*vals,int(volume)]
    except (ValueError,TypeError,KeyError,OverflowError):
        return None

def build():
    inv=load(OUT/"inventory.json")
    ledger=load(OUT/"candidate-ledger.json")
    db=OUT/"central-history-research.sqlite"
    if db.exists():db.unlink()
    con=sqlite3.connect(db)
    try:
        con.executescript("""
        PRAGMA foreign_keys=ON;
        PRAGMA trusted_schema=OFF;
        CREATE TABLE manifest(k TEXT PRIMARY KEY,v TEXT NOT NULL);
        CREATE TABLE source_registry(id TEXT PRIMARY KEY, available INTEGER, files INTEGER, valid_rows INTEGER, note TEXT);
        CREATE TABLE securities(ticker TEXT PRIMARY KEY, main_sessions INTEGER, legacy_only INTEGER, conflict_dates INTEGER, latest_main TEXT, sources_json TEXT);
        CREATE TABLE candles(
          ticker TEXT NOT NULL,
          date TEXT NOT NULL,
          source TEXT NOT NULL,
          open REAL NOT NULL, high REAL NOT NULL, low REAL NOT NULL, close REAL NOT NULL,
          volume INTEGER NOT NULL, source_url TEXT,
          evidence_status TEXT NOT NULL,
          promotion_approved INTEGER NOT NULL DEFAULT 0 CHECK(promotion_approved=0),
          row_sha256 TEXT NOT NULL,
          PRIMARY KEY(ticker,date,source)
        );
        CREATE TABLE conflicting_dates(ticker TEXT NOT NULL,date TEXT NOT NULL,detail_json TEXT NOT NULL,PRIMARY KEY(ticker,date));
        CREATE INDEX idx_candles_date ON candles(date);
        CREATE INDEX idx_candles_source ON candles(source);
        """)
        cutoff=inv["expectedSession"]
        con.execute("INSERT INTO manifest VALUES(?,?)",("mode","RESEARCH_ONLY_NO_AUTOMATIC_PROMOTION"))
        con.execute("INSERT INTO manifest VALUES(?,?)",("expectedSession",cutoff))
        con.execute("INSERT INTO manifest VALUES(?,?)",("rules","Legacy prices never replace certified current data; validate identity/source/splits independently"))
        for x in inv["sources"]:
            con.execute("INSERT INTO source_registry VALUES(?,?,?,?,?)",(x["id"],int(bool(x["available"])),x["files"],x.get("valid",0),"READ_ONLY"))
        for x in inv["stockCoverage"]:
            con.execute("INSERT INTO securities VALUES(?,?,?,?,?,?)",(
                x["ticker"],x["mainSessionCount"],x["legacyOnlySessions"],x["conflictDates"],x["latestMain"],json.dumps(x["sourceIds"])))
        main=ROOT/"data/history"
        count_main=0
        for f in sorted(main.glob("*.json")):
            t=f.stem.upper()
            try:doc=load(f)
            except (OSError,json.JSONDecodeError):continue
            if doc.get("ticker")!=t or doc.get("exchange","EGX")!="EGX" or doc.get("currency","EGP")!="EGP":continue
            for row in doc.get("sessions",[]):
                x=valid(t,row,cutoff)
                if not x:continue
                date,op,hi,lo,cl,vol=x
                source_url=(row.get("sourceUrls") or {}).get("primary")
                fingerprint=hashlib.sha256(json.dumps([t,date,op,hi,lo,cl,vol],separators=(",",":")).encode()).hexdigest()
                con.execute("INSERT OR IGNORE INTO candles(ticker,date,source,open,high,low,close,volume,source_url,evidence_status,row_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                    (t,date,"MAIN_ARCHIVE",op,hi,lo,cl,vol,source_url,"MAIN_ARCHIVE_READ_ONLY_NOT_OFFICIAL_CERTIFICATION",fingerprint))
                count_main+=1
        count_old=0
        for row in ledger["candidates"]:
            t=row["ticker"]
            x=valid(t,row,cutoff)
            if not x:continue
            date,op,hi,lo,cl,vol=x
            fingerprint=hashlib.sha256(json.dumps([t,date,op,hi,lo,cl,vol],separators=(",",":")).encode()).hexdigest()
            con.execute("INSERT OR IGNORE INTO candles(ticker,date,source,open,high,low,close,volume,source_url,evidence_status,row_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                (t,date,"LEGACY_GAP_"+row["source"],op,hi,lo,cl,vol,row.get("sourceUrl"),row.get("reviewBucket","UNREVIEWED"),fingerprint))
            count_old+=1
        for x in ledger["conflicts"]:
            con.execute("INSERT OR IGNORE INTO conflicting_dates VALUES(?,?,?)",(x["ticker"],x["date"],json.dumps(x,ensure_ascii=False)))
        con.commit()
        integrity=con.execute("PRAGMA integrity_check").fetchone()[0]
        assert integrity=="ok",integrity
        counts={k:con.execute(q).fetchone()[0] for k,q in {
            "central_rows":"SELECT COUNT(*) FROM candles",
            "securities":"SELECT COUNT(DISTINCT ticker) FROM candles",
            "main_rows":"SELECT COUNT(*) FROM candles WHERE source='MAIN_ARCHIVE'",
            "legacy_gap_rows":"SELECT COUNT(*) FROM candles WHERE source LIKE 'LEGACY_GAP_%'",
            "conflict_dates":"SELECT COUNT(*) FROM conflicting_dates",
            "automatically_promoted":"SELECT COUNT(*) FROM candles WHERE promotion_approved!=0"}.items()}
        with open(OUT/"central-ledger-manifest.json","w",encoding="utf-8") as f:
            json.dump({"schemaVersion":"egx-independent-central-ledger-1","expectedSession":cutoff,"researchOnly":True,
                       "database":"central-history-research.sqlite","counts":counts,"integrityCheck":integrity,
                       "disclaimer":"Not a certified trading database; source conflicts and corporate actions unresolved"},f,ensure_ascii=False,indent=2)
        print("EGX_RESEARCH_CENTRAL_SQLITE",json.dumps(counts,sort_keys=True))
    finally:
        con.close()
if __name__=="__main__":build()
