import importlib.util,json,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("ledger_history",Path(__file__).parent/"ledger_history.py")
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class HistoryTests(unittest.TestCase):
 def test_history_chain_rejects_regression_and_tamper(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);history=p/"history.jsonl";manifest=p/"manifest.json"
   def m(count):
    manifest.write_text(json.dumps({"schema":"egx-quarantine-git-backup-1","count":count,
       "trading_eligible":False,"sha256":str(count),"ids_sha256":str(count)}))
   m(200);self.assertTrue(module.append(history,manifest,"1")["changed"])
   self.assertFalse(module.append(history,manifest,"1")["changed"])
   m(235);self.assertEqual(module.append(history,manifest,"2")["entries"],2)
   m(199)
   with self.assertRaisesRegex(ValueError,"count regression"):module.append(history,manifest,"3")
   lines=history.read_text().splitlines()
   row=json.loads(lines[0]);row["count"]=201
   history.write_text(json.dumps(row)+"\n"+lines[1]+"\n")
   m(236)
   with self.assertRaisesRegex(ValueError,"hash corrupted"):module.append(history,manifest,"4")
if __name__=="__main__":unittest.main()
