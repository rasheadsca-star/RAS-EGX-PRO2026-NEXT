import importlib.util,sqlite3,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("full",Path(__file__).parent/"full_candle_compare.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class CandleTests(unittest.TestCase):
 def test_agreement_conflict_and_revision(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);db=p/"e.sqlite";c=sqlite3.connect(db)
   c.execute("CREATE TABLE observations(symbol TEXT,session TEXT,provider TEXT,open REAL,high REAL,low REAL,close REAL,volume REAL,status TEXT)")
   records=[
    ("ABUK","2026-10-22","a",10,11,9,10,100,"QUARANTINED"),
    ("ABUK","2026-10-22","b",10,11,9,10,102,"QUARANTINED"),
    ("COMI","2026-10-22","a",20,22,19,21,100,"QUARANTINED"),
    ("COMI","2026-10-22","b",20,22,19,21,130,"QUARANTINED"),
    ("FWRY","2026-10-22","a",8,9,7,8,100,"QUARANTINED"),
    ("FWRY","2026-10-22","a",8,9,7,8.2,100,"QUARANTINED"),
    ("FWRY","2026-10-22","b",8,9,7,8,100,"QUARANTINED")]
   c.executemany("INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?)",records);c.commit();c.close()
   res=m.compare(db,p/"r.json")
   self.assertEqual(res["counts"]["FULL_OHLCV_AGREEMENT_UNVERIFIED"],1)
   self.assertEqual(res["counts"]["FULL_OHLCV_CONFLICT"],1)
   self.assertEqual(res["counts"]["SOURCE_REVISION_REVIEW"],1)
   self.assertEqual(res["approved_count"],0)
if __name__=="__main__":unittest.main()
