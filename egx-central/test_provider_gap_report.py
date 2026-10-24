import importlib.util,json,sqlite3,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("gap",Path(__file__).parent/"provider_gap_report.py")
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class ProviderGapTests(unittest.TestCase):
 def test_labeled_providers_are_not_independent_certification(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);db=p/"test.sqlite";con=sqlite3.connect(db)
   con.execute("CREATE TABLE observations(symbol TEXT,session TEXT,provider TEXT,status TEXT)")
   con.executemany("INSERT INTO observations VALUES (?,?,?,?)",[
    ("COMI","2026-10-22","yahoo_chart","QUARANTINED"),
    ("COMI","2026-10-22","other_feed","QUARANTINED"),
    ("ABUK","2026-10-22","yahoo_chart","QUARANTINED")])
   con.commit();con.close()
   result=mod.inspect(db,p/"report.json")
   self.assertEqual(result["multiple_labeled_provider_sessions"],1)
   self.assertFalse(result["independence_proven"])
if __name__=="__main__":unittest.main()
