import unittest
from pathlib import Path
class HistoricalWindowTests(unittest.TestCase):
 def test_one_year_window_and_candle_limit(self):
  code=(Path(__file__).parent/"free_source_fallback.js").read_text()
  self.assertIn("range=1y&interval=1d",code)
  self.assertIn("candidate.slice(-260)",code)
  self.assertIn("lines.slice(-262)",code)
  self.assertNotIn("range=5d&interval=1d",code)
if __name__=="__main__":unittest.main()
