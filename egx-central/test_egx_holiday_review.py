import importlib.util,tempfile,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location("holiday",Path(__file__).parent/"egx_holiday_review.py")
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
class EgyptCalendarTests(unittest.TestCase):
 def test_october_observed_closure_vs_original_date(self):
  self.assertEqual(h.classify("2026-10-08")["status"],"EXCHANGE_CLOSED_CONFIRMED")
  self.assertEqual(h.classify("2026-10-06")["status"],"POSSIBLE_HOLIDAY_REVIEW")
 def test_egypt_sunday_is_possible_session_and_friday_weekend(self):
  self.assertEqual(h.classify("2026-10-11")["status"],"UNVERIFIED_POTENTIAL_SESSION")
  self.assertEqual(h.classify("2026-10-09")["status"],"WEEKEND")
 def test_eid_requires_venue_verification(self):
  self.assertEqual(h.classify("2026-03-22")["status"],"POSSIBLE_HOLIDAY_REVIEW")
  with tempfile.TemporaryDirectory() as t:
   x=h.report("2026-10-06","2026-10-11",Path(t)/"report.json")
   self.assertFalse(x["official_exchange_calendar_complete"])
   self.assertFalse(x["trading_eligible"])
if __name__=="__main__":unittest.main()
