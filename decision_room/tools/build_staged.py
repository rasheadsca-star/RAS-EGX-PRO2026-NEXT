#!/usr/bin/env python3
"""Reproducible rebuild of the STAGED central DB (never touches the base/production DB):
  base DB --(stage_chain: official bulletins, alias + prev-close)--> --(fill_holes: documented non-official sources)--> --(dedupe_official_session)--> out DB
`--approvals` = owner-approved NAME LINKS only (scope NAME_LINK_ONLY). Each entry is added to a COPY of the alias file as norm_key(bulletin_name)->ticker; the usual
previous-close check (<=0.7%) still gates every row, so an approval never forces a price. An approval is NOT an approval of a price series, an ISIN or investment eligibility.
ROLLBACK = re-run with a smaller (or no) approvals file; the pipeline is deterministic, so no-approvals reproduces the baseline byte-for-byte on canonical_bars.
usage: build_staged.py --base-db b.sqlite --alias alias.json --bulletins bulletins.json --mainhist dir --ledger fse.sqlite --workdir dir --out staged.sqlite [--approvals a.json]
bulletins.json = {"2026-10-29": "/path/x.pdf", ...}"""
import argparse,hashlib,json,os,pathlib,shutil,sqlite3,sys
HERE=pathlib.Path(__file__).resolve().parent;sys.path.insert(0,str(HERE));sys.path.insert(0,str(HERE.parent))
import official_map as om,stage_chain,fill_holes,dedupe_official_session
def sha(p):
    h=hashlib.sha256()
    with open(p,"rb") as f:
        for b in iter(lambda:f.read(1<<20),b""):h.update(b)
    return h.hexdigest()
def main(argv=None):
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k.replace("_","-"),required=True) for k in("base_db","alias","bulletins","mainhist","ledger","workdir","out")];ap.add_argument("--approvals");a=ap.parse_args(argv)
    if os.path.exists(a.out):sys.exit("out exists: refusing to overwrite")
    os.makedirs(a.workdir,exist_ok=True);al=om.load_alias(a.alias);al["aliases"]=dict(al["aliases"]);applied=[]
    if a.approvals:
        for e in json.load(open(a.approvals))["approvals"]:
            assert e.get("scope")=="NAME_LINK_ONLY" and e["ticker"] and e["bulletin_name"],"bad approval entry"
            k=om.norm_key(e["bulletin_name"])
            if al["aliases"].get(k) not in(None,e["ticker"]):sys.exit(f"approval conflicts with existing alias: {k}")
            al["aliases"][k]=e["ticker"];applied.append(dict(e,alias_key=k))
    ap_alias=os.path.join(a.workdir,"alias_run.json");om.save_alias(al,ap_alias)
    items=[f"{s}={p}" for s,p in sorted(json.load(open(a.bulletins)).items())]
    st=os.path.join(a.workdir,"1_staged.sqlite");fl=os.path.join(a.workdir,"2_filled.sqlite");rep=os.path.join(a.workdir,"reports")
    for p in(st,fl):
        if os.path.exists(p):os.remove(p)
    stage_chain.main(["--src-db",a.base_db,"--dst-db",st,"--alias",ap_alias,"--outdir",rep]+items)
    fill_holes.main(["--src-db",st,"--dst-db",fl,"--mainhist",a.mainhist,"--ledger",a.ledger,"--report",os.path.join(rep,"fill_holes.json")])
    dedupe_official_session.main(["--src-db",fl,"--dst-db",a.out,"--report",os.path.join(rep,"dedupe.json")])
    for p in(st,fl):os.remove(p)
    man=dict(base_db_sha256=sha(a.base_db),alias_sha256=sha(a.alias),alias_run_sha256=sha(ap_alias),approvals=applied,bulletins={s:sha(p) for s,p in json.load(open(a.bulletins)).items()},out_sha256=sha(a.out))
    json.dump(man,open(os.path.join(rep,"build_manifest.json"),"w"),indent=1,ensure_ascii=False);print(json.dumps({k:v for k,v in man.items() if k!="approvals"}|{"approvals":len(applied)}))
if __name__=="__main__":main()
