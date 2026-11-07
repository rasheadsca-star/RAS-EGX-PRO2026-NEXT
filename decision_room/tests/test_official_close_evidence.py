import os,sys,sqlite3,tempfile
sys.path.insert(0,os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","tools"))
import official_close_evidence as E
TXT="""Main Market Year to 28/10/2026 Statistics
Alpha Co   Pharma  Egyptian 10.000 1 1 5.0 9.0 11/08/2026 4.0 01/03/2026 8.00 60.0
Beta Co    Pharma  Egyptian 10.000 1 1 5.0 9.5 11/08/2026 4.1 01/03/2026 7.00 40.0
junk line without dates
"""
day,rows=E.parse_text(TXT);assert day=="2026-10-28" and len(rows)==2,rows
assert rows[0]["hi"]==9.0 and rows[0]["lo"]==4.0 and rows[0]["close"]==8.0 and rows[0]["hidate"]=="2026-08-11"
c=sqlite3.connect(":memory:");c.execute("create table canonical_bars(ticker,date,price_basis,open,high,low,close,volume,evidence_tier)")
def b(t,d,h,l,cl):c.execute("insert into canonical_bars values(?,?,?,?,?,?,?,?,?)",(t,d,"RAW",1,h,l,cl,1,"SINGLE_PROVIDER"))
b("AAA","2026-08-11",9.0,8,8.5);b("AAA","2026-03-01",5,4.0,4.5);b("AAA","2026-10-28",8.1,7.9,8.0)
b("BBB","2026-08-11",9.5,8,8.5);b("BBB","2026-03-01",5,4.1,4.5);b("BBB","2026-10-28",7.1,6.9,7.05)
r={x[1].split("  ")[0]:x for x in E.classify(c,day,rows)}
assert r["Alpha Co"][8]=="CONFIRMED" and r["Alpha Co"][7]=="AAA"
assert r["Beta Co"][8]=="DB_CLOSE_DIFFERS" and r["Beta Co"][7]=="BBB"
try:E.parse_text("nothing");raise SystemExit("should fail")
except ValueError:pass
print("test_official_close_evidence OK")
