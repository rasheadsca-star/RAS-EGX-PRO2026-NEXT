#!/usr/bin/env python3
"""Strict structural and conflict audit of quarantined EGX evidence. No promotion."""
import argparse,collections,datetime,json,math,re,sqlite3
from pathlib import Path
def audit(db,report):
    con=sqlite3.connect(f"file:{Path(db).resolve()}?mode=ro",uri=True)
    counts=collections.Counter();groups=collections.defaultdict(list);examples=[]
    today=datetime.datetime.now(datetime.timezone.utc).date()
    try:
        for row in con.execute("SELECT evidence_id,symbol,session,provider,open,high,low,close,volume,status FROM observations"):
            eid,symbol,session,provider,o,h,l,c,v,status=row
            reason=None
            try:day=datetime.date.fromisoformat(session)
            except (ValueError,TypeError):day=None
            if status!="QUARANTINED":raise ValueError("Unexpected trading promotion")
            if not re.fullmatch(r"[A-Z0-9._-]{2,12}",symbol or ""):reason="INVALID_SYMBOL"
            elif not day or day>today or day.weekday() in (4,5):reason="SESSION_REVIEW_REQUIRED"
            elif not all(isinstance(x,(int,float)) and math.isfinite(x) and x>0 for x in (o,h,l,c,v)):reason="INVALID_NUMERIC"
            elif h<max(o,l,c) or l>min(o,h,c):reason="INVALID_OHLC"
            else:
                reason="STRUCTURALLY_VALID_UNVERIFIED"
                groups[(symbol,session)].append((provider,c,eid))
            counts[reason]+=1
            if reason!="STRUCTURALLY_VALID_UNVERIFIED" and len(examples)<50:examples.append({"symbol":symbol,"session":session,"reason":reason})
    finally:con.close()
    conflicts=0;multi_source=0
    for (sym,session),items in groups.items():
        providers={x[0] for x in items}
        if len(providers)>1:
            multi_source+=1
            prices=[x[1] for x in items]
            if max(prices)/min(prices)-1>0.01:conflicts+=1
    result={"schema":"egx-evidence-quality-1","row_counts":dict(counts),"distinct_symbol_sessions":len(groups),
            "multi_source_sessions":multi_source,"multi_source_close_conflicts_gt_1pct":conflicts,
            "examples":examples,"v4a_eligible":0,"promoted_count":0,"production_modified":False,
            "warning":"Structural validity and independent provider labels are not sufficient for EGX session certification."}
    Path(report).write_text(json.dumps(result,indent=2)+"\n")
    return result
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--db",required=True);p.add_argument("--report",required=True)
    a=p.parse_args();print(json.dumps(audit(a.db,a.report)))
