import importlib.util,sqlite3,tempfile,unittest,hashlib,json
from pathlib import Path
root=Path(__file__).parent
spec=importlib.util.spec_from_file_location("backuper",root/"backup_evidence.py")
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class BackupTests(unittest.TestCase):
 def make(self,db,unsafe=False):
  con=sqlite3.connect(db);con.execute("CREATE TABLE observations (evidence_id TEXT,status TEXT)")
  con.execute("INSERT INTO observations VALUES (?,?)",("a","APPROVED" if unsafe else "QUARANTINED"))
  con.commit();con.close()
 def test_snapshot_digest_and_count(self):
  with tempfile.TemporaryDirectory() as t:
   d=Path(t);src=d/"src.sqlite";self.make(src)
   dst=d/"backup.sqlite";manifest=d/"manifest.json"
   r=mod.snapshot(src,dst,manifest)
   self.assertEqual(r["count"],1)
   self.assertEqual(r["sha256"],hashlib.sha256(dst.read_bytes()).hexdigest())
   self.assertEqual(json.loads(manifest.read_text())["trading_eligible"],False)
 def test_unsafe_source_refused(self):
  with tempfile.TemporaryDirectory() as t:
   d=Path(t);src=d/"src.sqlite";self.make(src,True)
   with self.assertRaises(ValueError):mod.snapshot(src,d/"backup.sqlite",d/"manifest.json")
if __name__=="__main__":unittest.main()
