import importlib.util,json,sqlite3,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("legacy",Path(__file__).parent/"legacy_weekend_reconcile.py")
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class LegacyWeekendTests(unittest.TestCase):
 def test_legacy_weekend_does_not_count_as_new_feed_weekend(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);db=p/"a.sqlite";feed=p/"feed.json"
   c=sqlite3.connect(db);c.execute("CREATE TABLE observations(symbol TEXT,session TEXT,status TEXT)")
   c.executemany("INSERT INTO observations VALUES (?,?,?)",[
    ("COMI","2026-10-22","QUARANTINED"),
    ("COMI","2026-10-23","QUARANTINED")]);c.commit();c.close()
   feed.write_text(json.dumps({"rows":[{"symbol":"COMI","attempts":[{"source":"yahoo_chart","candidate":[{"session":"2026-10-22"}]}]}]}))
   r=mod.check(feed,db,p/"result.json")
   self.assertEqual(r["counts"]["CURRENT_FEED_WEEKDAY"],1)
   self.assertEqual(r["counts"]["ARCHIVED_ONLY_WEEKEND"],1)
   self.assertEqual(r["certified_sessions"],0)
if __name__=="__main__":unittest.main()
