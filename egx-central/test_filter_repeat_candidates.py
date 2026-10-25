import importlib.util,json,sqlite3,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("dedupe",Path(__file__).parent/"filter_repeat_candidates.py")
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class CandidateDedupTests(unittest.TestCase):
 def test_preserves_new_session_and_rejects_unchanged_repeats(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);db=p/"ledger.sqlite";feed=p/"feed.json"
   c=sqlite3.connect(db)
   c.execute("CREATE TABLE observations(symbol TEXT,session TEXT,provider TEXT,open REAL,high REAL,low REAL,close REAL,volume REAL,status TEXT)")
   c.execute("INSERT INTO observations VALUES ('COMI','2026-10-22','demo',10,11,9,10,100,'QUARANTINED')")
   c.commit();c.close()
   old={"session":"2026-10-22","open":10,"high":11,"low":9,"close":10,"volume":100}
   new=dict(old,session="2026-10-21")
   feed.write_text(json.dumps({"production_written":False,"automatic_promotion":False,"rows":[{"symbol":"COMI","attempts":[{"source":"demo","candidate":[old,old,new,new]}]}]}))
   r=module.filter_candidates(feed,db,p/"clean.json",p/"report.json")
   self.assertEqual((r["retained"],r["duplicate_unchanged_skipped"]),(1,3))
   self.assertEqual(len(json.loads((p/"clean.json").read_text())["rows"][0]["attempts"][0]["candidate"]),1)
if __name__=="__main__":unittest.main()
