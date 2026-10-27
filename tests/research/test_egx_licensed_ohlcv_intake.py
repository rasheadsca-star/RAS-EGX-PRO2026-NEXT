import csv,json,pathlib,tempfile,unittest
from importlib.machinery import SourceFileLoader
mod=SourceFileLoader("egx_licensed_ohlcv","scripts/research/egx-licensed-ohlcv-intake.py").load_module()
class IntakeTests(unittest.TestCase):
    def setUp(self):
        self.record={"ticker":"COMI","isin":"EGS60121C018","currency":"EGP",
         "date":"2026-10-26","open":"105.0","high":"108.0","low":"104.0",
         "close":"107.0","volume":"4231200","source":"EGID_LICENSED",
         "source_url":"https://example.com/egid/date26","source_session_date":"2026-10-26",
         "final_eod":"YES","license_ref":"test-terms-license-acceptance",
         "corporate_action_status":"CONFIRMED_NONE","second_source":"ICE_LICENSED",
         "second_source_url":"https://example.com/ice/date26","second_session_date":"2026-10-26",
         "second_close":"107.0"}
        self.mapped={"COMI":{"ticker":"COMI","currency":"EGP","isin":"EGS60121C018","symbolVerified":True,"active":True}}
    def test_only_complete_correlated_eod_source_may_be_review_ready(self):
        status,reject,hold=mod.examine(self.record,self.mapped,"2026-10-26")
        self.assertEqual((status,reject,hold),("REVIEW_READY",[],[]))
    def test_unknown_issuer_wrong_currency_or_future_dated_bar_fails(self):
        for patch in [{"ticker":"BOGUS"},{"currency":"USD"},{"date":"2026-10-27"},
          {"source_session_date":"2026-10-25"},{"high":"100"},{"volume":"4.7M"},
          {"final_eod":"NO"},{"date":"2026-10-23","source_session_date":"2026-10-23"}]:
            status,*_=mod.examine({**self.record,**patch},self.mapped,"2026-10-26")
            self.assertEqual(status,"REJECTED",patch)
    def test_unconfirmed_identity_and_second_source_are_held(self):
        s,_,hold=mod.examine(self.record,{"COMI":{"ticker":"COMI","active":True,"currency":"EGP","isin":None,"symbolVerified":False}},"2026-10-26")
        self.assertEqual(s,"HOLD")
        self.assertIn("ISIN_LISTING_CONFIRMATION_REQUIRED",hold)
        self.assertIn("EXISTING_CANONICAL_SYMBOL_IDENTITY_UNVERIFIED",hold)
        s,_,hold=mod.examine({**self.record,"second_source":"EGID_LICENSED"},self.mapped,"2026-10-26")
        self.assertEqual(s,"HOLD")
        self.assertIn("INDEPENDENT_SECOND_SOURCE_EXACT_SESSION_REQUIRED",hold)
        s,_,hold=mod.examine({**self.record,"corporate_action_status":"UNKNOWN"},self.mapped,"2026-10-26")
        self.assertEqual(s,"HOLD")
    def test_no_csv_stages_template_and_detects_59_real_gaps(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp)
            (root/"data").mkdir()
            (root/"data/symbol-map.json").write_text(json.dumps({
                "COMI":{"ticker":"COMI","active":True,"currency":"EGP"},
                "BONY":{"ticker":"BONY","active":True,"currency":"EGP"},
                "BLOCKS":{"ticker":"BLOCKS","active":False}}))
            (root/"data/history-summary.json").write_text(json.dumps({"symbols":[
                {"ticker":"COMI","availableSessions":100,"lastSession":"2026-10-26","symbolVerified":True},
                {"ticker":"BONY","availableSessions":0,"symbolVerified":False,"lastUpdateError":"Yahoo HTTP 404"}]}))
            (root/"data/stable").mkdir()
            (root/"data/stable/v15-price-truth.json").write_text(json.dumps({
                "expectedSession":"2026-10-26","ready":False,"acceptedRows":0,"missingHistoryFiles":[]}))
            o=pathlib.Path(tmp)/"out"
            result=mod.intake(root,o)
            self.assertEqual(result["requestCount"],1)
            self.assertEqual(result["automaticallyPromoted"],0)
            with (o/"licensed-provider-gap-request.csv").open(encoding="utf-8-sig") as f:
                rows=list(csv.DictReader(f))
            self.assertEqual(rows[0]["ticker"],"BONY")
            self.assertFalse(any(x["ticker"]=="BLOCKS" for x in rows))
    def test_duplicates_and_no_provenance_do_not_escape_quarantine(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=pathlib.Path(tmp);(root/"data/stable").mkdir(parents=True)
            (root/"data/symbol-map.json").write_text(json.dumps(self.mapped))
            (root/"data/history-summary.json").write_text(json.dumps({"symbols":[]}))
            (root/"data/stable/v15-price-truth.json").write_text(json.dumps({"expectedSession":"2026-10-26"}))
            f=root/"vendor.csv"
            with f.open("w",newline="") as out:
                w=csv.DictWriter(out,fieldnames=mod.HEADERS);w.writeheader()
                w.writerow(self.record);w.writerow(self.record)
            result=mod.intake(root,root/"out",f)
            self.assertEqual(result["received"],2)
            self.assertEqual(result["reviewReady"],1)
            self.assertEqual(result["rejected"],1)
            self.assertTrue(all(x["promotionApproved"] is False for x in result["records"]))
if __name__=="__main__":unittest.main()
