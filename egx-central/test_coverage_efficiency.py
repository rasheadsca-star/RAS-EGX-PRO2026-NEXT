import importlib.util,sqlite3,tempfile,unittest
from pathlib import Path
sp=importlib.util.spec_from_file_location("coverage",Path(__file__).parent/"coverage_efficiency.py")
m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
class CoverageTests(unittest.TestCase):
 def test_distinguishes_repeat_revision_and_multiple_sources(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);d=p/"a.sqlite";c=sqlite3.connect(d)
   c.execute("CREATE TABLE observations(symbol TEXT,session TEXT,provider TEXT,open REAL,high REAL,low REAL,close REAL,volume REAL,status TEXT)")
   rows=[("COMI","2026-10-22","a",10,11,9,10,100,"QUARANTINED"),
    ("COMI","2026-10-22","a",10,11,9,10,100,"QUARANTINED"),
    ("COMI","2026-10-22","a",10,11,9,10.5,100,"QUARANTINED"),
    ("COMI","2026-10-22","b",10,11,9,10,100,"QUARANTINED")]
   c.executemany("INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?)",rows);c.commit();c.close()
   r=m.report(d,p/"r.json")
   self.assertEqual(r["evidence_rows"],4)
   self.assertEqual(r["distinct_symbol_sessions"],1)
   self.assertEqual(r["exact_ohlcv_repeats"],1)
   self.assertEqual(r["revised_provider_sessions"],1)
   self.assertEqual(r["multiple_provider_sessions"],1)
if __name__=="__main__":unittest.main()
