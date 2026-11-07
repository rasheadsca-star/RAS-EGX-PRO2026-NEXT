"""stage_official + fill_holes on a tiny synthetic DB (PDF parsing is monkeypatched; no real data)."""
import sys,pathlib,os,sqlite3,tempfile,json
R=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(R));sys.path.insert(0,str(R/"tools"))
import official_map as om,stage_official as S,fill_holes as F
DDL=["create table source_registry(source_id PRIMARY KEY,provider_family,description,location,snapshot_ref,file_sha256,license_status,adjusted_or_raw,interval,currency,date_timezone,independence_note)",
"create table symbol_identity(ticker,name_en,name_ar,yahoo_symbol,isin,isin_status,currency,in_main_history,in_long_history,aliases)",
"create table raw_observations(obs_id INTEGER PRIMARY KEY,ticker,date,source_id,provider_family,open,high,low,close,adj_close,volume,currency,declared_basis,valid,invalid_reason,source_path,row_ref,official_verified)",
"create table canonical_bars(ticker,date,price_basis,open,high,low,close,volume,evidence_tier,providers,selected_source_id,n_observations,notes)",
"create table conflicts(conflict_id INTEGER PRIMARY KEY,ticker,date,kind,source_a,close_a,source_b,close_b,pct_diff,resolution)",
"create table corporate_actions(ticker,date,source_id,raw_change_pct,adjusted_change_pct,status,authoritative)",
"create table official_session(session_date,market,pdf_page,pdf_rank,name_en,currency,open,high,low,close,volume,value,chg_pct,ticker,resolution_status,resolution_evidence,bounds_status)"]
def mkdb(p):
    c=sqlite3.connect(p);[c.execute(d) for d in DDL]
    for t,n in(("AAA","Alpha Foods Co"),("BBB","Beta Steel"),("CCC","Gamma Cement")):c.execute("insert into symbol_identity(ticker,name_en,currency) values(?,?,'EGP')",(t,n))
    ins=lambda t,d,cl,tier:c.execute("insert into canonical_bars values(?,?,'RAW',?,?,?,?,1000,?,'x','s',1,'')",(t,d,cl,cl*1.01,cl*0.99,cl,tier))
    ins("AAA","2026-11-01",10.0,"SINGLE_PROVIDER");ins("BBB","2026-11-01",20.0,"SINGLE_PROVIDER");ins("CCC","2026-11-01",30.0,"SINGLE_PROVIDER")
    ins("AAA","2026-11-02",10.5,"SINGLE_PROVIDER");ins("CCC","2026-11-02",31.0,"OFFICIAL_EGX")
    c.commit();c.close()
def row(rank,name,o,h,l,c,chg,cur="EGP"):return dict(page=1,rank=rank,name=name,cur=cur,open=o,high=h,low=l,close=c,chg_pct=chg,value=1.0,volume=100.0,trades=1.0)
def test_stage_supersede_archive_and_issues():
    with tempfile.TemporaryDirectory() as t:
        src=os.path.join(t,"a.sqlite");dst=os.path.join(t,"b.sqlite");mkdb(src);pdf=os.path.join(t,"x.pdf");open(pdf,"wb").write(b"%PDF")
        al=os.path.join(t,"al.json");json.dump({"aliases":{"alpha foods co":"AAA","beta steel":"BBB","gamma cement":"CCC"}},open(al,"w"))
        rows=[row(1,"Alpha Foods Co",10.6,10.9,10.4,10.8,8.0),row(2,"Beta Steel",21.0,20.9,20.1,20.4,2.0),row(3,"Gamma Cement",31,32,30,31.5,1.613),row(4,"Mystery Bond",5,5,5,5,0)]
        om.parse_pdf=lambda p:rows;om.parse_corporate_events=lambda p,s:[]
        S.main(["--src-db",src,"--dst-db",dst,"--pdf",pdf,"--session","2026-11-02","--alias",al,"--report",os.path.join(t,"r.json")])
        c=sqlite3.connect(dst);g=lambda q:c.execute(q).fetchall()
        assert g("select close,evidence_tier from canonical_bars where ticker='AAA' and date='2026-11-02'")==[(10.8,"OFFICIAL_EGX")]       # unofficial superseded
        assert g("select close from canonical_bars_superseded where ticker='AAA'")==[(10.5,)]                                              # ...but archived, not deleted
        assert g("select count(*) from raw_observations where ticker='AAA' and date='2026-11-02'")==[(1,)]
        assert g("select close from canonical_bars where ticker='CCC' and date='2026-11-02'")==[(31.0,)]                                 # existing official bar untouched
        assert g("select open,close,evidence_tier from canonical_bars where ticker='BBB' and date='2026-11-02'")==[(21.0,20.4,"OFFICIAL_EGX")]                                 # BBB: close 20.4 outside [low,high]? no -> prevclose 20.0 vs implied 20.0 ok, but open>high only; bars sane?
def test_stage_refuses_existing_dst():
    with tempfile.TemporaryDirectory() as t:
        src=os.path.join(t,"a.sqlite");mkdb(src);dst=os.path.join(t,"b.sqlite");open(dst,"w").close()
        try:S.main(["--src-db",src,"--dst-db",dst,"--pdf","x","--session","2026-11-02","--alias","x","--report","x"]);assert False
        except SystemExit:pass
def test_fill_policy():
    with tempfile.TemporaryDirectory() as t:
        src=os.path.join(t,"a.sqlite");mkdb(src);c=sqlite3.connect(src)
        import datetime
        d=datetime.date(2026,9,1)
        for i in range(60):   # calendar of 60 sessions with 50+ tickers is impossible with 3 tickers -> make CALENDAR via many dummy tickers
            pass
        c.close()
        # build a calendar with >=50 tickers per day for the last 3 dates only
        c=sqlite3.connect(src)
        for k in range(55):
            tk=f"Z{k:02d}"
            for dte in("2026-10-28","2026-10-29","2026-11-01"):
                c.execute("insert into canonical_bars values(?,?,'RAW',1,1,1,1,1000,'SINGLE_PROVIDER','x','s',1,'')",(tk,dte))
        c.commit();c.close()
        mh=os.path.join(t,"mh");os.makedirs(mh)
        sess=lambda dte,cl,p:dict(date=dte,open=cl,high=cl*1.01,low=cl*0.99,close=cl,volume=1000,currency="EGP",primarySource=p)
        json.dump(dict(ticker="AAA",sessions=[sess("2026-10-28",10.0,"mubasher"),sess("2026-10-29",10.1,"mubasher")]),open(os.path.join(mh,"AAA.json"),"w"))
        json.dump(dict(ticker="BBB",sessions=[sess("2026-10-28",20.0,"mubasher"),sess("2026-10-29",22.0,"mubasher")]),open(os.path.join(mh,"BBB.json"),"w"))
        led=os.path.join(t,"led.sqlite");l=sqlite3.connect(led);l.execute("create table observations(symbol,session,open,high,low,close,volume)")
        l.execute("insert into observations values('AAA.CA','2026-10-28',10.0,10.1,9.9,10.001,1000)")   # agrees with mubasher -> corroborated
        l.execute("insert into observations values('BBB.CA','2026-10-28',20.0,21.0,19.8,20.8,1000)")    # +4% -> conflict, unfilled
        l.commit();l.close()
        dst=os.path.join(t,"b.sqlite");F.main(["--src-db",src,"--dst-db",dst,"--mainhist",mh,"--ledger",led,"--report",os.path.join(t,"r.json"),"--window","3"])
        c=sqlite3.connect(dst);g=lambda q:c.execute(q).fetchall()
        assert g("select evidence_tier from canonical_bars where ticker='AAA' and date='2026-10-28'")==[("CORROBORATED_2_PROVIDERS",)]
        assert g("select evidence_tier from canonical_bars where ticker='AAA' and date='2026-10-29'")==[("SINGLE_PROVIDER",)]
        assert g("select count(*) from canonical_bars where ticker='BBB' and date='2026-10-28'")==[(0,)] and g("select kind from conflicts where ticker='BBB'")==[("PROVIDER_DISAGREEMENT",)]
        assert g("select close from canonical_bars where ticker='BBB' and date='2026-10-29'")==[(22.0,)]
        assert g("select close from canonical_bars where ticker='CCC' and date='2026-11-02'")==[(31.0,)]   # existing bars never replaced
if __name__=="__main__":
    fs=[(k,v) for k,v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for k,v in fs:v();print("ok",k)
    print(f"{len(fs)} tests passed")
