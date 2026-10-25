import importlib.util,sqlite3,tempfile,unittest
from pathlib import Path
sp=importlib.util.spec_from_file_location("quality",Path(__file__).parent/"audit_evidence_quality.py")
q=importlib.util.module_from_spec(sp);sp.loader.exec_module(q)
class QualityTests(unittest.TestCase):
 def test_reject_weekend_and_detect_conflict(self):
  with tempfile.TemporaryDirectory() as t:
   db=Path(t)/"test.sqlite";c=sqlite3.connect(db)
   c.execute("CREATE TABLE observations(evidence_id TEXT,symbol TEXT,session TEXT,provider TEXT,open REAL,high REAL,low REAL,close REAL,volume REAL,status TEXT)")
   rows=[("1","COMI","2026-10-22","alpha",10,12,9,10,100,"QUARANTINED"),
         ("2","COMI","2026-10-22","beta",10,12,9,11,100,"QUARANTINED"),
         ("3","COMI","2026-10-23","alpha",10,12,9,10,100,"QUARANTINED")]
   c.executemany("INSERT INTO observations VALUES (?,?,?,?,?,?,?,?,?,?)",rows);c.commit();c.close()
   result=q.audit(db,Path(t)/"report.json")
   self.assertEqual(result["multi_source_close_conflicts_gt_1pct"],1)
   self.assertEqual(result["row_counts"]["SESSION_REVIEW_REQUIRED"],1)
   self.assertEqual(result["v4a_eligible"],0)
if __name__=="__main__":unittest.main()
