#!/usr/bin/env python3
"""Remove the duplicated official_session rows of a staged DB WITHOUT deleting evidence.
Cause: sessions imported earlier by an older parser (market MAIN/SME, wrapped names merged) and the same bulletin re-staged by the bbox parser (market NULL).
Fix: copy the legacy-parse rows (market IS NOT NULL) into official_session_legacy_parse (+reason) and keep ONE active set per session.
Writes a NEW db (refuses to overwrite). Verifies: one row per (session,page,rank); legacy+active == before.
usage: dedupe_official_session.py --src-db a.sqlite --dst-db b.sqlite --report r.json"""
import argparse,json,os,sqlite3,sys
def main(argv=None):
    ap=argparse.ArgumentParser();[ap.add_argument("--"+k,required=True) for k in("src-db","dst-db","report")];a=ap.parse_args(argv)
    if os.path.exists(a.dst_db):sys.exit("dst exists: refusing to overwrite")
    s=sqlite3.connect(f"file:{a.src_db}?mode=ro",uri=True);d=sqlite3.connect(a.dst_db);s.backup(d);s.close()
    before=dict(d.execute("select session_date,count(*) from official_session group by 1").fetchall())
    d.execute("create table if not exists official_session_legacy_parse as select *,'' as archived_reason from official_session where 0")
    d.execute("insert into official_session_legacy_parse select *,'DUPLICATE_SET_OLD_PARSER_MARKET_SPLIT' from official_session where market is not null and session_date in(select session_date from official_session where market is null)")
    d.execute("delete from official_session where market is not null and session_date in(select session_date from official_session where market is null)")
    after=dict(d.execute("select session_date,count(*) from official_session group by 1").fetchall());leg=dict(d.execute("select session_date,count(*) from official_session_legacy_parse group by 1").fetchall())
    dup=d.execute("select count(*) from(select session_date,pdf_page,pdf_rank,count(*) c from official_session group by 1,2,3 having c>1)").fetchone()[0]
    assert dup==0 and all(after.get(k,0)+leg.get(k,0)==v for k,v in before.items()),"verification failed"
    legacy_only=d.execute("""select l.session_date,count(*) from official_session_legacy_parse l where l.ticker is not null and l.ticker not in(select ticker from official_session o where o.session_date=l.session_date and o.ticker is not null) group by 1""").fetchall()
    d.commit();ok=d.execute("pragma integrity_check").fetchone()[0];d.close()
    out=dict(integrity=ok,rows_before=before,rows_after=after,archived_legacy=leg,duplicates_remaining=dup,legacy_resolved_tickers_absent_from_active_set=dict(legacy_only))
    json.dump(out,open(a.report,"w"),indent=1);print(json.dumps(out))
if __name__=="__main__":main()
