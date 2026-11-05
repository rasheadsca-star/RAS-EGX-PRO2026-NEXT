import json, pathlib, sqlite3, sys, tempfile, unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent.parent/"tools"))
import official_research_run as R

class QuarantineOnlyPipelineTests(unittest.TestCase):
    def test_quarantine_saves_evidence_but_never_runs_engine(self):
        with tempfile.TemporaryDirectory() as d:
            root=pathlib.Path(d)
            db=root/"original.sqlite"
            con=sqlite3.connect(db)
            con.execute("create table example(id integer)")
            con.execute("insert into example values (1)")
            con.commit();con.close()
            pdf=root/"official.pdf";pdf.write_bytes(b"%PDF-TEST-RESEARCH-ONLY")
            out=root/"new-output"
            original_hash=R.sha(db)
            parsed=dict(session="2026-11-02",pdf_sha256=R.sha(pdf),
                        items=[dict(name="Unverified Company",currency="EGP")],rows=1)
            mapped=dict(summary=dict(provisional=0),items=[dict(ticker=None)])
            with patch.object(R,"parse_pdf",return_value=parsed),\
                 patch.object(R,"inspect",return_value={"ok":True,"errors":[]}),\
                 patch.object(R,"resolve",return_value=mapped),\
                 patch.object(R,"merge",return_value={"outcome":"QUARANTINE_ONLY","inserted":0,"staged_rows":1}),\
                 patch.object(R.subprocess,"run",side_effect=AssertionError("Do not start engine")):
                result=R.run(pdf,db,"2026-11-02","2026-11-01",out)
            self.assertEqual(result["status"],"RESEARCH_QUARANTINE_ONLY")
            self.assertEqual(result["publication_status"],"WITHHELD")
            self.assertEqual(result["matched_provisional"],0)
            self.assertIsNone(result["generated_release"])
            self.assertEqual(R.sha(db),original_hash)
            self.assertFalse((out/"decision_room").exists())
            self.assertFalse((out/"FAILED_RESEARCH_RUN").exists())
            self.assertEqual(json.loads((out/"evidence.json").read_text())["reason"],"ZERO_APPROVABLE_TICKER_IDENTITIES")
            self.assertTrue((out/"symbol_resolution.json").exists())
            self.assertTrue((out/"merge_report.json").exists())

if __name__=="__main__":unittest.main()
