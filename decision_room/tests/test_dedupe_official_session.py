import sys,pathlib,os,sqlite3,tempfile
R=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(R/"tools"))
import dedupe_official_session as D
COLS="session_date,market,pdf_page,pdf_rank,name_en,currency,open,high,low,close,volume,value,chg_pct,ticker,resolution_status,resolution_evidence,bounds_status"
def mk(p):
    c=sqlite3.connect(p);c.execute(f"create table official_session({COLS},PRIMARY KEY(session_date,market,pdf_rank))")
    ins=lambda d,m,r,t:c.execute("insert into official_session values(?,?,1,?,'n','EGP',1,1,1,1,1,1,0,?,'s','e','OK')",(d,m,r,t))
    for r in(1,2):ins("2026-11-01",None,r,"AAA" if r==1 else None);ins("2026-11-01","MAIN",r,"AAA" if r==1 else "BBB")
    ins("2026-11-03",None,1,None);c.commit();c.close()
def test_dedupe_archives_and_keeps_one_set():
    with tempfile.TemporaryDirectory() as t:
        a=t+"/a";b=t+"/b";mk(a);D.main(["--src-db",a,"--dst-db",b,"--report",t+"/r.json"]);c=sqlite3.connect(b)
        assert c.execute("select count(*) from official_session where session_date='2026-11-01'").fetchone()==(2,)
        assert c.execute("select count(*) from official_session where market is not null").fetchone()==(0,)
        assert c.execute("select count(*),min(archived_reason) from official_session_legacy_parse").fetchone()==(2,"DUPLICATE_SET_OLD_PARSER_MARKET_SPLIT")
        assert c.execute("select count(*) from official_session where session_date='2026-11-03'").fetchone()==(1,)   # unduplicated session untouched
        src=sqlite3.connect(a);assert src.execute("select count(*) from official_session").fetchone()==(5,)         # source untouched
def test_refuses_overwrite():
    with tempfile.TemporaryDirectory() as t:
        a=t+"/a";mk(a);open(t+"/b","w").close()
        try:D.main(["--src-db",a,"--dst-db",t+"/b","--report","x"]);assert False
        except SystemExit:pass
if __name__=="__main__":
    fs=[(k,v) for k,v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for k,v in fs:v();print("ok",k)
    print(len(fs),"tests passed")
