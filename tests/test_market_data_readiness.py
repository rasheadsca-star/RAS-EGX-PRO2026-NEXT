import unittest
from pathlib import Path
import importlib.util

SPEC = importlib.util.spec_from_file_location("readiness", Path(__file__).resolve().parents[1] / "scripts" / "market_data_readiness.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

class ReadinessTest(unittest.TestCase):
    def fixture(self):
        return {
            "status": "GREEN",
            "idempotency": {"pass": True},
            "totals": {"unexplainedDataLoss": 0, "discovered": 60288, "canonicalRecords": 26270},
            "sourceAccounting": [{
                "sourceId": "H01_MARKET_OHLCV_HISTORY",
                "normalizedImported": 25800,
                "accounting": {"equationCloses": True}
            }]
        }

    def test_migration_pass_does_not_enable_trading(self):
        result = module.audit(self.fixture())
        self.assertEqual(result["migrationEvidence"], "PASS")
        self.assertEqual(result["tradingReadiness"], "NOT_PROVEN")
        self.assertFalse(result["recommendationsEnabled"])

    def test_missing_market_data_is_failure(self):
        data = self.fixture()
        data["sourceAccounting"] = []
        result = module.audit(data)
        self.assertEqual(result["migrationEvidence"], "FAIL")
        self.assertIn("market_ohlcv_source_missing", result["blockers"])

    def test_unreconciled_accounting_fails(self):
        data = self.fixture()
        data["sourceAccounting"][0]["accounting"]["equationCloses"] = False
        self.assertEqual(module.audit(data)["migrationEvidence"], "FAIL")

if __name__ == "__main__":
    unittest.main()
