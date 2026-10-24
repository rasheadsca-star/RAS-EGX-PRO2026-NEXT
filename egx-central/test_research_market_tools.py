import importlib.util,sqlite3,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("mt",Path(__file__).parent/"research_market_tools.py")
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class MarketToolTests(unittest.TestCase):
 def test_breakout_research_only(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);db=p/"sample.sqlite";c=sqlite3.connect(db)
   c.execute("CREATE TABLE observations(symbol TEXT,session TEXT,open REAL,high REAL,low REAL,close REAL,volume REAL,status TEXT)")
   for i in range(1,23):
    close=14 if i==22 else 10
    c.execute("INSERT INTO observations VALUES (?,?,?,?,?,?,?,'QUARANTINED')",("COMI","2026-09-%02d"%i,close,close+1,close-1,close,100))
   c.commit();c.close()
   result=mod.analyze(db,p/"out.json")
   self.assertEqual(result["instruments"],1)
   self.assertTrue(result["rows"][0]["breakout_above_prior20_high"])
   self.assertEqual(result["certified_signals"],0)
   self.assertEqual(result["trade_recommendations"],[])
if __name__=="__main__":unittest.main()
