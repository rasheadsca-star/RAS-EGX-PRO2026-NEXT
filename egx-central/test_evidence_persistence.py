import importlib.util,json,sqlite3,tempfile,unittest
from pathlib import Path

base=Path(__file__).resolve().parent
def mod(name):
 spec=importlib.util.spec_from_file_location(name,base/(name+".py"))
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
ledger=mod("evidence_ledger");restore=mod("restore_evidence")

class TestPersistentEvidence(unittest.TestCase):
 def test_restore_then_dedupe_then_append(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);feed=p/"feed.json";db=p/"first.sqlite";nextdb=p/"next.sqlite"
   def sample(close,digest):
    return {"production_written":False,"automatic_promotion":False,"rows":[{"symbol":"ABUK",
      "attempts":[{"source":"provider_a","url":"https://example.org/source","body_sha256":digest,
      "candidate":[{"session":"2026-10-22","open":10,"high":11,"low":9,"close":close,"volume":100}]}]}]}
   feed.write_text(json.dumps(sample(10,"a"*64)))
   first=ledger.ingest(feed,db);self.assertEqual(first["new_evidence"],1)
   self.assertEqual(ledger.ingest(feed,db)["new_evidence"],0)
   self.assertEqual(restore.restore(db,nextdb),1)
   self.assertEqual(ledger.ingest(feed,nextdb)["new_evidence"],0)
   feed.write_text(json.dumps(sample(10.5,"b"*64)))
   r=ledger.ingest(feed,nextdb)
   self.assertEqual(r["total_observations"],2)
   self.assertEqual(r["symbol_session_provider_revisions"],1)
   with sqlite3.connect(nextdb) as con:
    self.assertEqual(con.execute("SELECT COUNT(*) FROM observations WHERE status='QUARANTINED'").fetchone()[0],2)

 def test_reject_corrupt_and_unsafe_ledger(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);db=p/"invalid.sqlite";db.write_bytes(b"not a sqlite database")
   with self.assertRaises(sqlite3.DatabaseError):restore.restore(db,p/"new.sqlite")
   self.assertFalse((p/"new.sqlite").exists())

if __name__=="__main__":unittest.main()
