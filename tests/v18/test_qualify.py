import json
import tempfile
import unittest
from pathlib import Path

from scripts.v18.qualify import (
    _promotion_contract_gate,
    evaluate_next_session,
    evaluate_v18_shadow,
)


class QualificationTests(unittest.TestCase):
    def history(self, o=10, h=10.5, l=9.5, c=10.2):
        return {
            "sessions": [
                {"date": "2026-08-30", "open": 9, "high": 9, "low": 9, "close": 9},
                {"date": "2026-08-31", "open": o, "high": h, "low": l, "close": c},
            ]
        }

    def selection(self, **kwargs):
        row = {
            "ticker": "TEST",
            "entryLow": 9.9,
            "entryHigh": 10.1,
            "stop": 9.6,
            "target": 10.4,
            "decision": "BUY_CANDIDATE",
        }
        row.update(kwargs)
        return row

    def contracted_entry(self):
        return {
            "signalId": "2026-08-30:V18_SHADOW:V18.0.0",
            "sessionDate": "2026-08-30",
            "portfolioDecision": "SHADOW_CANDIDATES_ONLY",
            "productionAuthority": False,
            "selections": [self.selection()],
            "executionPolicy": {
                "entry": "NEXT_SESSION_OPEN_INSIDE_FROZEN_ENTRY_RANGE",
                "maxHoldingSessions": 1,
                "sameSessionTargetStop": "CONSERVATIVE_STOP_FIRST",
                "transactionCostPct": 0.6,
            },
            "portfolioAllocationPolicy": {
                "method": "EQUAL_WEIGHT_BUY_CANDIDATES",
                "candidateTickers": ["TEST"],
            },
            "sourceSessionEvidence": {
                "requiredSession": "2026-08-30",
                "allSelectionsAligned": True,
            },
            "modelLineage": {"explicitlyLinked": True},
        }

    def test_same_session_ambiguity_is_stop(self):
        row = evaluate_next_session(
            self.selection(), self.history(h=10.6, l=9.5), "2026-08-30"
        )
        self.assertEqual(row["state"], "AMBIGUOUS_TREATED_AS_STOP")
        self.assertLess(row["netReturnPct"], 0)

    def test_target_touch(self):
        row = evaluate_next_session(
            self.selection(), self.history(h=10.5, l=9.8), "2026-08-30"
        )
        self.assertEqual(row["state"], "TARGET_TOUCHED")
        self.assertTrue(row["executable"])

    def test_open_outside_entry_range_is_not_entered(self):
        row = evaluate_next_session(
            self.selection(), self.history(o=10.2, h=10.5, l=9.9, c=10.4), "2026-08-30"
        )
        self.assertEqual(row["state"], "NOT_ENTERED_OPEN_OUTSIDE_RANGE")
        self.assertFalse(row["executable"])

    def test_no_future_session_stays_pending(self):
        history = {
            "sessions": [
                {"date": "2026-08-30", "open": 10, "high": 10, "low": 10, "close": 10}
            ]
        }
        row = evaluate_next_session(self.selection(), history, "2026-08-30")
        self.assertFalse(row["resolved"])
        self.assertEqual(row["state"], "PENDING_NEXT_SESSION")

    def test_no_trade_shadow_does_not_count_for_promotion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "data/history").mkdir(parents=True)
            (root / "data/history/TEST.json").write_text(json.dumps(self.history()))
            ledger = {
                "entries": [
                    {
                        "signalId": "x",
                        "sessionDate": "2026-08-30",
                        "portfolioDecision": "NO_TRADE",
                        "productionAuthority": False,
                        "selections": [self.selection()],
                    }
                ]
            }
            _, all_rows, promotion = evaluate_v18_shadow(root, ledger)
            self.assertEqual(len(all_rows), 1)
            self.assertEqual(promotion, [])

    def test_buy_candidate_shadow_cohort_counts_for_gate_evidence(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "data/history").mkdir(parents=True)
            (root / "data/history/TEST.json").write_text(json.dumps(self.history()))
            ledger = {"entries": [self.contracted_entry()]}
            cohorts, _, promotion = evaluate_v18_shadow(root, ledger)
            self.assertEqual(len(promotion), 1)
            self.assertTrue(cohorts[0]["promotionResolved"])

    def test_complete_promotion_contract_passes(self):
        gate = _promotion_contract_gate({"entries": [self.contracted_entry()]}, 0.6)
        self.assertTrue(gate["passed"])
        self.assertEqual(gate["violations"], [])

    def test_missing_holding_policy_fails_contract(self):
        entry = self.contracted_entry()
        entry["executionPolicy"].pop("maxHoldingSessions")
        gate = _promotion_contract_gate({"entries": [entry]}, 0.6)
        self.assertFalse(gate["passed"])
        self.assertTrue(
            any("MISSING_FROZEN_HOLDING_POLICY" in item for item in gate["violations"])
        )


if __name__ == "__main__":
    unittest.main()
