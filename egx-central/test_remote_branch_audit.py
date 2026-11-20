import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

MODULE=Path(__file__).with_name("remote_branch_audit.py")
spec=importlib.util.spec_from_file_location("remote_branch_audit",MODULE)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class SafetyTests(unittest.TestCase):
    def test_signal_not_prices(self):
        self.assertNotEqual(mod.classify({"sessions":[{"signalDate":"2026-10-21","ticker":"COMI"}]}),"CANDIDATE_OHLCV_REQUIRES_AUDIT")

    def test_valid_candle_candidate_classification(self):
        self.assertEqual(mod.classify({"sessions":[{"ticker":"COMI","date":"2026-10-21","high":100,"low":90,"close":95,"volume":200}]}),"CANDIDATE_OHLCV_REQUIRES_AUDIT")

    def test_quarantine_only_and_idempotence(self):
        row={"ticker":"COMI","date":"2026-10-21","high":100,"low":90,"close":95,"volume":200}
        def fake(branch,path):
            return json.dumps({"sessions":[row]}).encode()
        with tempfile.TemporaryDirectory() as tmp:
            first=mod.run(tmp,fake)
            second=mod.run(tmp,fake)
            self.assertEqual(first["candidate_count_quarantined"],len(mod.SOURCES))
            self.assertEqual(second["candidate_count_quarantined"],len(mod.SOURCES))
            self.assertFalse(second["production_data_modified"])
            self.assertEqual(second["sqlite_integrity"],"ok")

    def test_impossible_candle_excluded(self):
        row={"ticker":"COMI","date":"2026-10-21","high":80,"low":90,"close":95,"volume":200}
        def fake(branch,path):
            return json.dumps({"sessions":[row]}).encode()
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(mod.run(tmp,fake)["candidate_count_quarantined"],0)

if __name__=="__main__": unittest.main()
