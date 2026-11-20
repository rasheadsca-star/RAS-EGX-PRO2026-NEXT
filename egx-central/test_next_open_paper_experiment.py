import importlib.util,sqlite3,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("paper",Path(__file__).parent/"next_open_paper_experiment.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class PaperTests(unittest.TestCase):
 def test_fixed_parameters_and_no_promotion(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);db=p/"bars.sqlite";con=sqlite3.connect(db)
   con.execute("CREATE TABLE observations(symbol TEXT,session TEXT,open REAL,high REAL,low REAL,close REAL,volume REAL,status TEXT)")
   for i in range(35):
    close=10 if i<20 else 12
    con.execute("INSERT INTO observations VALUES (?,?,?,?,?,?,?,'QUARANTINED')",("COMI",f"2026-09-{i+1:02d}",close,close+1,close-1,close,100))
   con.commit();con.close()
   x=m.run(db,p/"out.json")
   self.assertFalse(x["trading_eligible"])
   self.assertFalse(x["independent_oos"])
   self.assertEqual(x["parameters"]["round_trip_bps"],40)
   self.assertEqual(x["parameters"]["entry"],"NEXT_SESSION_OPEN")
if __name__=="__main__":unittest.main()
