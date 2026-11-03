"""Regression: main EGX PRO route must not silently redirect to an older V4 archive."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[2]
class RootRouteTests(unittest.TestCase):
    def test_home_is_current_source_dashboard_not_old_archive_redirect(self):
        html=(ROOT/"index.html").read_text(encoding="utf-8")
        self.assertNotIn('http-equiv="refresh"',html)
        self.assertNotIn("location.replace('./paper-v4/index.html')",html)
        self.assertIn("raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/main/",html)
        self.assertIn("data/quant/daily-recommendations.json",html)
        self.assertIn("data/stable/v16-main-app-current.json",html)
        self.assertIn("data/source-health.json",html)
        self.assertIn("NO_STRATEGY_APPROVED",html)
        self.assertIn("2026-11-02",html)
    def test_archive_is_clear_and_separate(self):
        html=(ROOT/"index.html").read_text(encoding="utf-8")
        self.assertIn('<a href="./paper-v4/index.html">أرشيف مستقل:',html)
        self.assertIn("لا يتم اعتماد هوية أي سهم",html)
        self.assertIn("تاريخ السهم مختلف — محجوب",html)
    def test_no_fallback_to_unverified_prices_on_source_error(self):
        html=(ROOT/"index.html").read_text(encoding="utf-8")
        self.assertIn("فشل جلب أحدث ملفات البيانات",html)
        self.assertIn("فشل التحميل — لا نعرض بيانات قديمة بديلة",html)
        self.assertIn("cache:'no-store'",html)
if __name__=="__main__":unittest.main()
