#!/usr/bin/env python3
"""Append-only research observation ledger with provenance. No production imports."""
import argparse,csv,datetime,hashlib,json,sqlite3
from pathlib import Path

SCHEMA="""CREATE TABLE IF NOT EXISTS observations (
 evidence_id TEXT PRIMARY KEY, observed_utc TEXT NOT NULL,
 symbol TEXT NOT NULL, session TEXT NOT NULL, provider TEXT NOT NULL,
 source_url TEXT NOT NULL, response_sha256 TEXT NOT NULL,
 open REAL, high REAL, low REAL, close REAL, volume REAL,
 status TEXT NOT NULL CHECK(status='QUARANTINED'),
 source_main_commit TEXT
);
CREATE INDEX IF NOT EXISTS ix_observation_key ON observations(symbol,session,provider);
"""
def ingest(fallback,db):
    payload=json.loads(Path(fallback).read_text(encoding="utf-8"))
    if payload.get("production_written") is not False or payload.get("automatic_promotion") is not False:
        raise ValueError("unsafe source report")
    path=Path(db);path.parent.mkdir(parents=True,exist_ok=True)
    conn=sqlite3.connect(path);conn.executescript(SCHEMA)
    seen=0;inserted=0
    for row in payload.get("rows",[]):
        symbol=str(row.get("symbol","")).upper()
        for source in row.get("attempts",[]):
            provider=source.get("source");url=source.get("url");digest=source.get("body_sha256")
            if not all(isinstance(v,str) and v for v in (symbol,provider,url,digest)):continue
            for bar in source.get("candidate",[]):
                session=bar.get("session")
                try:datetime.date.fromisoformat(str(session))
                except (ValueError,TypeError):continue
                vals=[bar.get(k) for k in ("open","high","low","close","volume")]
                if not all(isinstance(v,(int,float)) and not isinstance(v,bool) and v>0 for v in vals):continue
                seen+=1
                basis=json.dumps([symbol,session,provider,url,digest,*vals],separators=(",",":"),ensure_ascii=True)
                identifier=hashlib.sha256(basis.encode()).hexdigest()
                cur=conn.execute("""INSERT OR IGNORE INTO observations
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                  (identifier,datetime.datetime.now(datetime.timezone.utc).isoformat(),symbol,session,provider,
                   url,digest,*vals,"QUARANTINED",payload.get("source_main_commit")))
                inserted+=cur.rowcount
    conn.commit()
    total=conn.execute("SELECT COUNT(*) FROM observations").fetchone()[0]
    revisions=conn.execute("""SELECT COUNT(*) FROM
      (SELECT symbol,session,provider,COUNT(*) n FROM observations
       GROUP BY symbol,session,provider HAVING n>1)""").fetchone()[0]
    conn.close()
    return {"schema":"egx-append-only-evidence-1","candidates_seen":seen,"new_evidence":inserted,
      "total_observations":total,"symbol_session_provider_revisions":revisions,
      "approved_count":0,"production_modified":False}
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--fallback",required=True);p.add_argument("--db",required=True);p.add_argument("--report",required=True);a=p.parse_args()
    report=ingest(a.fallback,a.db)
    Path(a.report).write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(report))
