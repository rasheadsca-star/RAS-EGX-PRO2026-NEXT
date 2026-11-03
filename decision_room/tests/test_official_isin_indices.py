import pathlib,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent/"tools"))
from official_isin_indices import parse,build,ExtractError
URL="https://beta.egx.com.eg/en/market/indices/constituents?index=CASE30"
HTML="""<html><table><tr><th>ISIN</th><th>Reuters Code</th><th>Company</th><th>Weight %</th></tr>
<tr><td>EGS60121C018</td><td>COMI.CA</td><td>Commercial International Bank-Egypt (CIB)</td><td>30.5%</td></tr>
<tr><td>EGS48031C016</td><td>ETEL.CA</td><td>Telecom Egypt</td><td>7.83%</td></tr></table></html>"""
class OfficialIsinIndicesTests(unittest.TestCase):
    def test_extract_realistic_official_index_table(self):
        r=parse(HTML,URL,"2026-11-03")
        self.assertEqual([(x["ticker"],x["isin"]) for x in r],
                         [("COMI","EGS60121C018"),("ETEL","EGS48031C016")])
    def test_cross_index_duplicate_deduplicated_not_approved(self):
        other="https://beta.egx.com.eg/en/market/indices/constituents?index=EGX70"
        x=build([("CASE30",URL,HTML.encode()),("EGX70",other,HTML.encode())],"2026-11-03")
        self.assertEqual(x["provenance"]["entries"],2)
        self.assertEqual(x["provenance"]["sources"][0]["rows"],2)
        self.assertFalse(x["provenance"]["independent_symbol_approval"])
        self.assertFalse(x["provenance"]["history_asof_proved"])
    def test_reject_conflicting_cross_index_isin(self):
        conflicting=HTML.replace("ETEL.CA","COMI.CA")
        with self.assertRaisesRegex(ExtractError,"CROSS_INDEX_IDENTITY_CONFLICT"):
            build([("CASE30",URL,HTML.encode()),("EGX70","https://beta.egx.com.eg/en/market/indices/constituents?index=EGX70",conflicting.encode())],"2026-11-03")
    def test_protect_official_domain(self):
        with self.assertRaisesRegex(ExtractError,"SOURCE_DOMAIN_NOT_OFFICIAL"):
            parse(HTML,"https://egx.com.eg.evil.example/en/market/indices/constituents?index=CASE30","2026-11-03")
    def test_incorrect_isin_checkdigit_fails(self):
        with self.assertRaisesRegex(ExtractError,"INVALID_ISIN_CHECK_DIGIT"):
            parse(HTML.replace("EGS60121C018","EGS60121C019"),URL,"2026-11-03")
    def test_no_table_fails_closed(self):
        with self.assertRaisesRegex(ExtractError,"NO_OFFICIAL_ISIN_REUTERS_TABLE"):
            parse("<html>loading...</html>",URL,"2026-11-03")

if __name__=="__main__":unittest.main()
