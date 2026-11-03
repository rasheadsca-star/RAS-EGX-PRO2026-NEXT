import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "scripts" / "ohlcv_coverage_audit.py"
spec = importlib.util.spec_from_file_location("coverage", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CoverageTests(unittest.TestCase):
    def test_count_duplicate_invalid_and_threshold(self):
        with tempfile.TemporaryDirectory() as d:
            db = Path(d) / "prices.sqlite"
            con = sqlite3.connect(db)
            con.execute("CREATE TABLE candles(ticker TEXT, session TEXT, open REAL, high REAL, low REAL, close REAL, volume REAL)")
            rows = [("AAA", f"2026-09-{i:02}", 10, 12, 9, 11, 100) for i in range(1,21)]
            rows += [rows[0], ("BBB", "2026-09-01", -1, 12, 9, 11, 100)]
            con.executemany("INSERT INTO candles VALUES (?,?,?,?,?,?,?)", rows)
            con.commit()
            con.close()
            result = module.audit(db, "candles", "ticker", "session", "open", "high", "low", "close", "volume")
            self.assertEqual(result["duplicateTickerSessions"], 1)
            self.assertEqual(result["invalidRows"], 1)
            self.assertTrue(result["symbols"][0]["coverage"]["20"])
            self.assertFalse(result["symbols"][0]["coverage"]["50"])
            self.assertFalse(result["recommendationsEnabled"])

    def test_missing_columns_raise(self):
        with tempfile.TemporaryDirectory() as d:
            db = Path(d)/"x.sqlite"
            con = sqlite3.connect(db)
            con.execute("CREATE TABLE candles(ticker TEXT)")
            con.close()
            with self.assertRaises(ValueError):
                module.audit(db, "candles", "ticker", "session", "open", "high", "low", "close", "volume")

if __name__ == "__main__":
    unittest.main()
