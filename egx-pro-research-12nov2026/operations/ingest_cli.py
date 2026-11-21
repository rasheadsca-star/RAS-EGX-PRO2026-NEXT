"""EGX PRO offline/scheduled ingestion adapter.
Both the authenticated HTTP upload and scheduled fetch call ingest_bytes().
This is an operator-only CLI requiring persistent EGX_DATA_DIR; staging only.
"""
import argparse
import json
import os
from pathlib import Path
import sys
from ingest_service import ingest_bytes

def run(path, storage_dir):
    path=Path(path)
    raw=path.read_bytes()
    result=ingest_bytes(raw, "automatic_official_fetch", storage_dir)
    return result

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("pdf",help="locally downloaded EGX official PDF, already signature checked")
    args=p.parse_args()
    storage=os.getenv("EGX_DATA_DIR")
    if not storage:
        print(json.dumps({"error":"EGX_DATA_DIR_REQUIRED","state":"BLOCKED"}),file=sys.stderr)
        sys.exit(2)
    try:
        result=run(args.pdf,storage)
        print(json.dumps({"sha":result["sha"],"session":result.get("session"),"state":result["state"],
                          "published":False,"certified":False}))
        # Quarantine is successful staging, not certification.
        if result["state"] not in ("QUARANTINED","REVIEW_REQUIRED"):
            sys.exit(2)
    except Exception as err:
        print(json.dumps({"error":str(err)[:300],"state":"STAGING_FAILED"}),file=sys.stderr)
        sys.exit(2)
