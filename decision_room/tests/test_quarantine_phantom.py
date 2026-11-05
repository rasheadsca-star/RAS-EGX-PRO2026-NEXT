import os,sys,sqlite3,tempfile
sys.path.insert(0,os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","tools"))
import quarantine_phantom_sessions as Q
d=tempfile.mkdtemp();src=d+"/a.sqlite";out=d+"/b.sqlite"
c=sqlite3.connect(src)
c.execute("create table canonical_bars(ticker,date,price_basis,open,high,low,close,volume,evidence_tier,providers,selected_source_id,n_observations,notes)")
c.execute("create table canonical_bars_superseded(ticker,date,price_basis,open,high,low,close,volume,evidence_tier,providers,selected_source_id,n_observations,notes,superseded_by_source,superseded_by_pdf_sha256,diff_pct)")
def b(t,dt,cl,v,tier="SINGLE_PROVIDER"):c.execute("insert into canonical_bars values(?,?,'RAW',1,2,0.5,?,?,?,'m','s',1,'')",(t,dt,cl,v,tier))
for t in"ABCDEFGHIJ":b(t,"2026-10-07",10,100);b(t,"2026-10-08",10,100);b(t,"2026-10-11",11,50)
c.commit();c.close()
Q.main(["--db",src,"--out",out,"2026-10-08"])
o=sqlite3.connect(out)
assert o.execute("select count(*) from canonical_bars where date='2026-10-08'").fetchone()[0]==0
assert o.execute("select count(*) from canonical_bars_superseded where date='2026-10-08'").fetchone()[0]==10
assert o.execute("select count(*) from canonical_bars").fetchone()[0]==20
for bad in("2026-10-11",):
    try:Q.main(["--db",src,"--out",d+"/c.sqlite",bad]);raise AssertionError("should refuse genuine session")
    except SystemExit as e:assert "refusing" in str(e)
print("test_quarantine_phantom OK")
