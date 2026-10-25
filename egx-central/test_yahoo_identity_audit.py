import importlib.util,json,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("identity",Path(__file__).parent/"yahoo_identity_audit.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class IdentityAuditTests(unittest.TestCase):
 def test_metadata_timezone_and_currency_fail_closed(self):
  with tempfile.TemporaryDirectory() as t:
   p=Path(t);f=p/"in.json";out=p/"out.json"
   bar={"session":"2026-10-22","utc_session":"2026-10-22","raw_timestamp":1792627200}
   meta={"symbol":"COMI.CA","currency":"USD","exchangeTimezoneName":"Africa/Cairo"}
   f.write_text(json.dumps({"rows":[{"symbol":"COMI","attempts":[{"source":"yahoo_chart","yahoo_meta":meta,"candidate":[bar]}]}]}))
   result=m.inspect(f,out)
   self.assertEqual(result["certified_sessions"],0)
   self.assertEqual(result["overlapping_flags"]["non_egp_currency"],1)
   self.assertIn("COMI",result["symbol_flags"])
   self.assertNotIn("METADATA_CONSISTENT_UNVERIFIED",result["counts"])
if __name__=="__main__":unittest.main()
