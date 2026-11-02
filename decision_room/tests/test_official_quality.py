import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))
from official_quality import inspect

def sample(n=180):
    return {"session": "2026-11-02", "rows": n, "verified_for_trading": False,
            "items": [{"name": "Company %d" % i, "currency": "EGP",
                       "open": 10.0, "high": 11.0, "low": 9.0, "close": 10.5,
                       "volume": 100, "status": "CANDIDATE"} for i in range(n)]}

class OfficialQualityTests(unittest.TestCase):
    def test_valid_intake_is_still_nontradable(self):
        r = inspect(sample())
        self.assertTrue(r["ok"])
        self.assertFalse(r["verified_for_trading"])
    def test_insufficient_rows(self):
        self.assertFalse(inspect(sample(110))["ok"])
    def test_duplicate_company(self):
        a = sample()
        a["items"][1]["name"] = a["items"][0]["name"]
        self.assertIn("DUPLICATE_NAME_CURRENCY:1", inspect(a)["errors"])
    def test_invalid_price(self):
        a = sample()
        a["items"][0]["low"] = 12
        self.assertIn("UNQUARANTINED_INVALID_OHLCV:0", inspect(a)["errors"])
    def test_unknown_currency(self):
        a = sample()
        a["items"][0]["currency"] = "OTHER"
        self.assertIn("UNKNOWN_CURRENCY:0", inspect(a)["errors"])
    def test_labelled_anomaly_is_quarantined_not_imported(self):
        a = sample(200)
        a["items"][0]["status"] = "CHECK"
        a["items"][0]["reason"] = "INCONSISTENT_OHLC"
        a["items"][0]["low"] = 12
        r = inspect(a)
        self.assertTrue(r["ok"])
        self.assertEqual(r["counts"]["quarantined"], 1)
        self.assertFalse(r["verified_for_trading"])
    def test_excessive_anomalies_block_session(self):
        a = sample(210)
        for x in a["items"][:25]:
            x["status"] = "CHECK"
            x["reason"] = "INCONSISTENT_OHLC"
            x["low"] = 12
        self.assertIn("TOO_MANY_QUARANTINED", inspect(a)["errors"])
    def test_nonfinite_price(self):
        a = sample()
        a["items"][0]["close"] = float("nan")
        self.assertFalse(inspect(a)["ok"])
    def test_unsupported_trading_flag(self):
        a = sample()
        a["verified_for_trading"] = True
        self.assertFalse(inspect(a)["ok"])

if __name__ == "__main__":
    unittest.main()
