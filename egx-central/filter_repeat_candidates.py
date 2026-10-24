#!/usr/bin/env python3
"""Remove unchanged OHLCV candidates before research-only ledger ingestion."""
import argparse,copy,json,sqlite3
from pathlib import Path

def filter_candidates(source, ledger, output, report):
    payload=json.loads(Path(source).read_text(encoding="utf-8"))
    if payload.get("production_written") is not False or payload.get("automatic_promotion") is not False:
        raise ValueError("unsafe incoming feed")
    known=set()
    if Path(ledger).exists():
        con=sqlite3.connect(f"file:{Path(ledger).resolve()}?mode=ro",uri=True)
        try:
            for row in con.execute("SELECT symbol,session,provider,open,high,low,close,volume,status FROM observations"):
                if row[-1]!="QUARANTINED":raise ValueError("unsafe ledger status")
                known.add(tuple(row[:-1]))
        finally:con.close()
    result=copy.deepcopy(payload)
    total=kept=0
    for stock in result.get("rows",[]):
        sym=str(stock.get("symbol","")).upper()
        for attempt in stock.get("attempts",[]):
            provider=attempt.get("source")
            unique=[]
            for bar in attempt.get("candidate",[]):
                total+=1
                key=(sym,bar.get("session"),provider,*(bar.get(x) for x in ("open","high","low","close","volume")))
                if key in known:continue
                known.add(key)
                unique.append(bar)
                kept+=1
            attempt["candidate"]=unique
    Path(output).write_text(json.dumps(result,indent=2)+"\n",encoding="utf-8")
    summary={"schema":"egx-pre-ingest-dedupe-1","candidates_seen":total,"retained":kept,
        "duplicate_unchanged_skipped":total-kept,"production_modified":False,"approved_count":0}
    Path(report).write_text(json.dumps(summary,indent=2)+"\n",encoding="utf-8")
    print(json.dumps(summary))
    return summary
if __name__=="__main__":
    p=argparse.ArgumentParser()
    for k in ("source","ledger","output","report"):p.add_argument("--"+k,required=True)
    a=p.parse_args();filter_candidates(a.source,a.ledger,a.output,a.report)
