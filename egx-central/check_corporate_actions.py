#!/usr/bin/env python3
"""Fail-closed corporate actions data presence/shape validator."""
import argparse,csv,datetime,json,collections,pathlib
def validate(path):
    p=pathlib.Path(path)
    if not p.exists():
        return {"status":"MISSING_SOURCE","events":0,"usable":False}
    with p.open(encoding="utf-8-sig",newline="") as f:
        reader=csv.DictReader(f)
        required={"symbol","ex_date","action_type","action_value"}
        if not required.issubset(reader.fieldnames or []):
            return {"status":"BAD_HEADERS","events":0,"usable":False}
        seen=set();bad=0;types=collections.Counter()
        for row in reader:
            try:
                sym=row["symbol"].strip().upper()
                dt=datetime.date.fromisoformat(row["ex_date"].strip())
                typ=row["action_type"].strip().lower()
                if not sym or not typ: raise ValueError("empty")
                seen.add((sym,dt.isoformat(),typ,row["action_value"].strip()))
                types[typ]+=1
            except (ValueError,TypeError,KeyError,AttributeError): bad+=1
    return {"status":"AVAILABLE" if not bad and seen else "INCOMPLETE","events":len(seen),
            "bad_rows":bad,"types":dict(types),"usable":bool(seen and not bad),
            "source":"legacy snapshot - research evidence only","approved_adjustment_count":0}
if __name__=="__main__":
    p=argparse.ArgumentParser();p.add_argument("--actions",required=True);p.add_argument("--output",required=True);a=p.parse_args()
    result=validate(a.actions);pathlib.Path(a.output).write_text(json.dumps(result,indent=2)+"\n")
    print(json.dumps(result))
