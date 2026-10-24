import importlib.util,sqlite3,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("nonoverlap",Path(__file__).parent/"nonoverlap_signal_audit.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class NonoverlapTests(unittest.TestCase):
 def test_bounds_and_research_only(self):
  self.assertEqual(m.bounds(0,0),[None,None])
  lo,hi=m.bounds(5,10)
  self.assertLess(lo,0.5)
  self.assertGreater(hi,0.5)
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);db=p/"bars.sqlite";con=sqlite3.connect(db)
   con.execute("CREATE TABLE observations(symbol TEXT,session TEXT,open REAL,high REAL,low REAL,close REAL,volume REAL,status TEXT)")
   for i in range(36):
    close=10 if i<20 else 14
    con.execute("INSERT INTO observations VALUES (?,?,?,?,?,?,?,'QUARANTINED')",("COMI",f"2026-09-{i+1:02d}",close,close+1,close-1,close,200))
   con.commit();con.close()
   result=m.analyze(db,p/"result.json")
   self.assertFalse(result["trading_eligible"])
   self.assertFalse(result["out_of_sample"])
   self.assertEqual(result["groups"]["HIGH_VOLUME"]["nonoverlap_events"],0)
if __name__=="__main__":unittest.main()
