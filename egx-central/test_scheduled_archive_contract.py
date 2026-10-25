import unittest
from pathlib import Path

class ResearchAuditContract(unittest.TestCase):
    def test_calendar_reports_created_and_published_as_artifacts(self):
        root=Path(__file__).resolve().parent.parent
        workflow=(root/".github/workflows/egx-central-audited-import.yml").read_text()
        for report,script in [
            ("cumulative_weekend_report.json","cumulative_weekend_audit.py"),
            ("legacy_weekend_report.json","legacy_weekend_reconcile.py")]:
            self.assertIn("python egx-central/"+script,workflow)
            self.assertIn("artifacts/egx-central-audit/"+report,workflow)
        self.assertIn("actions/upload-artifact@v4",workflow)
        self.assertIn("path: artifacts/egx-central-audit/",workflow)

    def test_research_only_guards(self):
        for name in ("cumulative_weekend_audit.py","legacy_weekend_reconcile.py"):
            code=(Path(__file__).parent/name).read_text()
            self.assertIn('"production_modified":False',code)
            if name=="cumulative_weekend_audit.py":
                self.assertIn('"trading_eligible":False',code)
            else:
                self.assertIn('"v4a_eligible":False',code)

if __name__=="__main__":
    unittest.main()
