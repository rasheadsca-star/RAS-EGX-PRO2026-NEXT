"""Regression gates for physical V17 research warehouse."""
import gzip,importlib.util,json,sqlite3,tempfile,unittest
from pathlib import Path
P=Path(__file__).resolve().parents[1]/"scripts"/"research"/"merge_v17_research_warehouse.py"
spec=importlib.util.spec_from_file_location("v17merge",P);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class TestPhysicalMerge(unittest.TestCase):
 def test_real_price_conflict_is_quarantined(self):
  with tempfile.TemporaryDirectory() as root:
   p=Path(root);main=p/"main";ledger=p/"ledger";out=p/"out"
   main.mkdir();(ledger/"raw-long-history-gzip").mkdir(parents=True)
   (ledger/"raw-long-history-quality.json").write_text(json.dumps({"stocks":[{"ticker":"AAA","researchHistoryCandidate":True}]}))
   (main/"AAA.json").write_text(json.dumps({"ticker":"AAA","sessions":[{"date":"2026-10-29","open":10,"high":12,"low":9,"close":11,"volume":100}]}))
   gzdoc={"ticker":"AAA","source":"YAHOO_CHART_API","dataQualityStatus":"VALID","symbolIdentity":{"verified":True},"sessions":[{"date":"2026-10-29","open":10,"high":12,"low":9,"close":10,"volume":100},{"date":"2026-10-28","open":9,"high":11,"low":8,"close":10,"volume":100}]}
   (ledger/"raw-long-history-gzip"/"AAA.json.gz").write_bytes(gzip.compress(json.dumps(gzdoc).encode()))
   result=m.run(main,ledger,out)
   self.assertEqual(result["conflict_sessions"],1)
   self.assertEqual(result["research_sessions"],1)
   con=sqlite3.connect(out/"egx_merged_research.sqlite")
   self.assertEqual(con.execute("select count(*) from accepted_research where trade_eligible=1").fetchone()[0],0)
   self.assertEqual(con.execute("select date from conflicts").fetchone()[0],"2026-10-29")
   self.assertEqual(con.execute("pragma integrity_check").fetchone()[0],"ok")
if __name__=="__main__":unittest.main()
