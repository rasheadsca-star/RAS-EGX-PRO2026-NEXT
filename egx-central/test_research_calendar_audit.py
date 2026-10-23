import importlib.util,sqlite3,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("cal",Path(__file__).parent/"research_calendar_audit.py")
cal=importlib.util.module_from_spec(spec);spec.loader.exec_module(cal)
class CalendarAuditTests(unittest.TestCase):
 def test_research_weekdays_and_weekend(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);db=p/"test.sqlite";con=sqlite3.connect(db)
   con.execute("CREATE TABLE observations(symbol TEXT,session TEXT,status TEXT)")
   con.executemany("INSERT INTO observations VALUES (?,?,?)",[
    ("COMI","2026-10-22","QUARANTINED"),("COMI","2026-10-22","QUARANTINED"),
    ("COMI","2026-10-23","QUARANTINED"),("ABUK","bad","QUARANTINED")])
   con.commit();con.close()
   r=cal.inspect(db,p/"out.json")
   self.assertEqual(r["unique_symbol_sessions"],1)
   self.assertEqual(r["counts"]["WEEKEND_REVIEW"],1)
   self.assertEqual(r["counts"]["INVALID_DATE"],1)
   self.assertEqual(r["certified_sessions"],0)
if __name__=="__main__":unittest.main()
