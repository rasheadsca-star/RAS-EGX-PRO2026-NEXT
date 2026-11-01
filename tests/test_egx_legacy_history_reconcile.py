import importlib.util, json, tempfile, unittest
from pathlib import Path
p=Path(__file__).resolve().parents[1]/"scripts"/"research"/"egx_legacy_history_reconcile.py"
spec=importlib.util.spec_from_file_location("reconcile",p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class TestReconcile(unittest.TestCase):
 def test_conflicts_are_quarantined(self):
  with tempfile.TemporaryDirectory() as d:
   a,b=Path(d)/"a",Path(d)/"b"
   a.mkdir();b.mkdir()
   def save(folder,close):
    (folder/"AAA.json").write_text(json.dumps({"ticker":"AAA","sessions":[{"date":"2026-10-29","open":10,"high":12,"low":9,"close":close,"volume":100}]}))
   save(a,11);save(b,10)
   result=m.collect([a,b])
   self.assertEqual(result["summary"]["conflicts"],1)
   self.assertEqual(result["summary"]["distinct_symbol_sessions"],0)
   self.assertFalse(result["summary"]["recommendations_enabled"])
 def test_identical_records_dedupe(self):
  with tempfile.TemporaryDirectory() as d:
   a=Path(d)/"a";b=Path(d)/"b";a.mkdir();b.mkdir()
   x={"ticker":"AAA","sessions":[{"date":"2026-10-29","open":10,"high":12,"low":9,"close":11,"volume":100}]}
   for folder in (a,b): (folder/"AAA.json").write_text(json.dumps(x))
   r=m.collect([a,b])
   self.assertEqual(r["summary"]["distinct_symbol_sessions"],1)
   self.assertEqual(r["rows"][0]["supporting_sources"],2)
   self.assertFalse(r["rows"][0]["eligible_for_recommendations"])
if __name__=="__main__":unittest.main()
