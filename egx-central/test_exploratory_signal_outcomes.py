import importlib.util,sqlite3,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("outcomes",Path(__file__).parent/"exploratory_signal_outcomes.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class OutcomeTests(unittest.TestCase):
 def test_no_trade_promotion_and_prior_window(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);db=p/"x.sqlite";con=sqlite3.connect(db)
   con.execute("CREATE TABLE observations(symbol TEXT,session TEXT,open REAL,high REAL,low REAL,close REAL,volume REAL,status TEXT)")
   for i in range(35):
    close=10 if i<25 else 15
    con.execute("INSERT INTO observations VALUES (?,?,?,?,?,?,?,'QUARANTINED')",("COMI",f"2026-08-{i+1:02d}",close,close+1,close-1,close,100))
   con.commit();con.close()
   report=m.evaluate(db,p/"report.json")
   self.assertFalse(report["out_of_sample_validated"])
   self.assertEqual(report["trade_recommendations"],[])
if __name__=="__main__":unittest.main()
