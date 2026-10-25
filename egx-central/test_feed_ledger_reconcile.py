import importlib.util,json,sqlite3,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("reconcile",Path(__file__).parent/"feed_ledger_reconcile.py")
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class FeedLedgerTests(unittest.TestCase):
 def test_detects_missing_saved_session(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder);db=p/"a.sqlite";feed=p/"feed.json"
   con=sqlite3.connect(db);con.execute("CREATE TABLE observations(symbol TEXT,session TEXT,status TEXT)")
   con.execute("INSERT INTO observations VALUES ('COMI','2026-10-22','QUARANTINED')");con.commit();con.close()
   feed.write_text(json.dumps({"rows":[{"symbol":"COMI","attempts":[{"source":"yahoo_chart","candidate":[{"session":"2026-10-22"},{"session":"2026-10-21"}]}]}]}))
   r=mod.compare(feed,db,p/"report.json")
   self.assertEqual(r["missing_feed_pairs"],1)
   self.assertEqual(r["certified_sessions"],0)
if __name__=="__main__":unittest.main()
