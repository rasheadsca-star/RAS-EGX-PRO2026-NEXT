import importlib.util,json,sqlite3,tempfile,unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent
def load(name):
 s=importlib.util.spec_from_file_location(name,ROOT/(name+".py"))
 m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
ledger=load("evidence_ledger")
backup=load("backup_evidence")
restore=load("restore_evidence")
continuity=load("check_ledger_continuity")

class RoundtripTests(unittest.TestCase):
 def payload(self,n):
  return {"production_written":False,"automatic_promotion":False,
   "rows":[{"symbol":"COMI","attempts":[{"source":"free_mock","url":"https://example.org/comi",
     "body_sha256":str(n)*64,"candidate":[{"session":"2026-10-22","open":10,
     "high":12,"low":9,"close":float(n),"volume":100}]}]}]}
 def test_two_runs_keep_old_and_reject_duplicates(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d);feed=p/"feed.json";run1=p/"run1.sqlite";snap=p/"saved.sqlite";run2=p/"run2.sqlite"
   feed.write_text(json.dumps(self.payload(10)))
   self.assertEqual(ledger.ingest(feed,run1)["new_evidence"],1)
   backup.snapshot(run1,snap,p/"manifest.json")
   self.assertEqual(restore.restore(snap,run2),1)
   self.assertEqual(ledger.ingest(feed,run2)["new_evidence"],0)
   feed.write_text(json.dumps(self.payload(11)))
   self.assertEqual(ledger.ingest(feed,run2)["new_evidence"],1)
   r=continuity.audit(snap,run2)
   self.assertEqual(r["lost_count"],0)
   self.assertEqual(r["current_count"],2)
   self.assertEqual(r["new_since_prior"],1)

if __name__=="__main__":unittest.main()
