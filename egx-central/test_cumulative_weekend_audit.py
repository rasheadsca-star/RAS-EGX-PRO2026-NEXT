import importlib.util,sqlite3,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("weekend",Path(__file__).parent/"cumulative_weekend_audit.py")
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class CumulativeWeekendTests(unittest.TestCase):
 def test_archive_weekend_cannot_be_hidden_by_feed(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);db=p/"archive.sqlite";c=sqlite3.connect(db)
   c.execute("CREATE TABLE observations(symbol TEXT,session TEXT,provider TEXT,status TEXT)")
   c.executemany("INSERT INTO observations VALUES (?,?,?,?)",[
    ("COMI","2026-10-23","yahoo_chart","QUARANTINED"),
    ("COMI","2026-10-23","yahoo_chart","QUARANTINED"),
    ("COMI","2026-10-22","yahoo_chart","QUARANTINED")]);c.commit();c.close()
   r=mod.audit(db,p/"result.json")
   self.assertEqual(r["weekend_rows"],2)
   self.assertEqual(r["distinct_weekend_symbol_sessions"],1)
   self.assertFalse(r["trading_eligible"])
if __name__=="__main__":unittest.main()
