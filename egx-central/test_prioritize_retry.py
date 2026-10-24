import importlib.util,json,sqlite3,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("priority",Path(__file__).parent/"prioritize_retry.py")
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class PriorityTests(unittest.TestCase):
 def test_new_uncovered_symbol_ranks_above_repeated_coverage(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);f=p/"retry.json";db=p/"e.sqlite";out=p/"sorted.json"
   f.write_text(json.dumps({"read_only":True,"candidates":[
    {"symbol":"AAA","missing_latest_observation":True,"short_history":True},
    {"symbol":"BBB","missing_latest_observation":True,"short_history":True}]}))
   c=sqlite3.connect(db);c.execute("CREATE TABLE observations(symbol TEXT,session TEXT,status TEXT)")
   c.executemany("INSERT INTO observations VALUES (? , ?, 'QUARANTINED')",[("AAA",f"2026-09-{i:02d}") for i in range(1,21)]);c.commit();c.close()
   r=mod.prioritize(f,db,out)
   self.assertEqual(r["candidates"][0]["symbol"],"BBB")
   self.assertFalse(r["automatic_promotion"])
   self.assertEqual(r["candidate_count"],2)
 def test_first_run_no_archive(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);f=p/"retry.json";f.write_text(json.dumps({"read_only":True,"candidates":[{"symbol":"AAA"}]}))
   self.assertEqual(mod.prioritize(f,p/"missing.sqlite",p/"plan.json")["candidate_count"],1)
if __name__=="__main__":unittest.main()
