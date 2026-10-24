import importlib.util
import pathlib
import sqlite3
import tempfile
import unittest
import csv

spec=importlib.util.spec_from_file_location("adjustment_proposals",pathlib.Path(__file__).with_name("adjustment_proposals.py"))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class AdjustmentSafetyTests(unittest.TestCase):
    def setup_fixture(self,tmp,day):
        base=pathlib.Path(tmp)
        db=base/"bars.sqlite"
        con=sqlite3.connect(db)
        con.execute("CREATE TABLE remote_price_candidates (symbol TEXT,session TEXT,branch TEXT,close REAL)")
        con.execute("INSERT INTO remote_price_candidates VALUES ('TEST',?,'main',100)",(day,))
        con.commit();con.close()
        csvpath=base/"events.csv"
        csvpath.write_text("symbol,ex_date,action_type,action_value\nTEST,2026-10-20,dividend,10\n",encoding="utf-8")
        return db,csvpath
    def test_near_event_close_stays_hypothetical(self):
        with tempfile.TemporaryDirectory() as td:
            db,events=self.setup_fixture(td,"2026-10-19")
            r=module.proposals(db,events,pathlib.Path(td)/"out")
            self.assertEqual(r["statuses"]["HYPOTHETICAL_NOT_VERIFIED"],1)
            self.assertEqual(r["adjustments_applied"],0)
    def test_stale_close_never_used(self):
        with tempfile.TemporaryDirectory() as td:
            db,events=self.setup_fixture(td,"2026-09-01")
            r=module.proposals(db,events,pathlib.Path(td)/"out")
            self.assertEqual(r["statuses"]["STALE_PRE_EVENT_CLOSE"],1)
            self.assertEqual(r["adjustments_applied"],0)
if __name__=="__main__":unittest.main()
