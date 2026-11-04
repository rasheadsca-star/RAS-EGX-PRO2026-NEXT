import sys,pathlib
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]))
import official_map as om
def row(name,close,chg=0.0,cur="EGP",p=1,r=1):return dict(page=p,rank=r,name=name,cur=cur,close=close,chg_pct=chg)
IDENT={"AAA":("Alpha Foods Co",'EGP'),"BBB":("Beta Steel",'EGP')}
PREV={"AAA":10.0,"BBB":20.0}
def test_alias_resolves_with_prevclose():
    res,_=om.resolve([row("Alpha  Foods Co",10.5,5.0)],PREV,IDENT,{"alpha foods co":"AAA"})
    assert res[0]["status"]=="RESOLVED_ALIAS_PREVCLOSE" and res[0]["ticker"]=="AAA"
def test_prevclose_mismatch_quarantined():
    res,_=om.resolve([row("Alpha Foods Co",12.0,5.0)],PREV,IDENT,{"alpha foods co":"AAA"})
    assert res[0]["status"]=="QUARANTINED_ALIAS_PREVCLOSE_MISMATCH" and res[0]["ticker"] is None
def test_fuzzy_is_only_a_proposal():
    res,props=om.resolve([row("Alpha Foods Company",10.0,0.0)],PREV,IDENT,{})
    assert res[0]["status"]=="PROPOSED_FUZZY_NEEDS_APPROVAL" and len(props)==1
def test_no_match_stays_quarantined():
    res,_=om.resolve([row("Unknown Bonds 2030",99.0,0.0)],PREV,IDENT,{})
    assert res[0]["status"]=="QUARANTINED_NO_MATCH" and res[0]["ticker"] is None
def test_non_egp_excluded():
    res,_=om.resolve([row("Alpha Foods Co",1.0,0.0,cur="USD")],PREV,IDENT,{"alpha foods co":"AAA"})
    assert res[0]["status"]=="EXCLUDED_NON_EGP"
def test_duplicate_claim_quarantines_both():
    a={"alpha foods co":"AAA","alpha foods":"AAA"}
    res,_=om.resolve([row("Alpha Foods Co",10.0,0.0,r=1),row("Alpha Foods",10.0,0.0,r=2)],PREV,IDENT,a)
    assert all(r["status"]=="QUARANTINED_DUPLICATE_CLAIM" and r["ticker"] is None for r in res)
def _w(x0,y,t):return (x0,y-3,x0+len(t)*3,y+3,t)
def test_wrapped_name_does_not_bleed_between_rows():
    # two rows 20pt apart; row 1 name wrapped above/below its number line; row 2 name must not absorb row 1's second line
    W=[]
    for y,rk,nm in((100,"1",["Alpha","Foods"]),(140,"2",["Beta","Steel"])):
        W+=[_w(20,y,rk),_w(30,y-8,nm[0]),_w(30,y+8,nm[1]),_w(200,y,"EGP")]
        for i,n in enumerate(["1","2","0.5","3","1","10","5.0","1000","1.0","100","5"]):W.append(_w(220+i*20,y,n))
    rows=om.parse_words([W])
    assert [r["name"] for r in rows]==["Alpha Foods","Beta Steel"]
def test_learn_aliases_only_confirmed():
    rows=[dict(page=1,rank=1,name="Alpha Foods Co"),dict(page=1,rank=2,name="Zed")]
    assert om.learn_aliases(rows,{(1,1):"AAA"})=={"alpha foods co":"AAA"}

if __name__=="__main__":
    fs=[(k,v) for k,v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for k,v in fs:v();print("ok",k)
    print(f"{len(fs)} tests passed")
