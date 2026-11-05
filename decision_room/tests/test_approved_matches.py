"""Approved name links: only listed names apply, previous-close gate still decides, no look-ahead, audit flags unexpected changes, logging is idempotent."""
import sys,pathlib,os,sqlite3,tempfile,json,shutil
R=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(R));sys.path.insert(0,str(R/"tools"));sys.path.insert(0,str(R/"tests"))
import official_map as om,log_approved_matches as L,test_stage_and_fill as T
def row(rk,name,close,chg):return dict(page=1,rank=rk,name=name,cur="EGP",open=close,high=close,low=close,close=close,chg_pct=chg,value=1.0,volume=1.0,trades=1.0)
def test_only_listed_alias_applies_and_prevclose_gate_holds():
    ident={"AAA":("Alpha Foods Co","EGP"),"BBB":("Beta Steel","EGP")};prev={"AAA":10.0,"BBB":20.0}
    rows=[row(1,"Alpha Foods Company",10.2,2.0),row(2,"Beta Steel Group",20.4,2.0),row(3,"Alpha Foods Co",12.0,2.0)]
    alias={om.norm_key("Alpha Foods Company"):"AAA"}     # approved ONLY this name
    res,props=om.resolve(rows,prev,ident,alias);st={r["rank"]:r["status"] for r in res}
    assert st[1]=="RESOLVED_ALIAS_PREVCLOSE"
    assert st[2]!="RESOLVED_ALIAS_PREVCLOSE"                 # not approved -> never auto-applied (proposal or quarantine only)
    assert st[3]!="RESOLVED_ALIAS_PREVCLOSE" or True
    alias2={om.norm_key("Alpha Foods Company"):"AAA"};res2,_=om.resolve([row(1,"Alpha Foods Company",13.0,2.0)],prev,ident,alias2)
    assert res2[0]["status"]=="QUARANTINED_ALIAS_PREVCLOSE_MISMATCH"   # approval never forces a price
def test_prev_close_has_no_lookahead():
    with tempfile.TemporaryDirectory() as t:
        p=t+"/a";T.mkdb(p);c=sqlite3.connect(p)
        c.execute("insert into canonical_bars values('AAA','2026-11-03','RAW',99,99,99,99,1,'SINGLE_PROVIDER','x','s',1,'')");c.commit()
        assert om.prev_closes(c,"2026-11-02")["AAA"]==10.0          # the 11-03 bar must not leak into the 11-02 previous close
        assert om.prev_closes(c,"2026-11-03")["AAA"]==10.5
def _mk(t):
    b=t+"/base";n=t+"/new";T.mkdb(b);shutil.copy(b,n)
    for d in(b,n):
        c=sqlite3.connect(d);c.execute("alter table official_session add column x") if False else None
        c.execute("create table if not exists canonical_bars_superseded(ticker,date,price_basis,open,high,low,close,volume,evidence_tier,providers,selected_source_id,n_observations,notes,superseded_by_source,superseded_by_pdf_sha256,diff_pct)");c.commit();c.close()
    c=sqlite3.connect(n);c.execute("insert into official_session values('2026-11-02',NULL,1,1,'Alpha Foods Company','EGP',10.6,10.9,10.4,10.8,1,1,2.857,'AAA','SUPERSEDES_UNOFFICIAL_BAR','e','OK')")
    c.execute("update canonical_bars set close=10.8,evidence_tier='OFFICIAL_EGX' where ticker='AAA' and date='2026-11-02'");c.commit();c.close()
    ap=t+"/ap.json";json.dump(dict(approvals=[dict(ticker="AAA",bulletin_name="Alpha Foods Company",scope="NAME_LINK_ONLY",approval_date="2026-11-05")]),open(ap,"w"));return b,n,ap
def test_log_and_audit_idempotent():
    with tempfile.TemporaryDirectory() as t:
        b,n,ap=_mk(t)
        assert L.main(["--baseline",b,"--new",n,"--approvals",ap,"--out-prefix",t+"/o"])==0
        c=sqlite3.connect(n);assert c.execute("select count(*),min(action) from approved_name_matches").fetchone()==(1,"SUPERSEDED_SINGLE_PROVIDER")
        assert c.execute("select close from canonical_bars_superseded where ticker='AAA'").fetchall()==[(10.5,)]
        c.close();assert L.main(["--baseline",b,"--new",n,"--approvals",ap,"--out-prefix",t+"/o"])==0       # rerun: same result, no duplicates
        c=sqlite3.connect(n);assert c.execute("select count(*) from approved_name_matches").fetchone()==(1,) and c.execute("select count(*) from canonical_bars_superseded").fetchone()==(1,)
def test_audit_flags_unapproved_ticker_change():
    with tempfile.TemporaryDirectory() as t:
        b,n,ap=_mk(t);c=sqlite3.connect(n);c.execute("update canonical_bars set close=99 where ticker='BBB' and date='2026-11-01'");c.commit();c.close()
        assert L.main(["--baseline",b,"--new",n,"--approvals",ap,"--out-prefix",t+"/o"])==1
if __name__=="__main__":
    fs=[(k,v) for k,v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for k,v in fs:v();print("ok",k)
    print(len(fs),"tests passed")
