import pathlib,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent/"tools"))
from egx_identity_reference import check,isin_valid

def fixture():
    return {"ticker":"ALXD","isin":"EGS66DU1C015",
            "name":"Alexandria For Investment and Urban Development",
            "source_url":"https://beta.egx.com.eg/en/news/293969",
            "effective_from":"2026-08-26"}

class IsinCrosswalkTest(unittest.TestCase):
    def test_real_egx_isin_checkdigit(self):
        self.assertTrue(isin_valid("EGS66DU1C015"))
        self.assertFalse(isin_valid("EGS66DU1C016"))
        self.assertFalse(isin_valid("US0378331005"))
    def test_official_listing_announcement_still_requires_reviewer(self):
        r=check([fixture()],"2026-11-02")
        self.assertEqual(r["format_pass"],1)
        self.assertFalse(r["identity_approved"])
        self.assertFalse(r["source_authenticated"])
        self.assertFalse(r["may_mark_alias_verified"])
    def test_reject_other_domain_even_with_official_word(self):
        row={**fixture(),"source_url":"https://egx.com.eg.evil.example/notice"}
        r=check([row],"2026-11-02")
        self.assertIn("SOURCE_NOT_OFFICIAL_EGX_DOMAIN",r["items"][0]["reasons"])
    def test_reject_future_effective_date(self):
        r=check([{**fixture(),"effective_from":"2026-12-01"}],"2026-11-02")
        self.assertIn("EFFECTIVE_DATE_AFTER_ASOF",r["items"][0]["reasons"])
    def test_isin_conflict(self):
        b={**fixture(),"ticker":"FAKE"}
        r=check([fixture(),b],"2026-11-02")
        self.assertIn("ISIN_WITH_MULTIPLE_TICKERS",r["items"][1]["reasons"])
    def test_ticker_conflict(self):
        b={**fixture(),"isin":"EGS691L1C018"}
        r=check([fixture(),b],"2026-11-02")
        self.assertIn("TICKER_WITH_MULTIPLE_ISINS",r["items"][1]["reasons"])
    def test_missing_name(self):
        r=check([{**fixture(),"name":""}],"2026-11-02")
        self.assertIn("EMPTY_COMPANY_NAME",r["items"][0]["reasons"])
if __name__=="__main__":
    unittest.main()
