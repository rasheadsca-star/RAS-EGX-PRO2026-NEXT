import importlib.util,json,tempfile,unittest
from pathlib import Path
root=Path(__file__).parent
def load(name):
 s=importlib.util.spec_from_file_location(name,root/(name+".py"))
 m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
history=load("ledger_history")
verify=load("verify_ledger_history")
class HistoryTipTests(unittest.TestCase):
 def test_chain_manifest_match_and_mismatch(self):
  with tempfile.TemporaryDirectory() as t:
   d=Path(t);h=d/"ledger_history.jsonl";m=d/"manifest.json"
   payload={"schema":"egx-quarantine-git-backup-1","count":265,
    "sha256":"abc","ids_sha256":"def","trading_eligible":False,"production_modified":False}
   m.write_text(json.dumps(payload))
   history.append(h,m,"first")
   self.assertEqual(verify.check(h,m)["current_count"],265)
   payload["ids_sha256"]="changed";m.write_text(json.dumps(payload))
   with self.assertRaisesRegex(ValueError,"does not match"):verify.check(h,m)
if __name__=="__main__":unittest.main()
