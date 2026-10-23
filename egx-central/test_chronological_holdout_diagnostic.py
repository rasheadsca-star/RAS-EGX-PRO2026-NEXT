import importlib.util,sqlite3,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("chrono",Path(__file__).parent/"chronological_holdout_diagnostic.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ChronoTests(unittest.TestCase):
 def test_chronological_diagnostic_not_claimed_oos(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);db=p/"test.sqlite";con=sqlite3.connect(db)
   con.execute("CREATE TABLE observations(symbol TEXT,session TEXT,open REAL,high REAL,low REAL,close REAL,volume REAL,status TEXT)")
   for i in range(40):
    price=10 if i<20 else 12
    con.execute("INSERT INTO observations VALUES (?,?,?,?,?,?,?,'QUARANTINED')",("COMI",f"2026-09-{i+1:02d}",price,price+1,price-1,price,100))
   con.commit();con.close()
   x=m.assess(db,p/"out.json")
   self.assertFalse(x["holdout_independent_of_prior_analysis"])
   self.assertFalse(x["portfolio_metrics_valid"])
   self.assertFalse(x["trading_eligible"])
   self.assertIn("EARLY_70_PCT_HIGH_VOLUME",x["groups"])
if __name__=="__main__":unittest.main()
