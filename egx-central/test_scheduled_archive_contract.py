import unittest
from pathlib import Path

class ScheduledResearchArchiveContract(unittest.TestCase):
    def test_calendar_reports_are_generated_and_backed_up(self):
        root=Path(__file__).resolve().parent.parent
        workflow=(root/".github/workflows/egx-central-scheduled-warehouse.yml").read_text()
        for report,script in [
            ("cumulative_weekend_report.json","cumulative_weekend_audit.py"),
            ("legacy_weekend_report.json","legacy_weekend_reconcile.py")]:
            self.assertIn("python egx-central/"+script,workflow)
            self.assertIn("cp artifacts/egx-central-scheduled/"+report+" research-backup/"+report,workflow)
            add_line=next(line for line in workflow.splitlines() if "git -C research-backup add " in line)
            self.assertIn(report,add_line)
    def test_calendar_quality_does_not_enable_trading(self):
        for file in ("cumulative_weekend_audit.py","legacy_weekend_reconcile.py"):
            content=(Path(__file__).parent/file).read_text()
            self.assertIn('"production_modified":False',content)
            self.assertIn('"certified_sessions":0',content) if file.startswith("legacy") else self.assertIn('"trading_eligible":False',content)

if __name__=="__main__":
    unittest.main()
