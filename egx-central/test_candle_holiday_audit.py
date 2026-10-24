import importlib.util,sqlite3,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("audit",Path(__file__).parent/"candle_holiday_audit.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class HolidayConflicts(unittest.TestCase):
 def test_classifies_venue_closure_and_government_candidate(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);db=p/"sample.sqlite";c=sqlite3.connect(db)
   c.execute("CREATE TABLE observations(symbol TEXT,session TEXT,status TEXT)")
   c.executemany("INSERT INTO observations VALUES (?,?,?)",[
    ("COMI","2026-10-08","QUARANTINED"),
    ("COMI","2026-10-06","QUARANTINED"),
    ("COMI","2026-10-11","QUARANTINED")])
   c.commit();c.close()
   x=m.inspect(db,p/"out.json")
   self.assertEqual(x["confirmed_closure_conflicts"],1)
   self.assertEqual(x["pending_holiday_review"],1)
   self.assertFalse(x["trading_eligible"])
if __name__=="__main__":unittest.main()
