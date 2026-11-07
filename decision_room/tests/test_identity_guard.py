"""MTIE/MMAT identity guard + legacy identity review table."""
import sys,pathlib,sqlite3,tempfile,json,os
R=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(R));sys.path.insert(0,str(R/"tools"));sys.path.insert(0,str(R/"tests"))
import official_map as om,identity_review as I,test_stage_and_fill as T
def row(rk,name,close,chg):return dict(page=1,rank=rk,name=name,cur="EGP",open=close,high=close,low=close,close=close,chg_pct=chg,value=1.0,volume=1.0,trades=1.0)
IDENT={"MTIE":("MM Group for Industry and International Trade","EGP"),"MMAT":("Marsa Marsa Alam For Tourism Development","EGP"),"AAA":("Alpha Foods Co","EGP")}
def test_fuzzy_never_proposes_or_applies_guarded_tickers():
    res,props=om.resolve([row(1,"MM Group For Industry And International Trade",6.5,0.0)],{"MTIE":6.5,"MMAT":4.5},IDENT,{})
    assert res[0]["status"]=="QUARANTINED_GUARDED_IDENTITY" and not props
    res,props=om.resolve([row(1,"Marsa Marsa Alam For Tourism Development GMC GROUP FOR",4.5,0.0)],{"MTIE":6.5,"MMAT":4.5},IDENT,{})
    assert res[0]["status"]=="QUARANTINED_GUARDED_IDENTITY"
def test_alias_to_guarded_ticker_needs_clear_name_margin():
    ok,_=om.resolve([row(1,"Marsa Marsa Alam For Tourism Development",4.6,2.0)],{"MMAT":4.51},IDENT,{om.norm_key("Marsa Marsa Alam For Tourism Development"):"MMAT"})
    assert ok[0]["status"]=="RESOLVED_ALIAS_PREVCLOSE"
    bad,_=om.resolve([row(1,"MM Group For Industry And International Trade",4.6,2.0)],{"MMAT":4.51},IDENT,{om.norm_key("MM Group For Industry And International Trade"):"MMAT"})   # wrong link: MTIE's name aliased to MMAT
    assert bad[0]["status"]=="QUARANTINED_GUARDED_IDENTITY"
def test_unguarded_fuzzy_still_proposed():
    res,props=om.resolve([row(1,"Alpha Foods Company",10.1,1.0)],{"AAA":10.0},IDENT,{});assert res[0]["status"]=="PROPOSED_FUZZY_NEEDS_APPROVAL"
def test_identity_review_records_evidence_and_keeps_bars():
    with tempfile.TemporaryDirectory() as t:
        a=t+"/a";T.mkdb(a);c=sqlite3.connect(a)
        c.execute("update symbol_identity set ticker='MTIE',name_en='MM Group for Industry and International Trade' where ticker='AAA'")
        c.execute("insert into symbol_identity(ticker,name_en,currency) values('MMAT','Marsa Marsa Alam For Tourism Development','EGP')")
        c.execute("update canonical_bars set ticker='MTIE' where ticker='AAA'");c.execute("update canonical_bars set evidence_tier='OFFICIAL_EGX',selected_source_id='S6_EGX_OFFICIAL_1102',open=10.8,high=10.8,low=10.8,close=10.8 where ticker='MTIE' and date='2026-11-02'")
        c.execute("insert into official_session values('2026-11-02',NULL,1,1,'MM Group For Industry And International Trade','EGP',10.8,10.8,10.8,10.8,1,1,8.0,NULL,'x','e','OK')");c.commit();c.close()
        cfg=t+"/c.json";json.dump({"reviews":[{"ticker":"MTIE","sibling":"MMAT","status":"LEGACY_IDENTITY_PENDING_REVIEW","note":"n"}]},open(cfg,"w"))
        I.main(["--src-db",a,"--dst-db",t+"/b","--config",cfg]);d=sqlite3.connect(t+"/b")
        r=d.execute("select status,ohlc_equals_bulletin,name_sim,isin from identity_review").fetchone();assert r[0]=="LEGACY_IDENTITY_PENDING_REVIEW" and r[1]==1 and r[2]==1.0 and r[3] is None   # no ISIN invented
        assert d.execute("select close from canonical_bars where ticker='MTIE' and date='2026-11-02'").fetchone()==(10.8,)                                                         # RAW untouched
if __name__=="__main__":
    fs=[(k,v) for k,v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for k,v in fs:v();print("ok",k)
    print(len(fs),"tests passed")
