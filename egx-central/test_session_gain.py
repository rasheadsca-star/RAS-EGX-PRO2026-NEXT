import importlib.util,sqlite3,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("gain",Path(__file__).parent/"session_gain.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class SessionGainTests(unittest.TestCase):
 def make(self,path,rows):
  con=sqlite3.connect(path)
  con.execute("CREATE TABLE observations(evidence_id TEXT,symbol TEXT,session TEXT,provider TEXT,status TEXT)")
  con.executemany("INSERT INTO observations VALUES (?,?,?,?, 'QUARANTINED')",rows)
  con.commit();con.close()
 def test_repeats_are_not_new_sessions(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);a=p/"a.sqlite";b=p/"b.sqlite"
   self.make(a,[("a","COMI","2026-10-22","A")])
   self.make(b,[("a","COMI","2026-10-22","A"),("b","COMI","2026-10-22","A"),("c","COMI","2026-10-21","B")])
   x=m.calculate(a,b,p/"r.json")
   self.assertEqual(x["new_evidence"],2)
   self.assertEqual(x["new_symbol_sessions"],1)
   self.assertEqual(x["certified_new_sessions"],0)
 def test_dropped_evidence_is_rejected(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);a=p/"a.sqlite";b=p/"b.sqlite"
   self.make(a,[("a","COMI","2026-10-22","A")]);self.make(b,[])
   with self.assertRaisesRegex(ValueError,"lost historical evidence"):m.calculate(a,b,p/"r.json")
if __name__=="__main__":unittest.main()
