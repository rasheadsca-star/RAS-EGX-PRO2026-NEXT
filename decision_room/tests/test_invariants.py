"""Hard invariants: NO_STRATEGY_APPROVED, LIVE_READY=0, levels never shown, whatever the DB says."""
import unittest,tempfile,os,sys,json,pathlib,sqlite3,datetime,re
ROOT=str(pathlib.Path(__file__).resolve().parent.parent);sys.path.insert(0,ROOT);sys.path.insert(0,str(pathlib.Path(__file__).parent))
import fixtures as F
from egx_decision import snapshot,render
NOW=datetime.datetime(2026,10,30,9,tzinfo=datetime.timezone.utc)
class Inv(unittest.TestCase):
    def test_db_cannot_enable_live_or_levels(self):
        d=tempfile.mkdtemp();db=os.path.join(d,"t.sqlite");F.build(db,{"UPT":dict(close=F.series(140,20,0.004,0.003,5),paper=True)})
        c=sqlite3.connect(db);c.execute("update quality_gates set live_ready=1,paper_ready=1,research_ready=1");c.commit();c.close()
        s=snapshot.build(db,now=NOW)
        self.assertEqual((s["verdict"],s["strategy_approved"],s["live_execution_enabled"],s["live_ready"],s["paper_signals_generated"]),("NO_STRATEGY_APPROVED",False,False,0,0))
        for r in s["ranked"]+s["watchlist"]:
            lv=r["levels"];self.assertEqual(lv["status"],"UNAPPROVED_NO_TESTED_RULE");self.assertTrue(all(lv[k] is None for k in("entry","stop","target1","target2")))
        html=render.page(s);self.assertIn("NO_STRATEGY_APPROVED",html);self.assertNotIn("هدف أول",html)
        self.assertNotRegex(json.dumps(s),r'"(entry|stop|target1|target2)": [0-9]')
if __name__=="__main__":unittest.main()
