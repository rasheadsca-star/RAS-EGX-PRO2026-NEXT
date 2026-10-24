import importlib.util,json,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("dc",Path(__file__).parent/"date_concentration.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class DateConcentrationTests(unittest.TestCase):
 def test_weekend_by_symbol(self):
  with tempfile.TemporaryDirectory() as folder:
   p=Path(folder);src=p/"feed.json"
   src.write_text(json.dumps({"rows":[{"symbol":"AAA","attempts":[{"source":"yahoo_chart","candidate":[{"session":"2026-10-23"},{"session":"2026-10-22"}]}]}]}))
   out=m.analyze(src,p/"out.json")
   self.assertEqual(out["weekend_by_symbol"]["AAA"],1)
   self.assertEqual(out["approved"],0)
if __name__=="__main__":unittest.main()
