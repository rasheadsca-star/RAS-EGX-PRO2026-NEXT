import importlib.util,sqlite3,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("continuity",Path(__file__).parent/"check_ledger_continuity.py")
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class ContinuityTests(unittest.TestCase):
 def make(self,path,values):
  c=sqlite3.connect(path);c.execute("CREATE TABLE observations (evidence_id TEXT PRIMARY KEY,status TEXT)")
  c.executemany("INSERT INTO observations VALUES (?,'QUARANTINED')",[(x,) for x in values]);c.commit();c.close()
 def test_no_loss(self):
  with tempfile.TemporaryDirectory() as t:
   a=Path(t)/"a.sqlite";b=Path(t)/"b.sqlite";self.make(a,["a"]);self.make(b,["a","b"])
   x=mod.audit(a,b);self.assertEqual(x["new_since_prior"],1);self.assertEqual(x["lost_count"],0)
 def test_loss_refused(self):
  with tempfile.TemporaryDirectory() as t:
   a=Path(t)/"a.sqlite";b=Path(t)/"b.sqlite";self.make(a,["a","b"]);self.make(b,["b"])
   with self.assertRaises(ValueError):mod.audit(a,b)
 def test_initial_baseline(self):
  with tempfile.TemporaryDirectory() as t:
   b=Path(t)/"b.sqlite";self.make(b,["x"]);self.assertEqual(mod.audit(None,b)["prior_count"],0)
if __name__=="__main__":unittest.main()
