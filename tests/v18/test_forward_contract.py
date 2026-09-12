import unittest

from scripts.v18.forward import freeze, verify_ledger, EXECUTION_POLICY_VERSION


class ForwardContractTests(unittest.TestCase):
    def current(self, last_session="2026-08-31"):
        return {
            "artifactHash": "artifact-1",
            "model": {"id": "softmax-baseline-1"},
            "recommendations": [
                {
                    "ticker": "AAA",
                    "signalDate": "2026-08-31",
                    "decision": "BUY_CANDIDATE",
                    "entryLow": 10.0,
                    "entryHigh": 10.2,
                    "stop": 9.6,
                    "target": 10.8,
                    "pTargetBeforeStop": 0.61,
                    "pStopBeforeTarget": 0.2,
                    "pTimeExit": 0.1,
                    "pNoEntry": 0.09,
                    "expectedValue": 0.7,
                    "targetRealistic": True,
                    "stopRealistic": True,
                    "modelVersion": "v18-probability-baseline-1",
                    "featureVersion": "v18-features-1",
                },
                {
                    "ticker": "BBB",
                    "signalDate": "2026-08-31",
                    "decision": "WAIT",
                    "entryLow": 20.0,
                    "entryHigh": 20.2,
                    "stop": 19.2,
                    "target": 21.0,
                    "pTargetBeforeStop": 0.51,
                    "pStopBeforeTarget": 0.22,
                    "pTimeExit": 0.16,
                    "pNoEntry": 0.11,
                    "expectedValue": 0.2,
                    "targetRealistic": True,
                    "stopRealistic": True,
                    "modelVersion": "v18-probability-baseline-1",
                    "featureVersion": "v18-features-1",
                },
            ],
            "dataReadiness": [
                {"ticker": "AAA", "lastSession": last_session},
                {"ticker": "BBB", "lastSession": last_session},
            ],
        }

    def test_freeze_adds_explicit_contract_without_production_authority(self):
        snapshot, ledger = freeze(self.current(), {"entries": []})
        self.assertEqual(snapshot["executionPolicy"]["version"], EXECUTION_POLICY_VERSION)
        self.assertEqual(snapshot["executionPolicy"]["maxHoldingSessions"], 1)
        self.assertEqual(snapshot["executionPolicy"]["transactionCostPct"], 0.6)
        self.assertEqual(snapshot["portfolioAllocationPolicy"]["method"], "EQUAL_WEIGHT_BUY_CANDIDATES")
        self.assertEqual(snapshot["portfolioAllocationPolicy"]["candidateTickers"], ["AAA"])
        self.assertEqual(snapshot["portfolioAllocationPolicy"]["weightPctPerCandidate"], 100.0)
        self.assertTrue(snapshot["sourceSessionEvidence"]["allSelectionsAligned"])
        self.assertTrue(snapshot["modelLineage"]["explicitlyLinked"])
        self.assertFalse(snapshot["productionAuthority"])
        self.assertFalse(snapshot["automaticOrders"])
        self.assertTrue(verify_ledger(ledger))

    def test_freeze_fails_closed_on_stale_selected_session(self):
        with self.assertRaisesRegex(ValueError, "SOURCE_SESSION_ALIGNMENT_REQUIRED"):
            freeze(self.current(last_session="2026-08-30"), {"entries": []})


if __name__ == "__main__":
    unittest.main()
