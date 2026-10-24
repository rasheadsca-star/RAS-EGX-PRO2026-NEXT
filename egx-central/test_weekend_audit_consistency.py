import unittest
from pathlib import Path

class WeekendGuard(unittest.TestCase):
 def test_fail_closed_contract(self):
  code=(Path(__file__).parent/'weekend_audit_consistency.py').read_text()
  self.assertIn('WEEKEND_COUNT_MISMATCH',code)
  self.assertIn('EVIDENCE_COUNT_MISMATCH',code)
  self.assertIn('UNSAFE_PROMOTION',code)

if __name__=='__main__':unittest.main()
