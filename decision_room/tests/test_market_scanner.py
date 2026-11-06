"""Synthetic-only tests for descriptive V8 full-universe scanner."""
import datetime
import json
import pathlib
import sqlite3
import sys
import tempfile
import unittest

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "tests"))
import fixtures as F
from egx_decision.ingest import load
from egx_decision.quality import evaluate
from egx_decision.market_scanner import report
from egx_decision.snapshot import build


class Scanner(unittest.TestCase):
    def fixture(self):
        db = str(pathlib.Path(tempfile.mkdtemp()) / "synthetic.sqlite")
        calendar = F.build(db, {
            "RISE": dict(close=F.series(140, 20, 0.003, 0.002, 3), volume=1_000_000),
            "DECLINE": dict(close=F.series(140, 30, -0.003, 0.002, 2), volume=1_000_000),
            "STALE": dict(close=F.series(140, 20, 0.002, 0.002, 1), last_n=135),
            "GAP": dict(close=F.series(140, 20, 0.002, 0.002, 4), drop_dates=[F.sessions()[-20]]),
        })
        return db, calendar

    def test_full_universe_and_no_orders(self):
        db, cal = self.fixture()
        data = load(db)
        gates, _, session = evaluate(data)
        result = report(data, session, gates)
        names = {x["ticker"]: x for x in result["rows"]}
        for name in ("RISE", "DECLINE", "STALE", "GAP"):
            self.assertIn(name, names)
        self.assertEqual(names["STALE"]["classification"], "STALE")
        self.assertTrue(names["GAP"]["missing_calendar_sessions_60"] > 0)
        self.assertFalse(names["GAP"]["has_valid_setup"])
        self.assertTrue(names["RISE"]["uptrend"])
        self.assertFalse(names["DECLINE"]["uptrend"])
        self.assertEqual(result["qualifiedTradeCount"], 0)
        self.assertEqual(result["verdict"], "NO_STRATEGY_APPROVED")
        for x in result["rows"]:
            self.assertFalse(x["executable"])
            for field in ("entry", "stop", "target1", "target2"):
                self.assertIsNone(x[field])
        json.dumps(result, allow_nan=False)

    def test_no_future_data_in_scanner(self):
        db, cal = self.fixture()
        cutoff = cal[-8]
        raw = load(db, cutoff)
        q, _, session = evaluate(raw)
        before = report(raw, session, q)
        with sqlite3.connect(db) as c:
            c.execute("UPDATE canonical_bars SET close = close * 4, high = high * 4, low = low * 4 WHERE date > ?", (str(cutoff.date()),))
        after_data = load(db, cutoff)
        q2, _, session2 = evaluate(after_data)
        after = report(after_data, session2, q2)
        self.assertEqual(before, after)

    def test_snapshot_integrates_scanner_without_approving_trades(self):
        db, cal = self.fixture()
        now = datetime.datetime(2026, 10, 30, 12, tzinfo=datetime.timezone.utc)
        s = build(db, now=now)
        self.assertIn("market_scanner", s)
        self.assertGreaterEqual(s["market_scanner"]["counts"]["total"], 4)
        self.assertEqual(s["market_scanner"]["qualifiedTradeCount"], 0)
        self.assertEqual(s["verdict"], "NO_STRATEGY_APPROVED")
        self.assertFalse(s["strategy_approved"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
