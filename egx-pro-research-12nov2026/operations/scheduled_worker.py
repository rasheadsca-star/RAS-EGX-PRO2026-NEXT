"""Cairo-local scheduled EGX official PDF ingestion into the same SQLite database.

Default: disabled until authoritative source URL is configured and verified.
When enabled: Sunday-Thursday 19:00 Africa/Cairo; failures are quarantined,
logged and never cause recommendation publication.
"""
from datetime import datetime, timedelta, time as day_time
import json
import logging
import os
from pathlib import Path
import sys
import time
from zoneinfo import ZoneInfo
from ingest_cli import run as ingest_local
from fetch_official import fetch

TZ = ZoneInfo("Africa/Cairo")
LOG = logging.getLogger("egx.scheduler")
logging.basicConfig(level=logging.INFO,format="%(asctime)s %(levelname)s %(message)s")

def run_once(*, source_file=None, url=None, storage=None):
    storage = Path(storage or os.environ.get("EGX_DATA_DIR", ""))
    if not storage or str(storage) in (".", ""):
        raise ValueError("PERSISTENT_EGX_DATA_DIR_REQUIRED")
    storage.mkdir(parents=True,exist_ok=True)
    if source_file is not None:
        pdf = Path(source_file)
        if not pdf.is_file(): raise FileNotFoundError(pdf)
        mode="local-fixture"
    else:
        if not url: raise ValueError("OFFICIAL_EGX_SOURCE_URL_NOT_CONFIGURED")
        pdf = storage / "incoming" / "official-latest.pdf"
        fetch(url, pdf)  # validates signature, date, pages, and main table
        mode="automatic-http-fetch"
    result = ingest_local(pdf,storage) # exactly same ingestion function as HTTP operator path
    return {"session":result.get("session"),"sha":result["sha"],"state":result["state"],
            "mode":mode,"published":False,"certified":False,
            "duplicate":bool(result.get("duplicate"))}

def next_schedule(now):
    local=now.astimezone(TZ)
    for days in range(8):
        cand_date=local.date()+timedelta(days=days)
        if cand_date.weekday() not in (6,0,1,2,3): # Sun-Thu EGX schedule
            continue
        cand=datetime.combine(cand_date,day_time(19,0),tzinfo=TZ)
        if cand>local:
            return cand
    raise RuntimeError("SCHEDULE_NOT_FOUND")

def main(argv=None):
    import argparse
    p=argparse.ArgumentParser()
    p.add_argument("--once",action="store_true")
    p.add_argument("--file",help="real local PDF for staging integration tests, no network")
    args=p.parse_args(argv)
    folder=os.environ.get("EGX_DATA_DIR")
    if not folder: raise SystemExit("EGX_DATA_DIR_REQUIRED")
    if args.once:
        result=run_once(source_file=args.file,url=None if args.file else os.environ.get("EGX_OFFICIAL_REPORT_URL"),storage=folder)
        print(json.dumps(result),flush=True)
        return
    LOG.info("EGX scheduler started; published signals always disabled")
    last=None
    while True:
        now=datetime.now(TZ)
        if os.environ.get("EGX_FETCH_ENABLED","false").lower() not in ("1","true","yes"):
            time.sleep(60)
            continue
        scheduled=next_schedule(now-timedelta(seconds=60))
        key=scheduled.date().isoformat()
        if abs((now-scheduled).total_seconds())<65 and key!=last:
            last=key
            try:
                result=run_once(url=os.environ.get("EGX_OFFICIAL_REPORT_URL"),storage=folder)
                LOG.info("EGX staged result=%s",json.dumps(result))
            except Exception as exc:
                LOG.error("EGX fetch staging failed (no publications): %s",str(exc)[:400])
        time.sleep(25)

if __name__=="__main__":
    main()
