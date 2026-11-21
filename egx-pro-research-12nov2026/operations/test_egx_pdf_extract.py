"""Unit tests for geometry extraction. Golden PDF audit is documented separately."""
import unittest
from egx_pdf_extract import _extract_page, _number

class FakePage:
    def __init__(self,words): self.words=words
    def get_text(self,mode): assert mode=="words";return self.words

def w(x,y,text):return (x,y,x+max(5,len(text)*5),y+16,text,0,0,0)

class ParserTests(unittest.TestCase):
    def test_commas(self):
        self.assertEqual(_number("1,234,567"),1234567.0)
        self.assertIsNone(_number("invalid"))
    def test_multiline_names_and_currency(self):
        words=[
            w(24,101,"1"),w(42,94,"Ismailia"),w(90,94,"National"),
            w(42,108,"Food"),w(70,108,"Industries"),
            w(192,101,"EGP"),w(245,101,"162.060"),w(290,101,"178.25"),
            w(350,101,"155.51"),w(490,101,"157.500"),
            w(545,101,"-2.81"),w(575,101,"256,482,741"),w(700,101,"1,534,920"),
            w(24,141,"2"),w(42,141,"Naeem"),w(79,141,"Holding"),
            w(192,141,"USD"),w(245,141,"1.2"),w(290,141,"1.4"),
            w(350,141,"1.1"),w(490,141,"1.3"),w(545,141,"1.0"),
            w(575,141,"120,000"),w(700,141,"95,000")
        ]
        rows=_extract_page(FakePage(words),17)
        self.assertEqual([r["rank"] for r in rows],[1,2])
        self.assertEqual(rows[0]["name"],"Ismailia National Food Industries")
        self.assertEqual(rows[0]["close"],157.5)
        self.assertEqual(rows[1]["currency"],"USD")
        self.assertFalse(rows[0]["qualityIssues"])
    def test_real_19nov_value_column_x575_not_577(self):
        # Mirrors manual-importer.test.mjs: "actual EGX 19-Nov value column
        # starts at x=575, not 577" (commit 934435594a). Regression guard so
        # the two parsers cannot silently diverge again.
        words=[w(24,100,"1"),w(42,100,"Issuer"),w(192,100,"EGP"),w(240,100,"5"),
              w(290,100,"6"),w(350,100,"4"),w(491,100,"5.5"),w(545,100,"1"),
              w(575,100,"321,260,726"),w(644,100,"5.5%"),w(696,100,"8,265,248")]
        row=_extract_page(FakePage(words),17)[0]
        self.assertEqual(row["valueTraded"],321260726.0)
        self.assertEqual(row["volume"],8265248.0)
        self.assertNotIn("INVALID_valueTraded",row["qualityIssues"])
        self.assertNotIn("INVALID_volume",row["qualityIssues"])

    def test_bad_close_quarantined(self):
        words=[w(24,100,"1"),w(42,100,"Issuer"),w(192,100,"EGP"),w(240,100,"5"),
              w(290,100,"6"),w(350,100,"4"),w(491,100,"7"),w(545,100,"1"),
              w(575,100,"100,000"),w(701,100,"10,000")]
        row=_extract_page(FakePage(words),20)[0]
        self.assertIn("PRICE_RANGE_INCONSISTENT",row["qualityIssues"])

if __name__=="__main__":unittest.main()
