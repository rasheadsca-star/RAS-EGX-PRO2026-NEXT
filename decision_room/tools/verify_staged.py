#!/usr/bin/env python3
"""Pre-flight checks on a delivered staged DB (read-only): sha256 (file and, if given, the .gz), integrity_check, legacy archive count, no duplicated official_session sets,
tier counts. usage: verify_staged.py --db x.sqlite [--gz x.sqlite.gz] [--expect-legacy 458] [--out r.json]"""
import argparse,hashlib,json,sqlite3,sys
def sha(p):
    h=hashlib.sha256()
    with open(p,"rb") as f:
        for b in iter(lambda:f.read(1<<20),b""):h.update(b)
    return h.hexdigest()
def main(argv=None):
    ap=argparse.ArgumentParser();ap.add_argument("--db",required=True);ap.add_argument("--gz");ap.add_argument("--expect-legacy",type=int);ap.add_argument("--out");a=ap.parse_args(argv)
    con=sqlite3.connect(f"file:{a.db}?mode=ro",uri=True);g=lambda q:con.execute(q).fetchall()
    r=dict(sha256=sha(a.db),integrity_check=g("pragma integrity_check")[0][0],foreign_key_violations=len(g("pragma foreign_key_check")))
    if a.gz:r["gz_sha256"]=sha(a.gz)
    r["legacy_rows"]=g("select count(*) from official_session_legacy_parse")[0][0] if g("select 1 from sqlite_master where name='official_session_legacy_parse'") else None
    r["official_session_per_session"]=dict(g("select session_date,count(*) from official_session group by 1"))
    r["duplicate_page_rank"]=g("select count(*) from(select 1 from official_session group by session_date,pdf_page,pdf_rank having count(*)>1)")[0][0]
    r["markets_in_active_set"]=g("select count(distinct coalesce(market,'')) from official_session")[0][0]
    r["raw_bars"]=g("select count(*) from canonical_bars where price_basis='RAW'")[0][0];r["tiers"]=dict(g("select evidence_tier,count(*) from canonical_bars where price_basis='RAW' group by 1"))
    r["pass"]=r["integrity_check"]=="ok" and r["duplicate_page_rank"]==0 and r["markets_in_active_set"]==1 and (a.expect_legacy is None or r["legacy_rows"]==a.expect_legacy)
    if a.out:json.dump(r,open(a.out,"w"),indent=1)
    print(json.dumps(r));return 0 if r["pass"] else 1
if __name__=="__main__":sys.exit(main())
