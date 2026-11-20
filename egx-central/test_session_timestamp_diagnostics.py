import importlib.util,json,tempfile,unittest,datetime
from pathlib import Path
spec=importlib.util.spec_from_file_location("diag",Path(__file__).parent/"session_timestamp_diagnostics.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class TimestampTests(unittest.TestCase):
 def test_timezone_and_weekend_classification(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);src=p/"feed.json"
   dt=datetime.datetime(2026,10,23,10,tzinfo=datetime.timezone.utc)
   row={"session":"2026-10-23","utc_session":"2026-10-23","raw_timestamp":int(dt.timestamp())}
   src.write_text(json.dumps({"rows":[{"symbol":"COMI","attempts":[{"source":"yahoo_chart","yahoo_meta":{"exchangeTimezoneName":"Africa/Cairo"},"candidate":[row]}]}]}))
   result=m.diagnose(src,p/"report.json")
   self.assertEqual(result["counts"]["CAIRO_WEEKEND_TIMESTAMP"],1)
   self.assertEqual(result["certified_sessions"],0)
 def test_timestamp_date_mismatch(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);src=p/"feed.json"
   dt=datetime.datetime(2026,10,22,10,tzinfo=datetime.timezone.utc)
   row={"session":"2026-10-21","utc_session":"2026-10-22","raw_timestamp":int(dt.timestamp())}
   src.write_text(json.dumps({"rows":[{"symbol":"COMI","attempts":[{"source":"yahoo_chart","candidate":[row]}]}]}))
   self.assertEqual(m.diagnose(src,p/"report.json")["counts"]["TIMESTAMP_DATE_MISMATCH"],1)
if __name__=="__main__":unittest.main()
