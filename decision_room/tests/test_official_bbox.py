import pathlib
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "tools"))
from official_bbox import extract_stocks, LayoutError, MAIN_EDGES, MAIN_EDGES_1525

class FakeRect:
    width = 1539
    height = 1088

class FakePage:
    def __init__(self, words, legacy=False):
        self.words = words
        self.rect = type("Rect", (), {"width": 1525 if legacy else 1539, "height": 1078 if legacy else 1088})()
    def get_text(self, kind, sort=False):
        if kind == "text":
            return "#\nStock Name\nCR\nOpen Price\n"
        assert kind == "words"
        return self.words

class FakeDoc:
    def __init__(self, page): self.pages = [page]
    def __iter__(self): return iter(self.pages)
    def close(self): pass

def make_words(duplicate=False, drop_close=False, legacy=False, rows=4):
    words = []
    def w(x0, x1, y, t, block):
        words.append((x0,y,x1,y+16,str(t),block,0,len(words)))
    w(42,70,270,"Stock",999);w(72,100,270,"Name",999)
    for i in range(rows):
        y = 325 + i*55
        rank = i+1 if not (duplicate and i==3) else 3
        block = 10 + i
        w(24.3,36.3,y,str(rank),block)
        if i == 1:
            # Wrapped company name centered around numeric row.
            w(42,100,y-7,"AJWA",block)
            w(103,160,y-7,"Industries",block)
            w(42,96,y+7,"company",block)
            w(99,142,y+7,"Egypt",block)
        else:
            w(42,130,y,"Company",block)
            w(133,145,y,str(i),block)
        w(192.2,214.9,y,"EGP",block)
        fields=["10.00","11.00","9.00","","","10.50","5.00",
                "100,000","1.0%","10,000","100"]
        if i==1:fields[0]="12.00"  # invalid OHLC, must quarantine
        if drop_close and i==2:fields[5]=""
        for col, (text, edge) in enumerate(zip(fields, MAIN_EDGES_1525 if legacy else MAIN_EDGES)):
            if text:
                w(edge-38,edge,y,text,block)
    return words

class BBoxStockTests(unittest.TestCase):
    def run_parser(self, **kwargs):
        legacy = kwargs.get("legacy",False)
        with patch("official_bbox.fitz.open", return_value=FakeDoc(FakePage(make_words(**kwargs), legacy=legacy))):
            return extract_stocks("fixture.pdf")

    def test_wrapped_name_without_neighbour_leakage(self):
        rows = self.run_parser()
        self.assertEqual(len(rows),4)
        self.assertEqual(rows[1]["name"], "AJWA Industries company Egypt")
        self.assertEqual(rows[0]["name"], "Company 0")
        self.assertEqual(rows[1]["status"],"CHECK")
        self.assertEqual(rows[0]["status"],"CANDIDATE")
        self.assertEqual(rows[0]["close"],10.5)
        self.assertEqual(rows[0]["volume"],10000)
        self.assertEqual(rows[0]["value_egp"],100000.0)

    def test_supported_legacy_1525x1078_report_layout(self):
        rows = self.run_parser(legacy=True)
        self.assertEqual(len(rows),4)
        self.assertEqual(rows[0]["open"],10.0)
        self.assertEqual(rows[0]["close"],10.5)
        self.assertEqual(rows[0]["volume"],10000)
        self.assertEqual(rows[1]["name"],"AJWA Industries company Egypt")

    def test_single_final_stock_row_not_silently_dropped(self):
        rows = self.run_parser(legacy=True, rows=1)
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]["market"],"MAIN")
        self.assertEqual(rows[0]["rank"],1)

    def test_missing_numeric_column_is_rejected(self):
        with self.assertRaisesRegex(LayoutError,"INCOMPLETE_ROW"):
            self.run_parser(drop_close=True)

    def test_duplicate_rank_is_rejected(self):
        with self.assertRaises(LayoutError):
            self.run_parser(duplicate=True)

if __name__ == "__main__":
    unittest.main()
