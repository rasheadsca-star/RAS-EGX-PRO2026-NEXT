import unittest,tempfile,os,sys,json,pathlib,sqlite3,datetime,copy
import numpy as np,pandas as pd
ROOT=str(pathlib.Path(__file__).resolve().parent.parent);sys.path.insert(0,ROOT);sys.path.insert(0,str(pathlib.Path(__file__).parent))
import fixtures as F
from egx_decision import snapshot,journal,regime,ingest,config as K
from egx_decision.quality import evaluate,waterfall
NOW=datetime.datetime(2026,10,30,12,tzinfo=datetime.timezone.utc)
def mk(extra=None,**kw):
    d=tempfile.mkdtemp();p=os.path.join(d,"t.sqlite");cal=F.build(p,extra,**kw);return p,cal
def up(n=140,seed=5):return F.series(n,20,0.004,0.003,seed)
def down(n=140,seed=6):return F.series(n,20,-0.004,0.003,seed)
class Gate(unittest.TestCase):
    def snap(self,extra,**kw):
        p,cal=mk(extra,**kw);return snapshot.build(p,now=NOW),cal
    def reasons(self,s,t):
        for b in s["blocked"]:
            if b["ticker"]==t:return " | ".join(b["reasons"])
        return None
    def test_clean_uptrend_is_ranked_and_levels_disabled(self):
        s,_=self.snap({"UPT":dict(close=up())})
        self.assertIn("UPT",[r["ticker"] for r in s["ranked"]])
        r=[x for x in s["ranked"] if x["ticker"]=="UPT"][0]
        self.assertEqual(r["rank"],1);self.assertIsNone(r["levels"]["entry"]);self.assertEqual(r["levels"]["status"],"UNAPPROVED_NO_TESTED_RULE")
        self.assertFalse(s["strategy_approved"]);self.assertFalse(s["live_execution_enabled"]);self.assertEqual(s["verdict"],"NO_STRATEGY_APPROVED")
    def test_downtrend_goes_to_watchlist_not_ranked_even_with_score(self):
        s,_=self.snap({"DWN":dict(close=down())})
        self.assertNotIn("DWN",[r["ticker"] for r in s["ranked"]]);self.assertIn("DWN",[r["ticker"] for r in s["watchlist"]])
        self.assertTrue(all(r["rank"] is None for r in s["watchlist"]))
    def test_stale_ticker_blocked(self):
        s,_=self.snap({"OLD":dict(close=up(),last_n=132)});self.assertIn("STALE",self.reasons(s,"OLD"))
        self.assertNotIn("OLD",[r["ticker"] for r in s["ranked"]+s["watchlist"]])
    def test_zero_volume_flat_price_never_listed(self):
        s,_=self.snap({"DEAD":dict(close=np.full(140,5.0),volume=0.0)})
        r=self.reasons(s,"DEAD");self.assertIn("NO_TRADING",r);self.assertIn("FLAT_PRICE",r)
        self.assertIn("LIQUIDITY",r)
        self.assertNotIn("DEAD",[x["ticker"] for x in s["ranked"]+s["watchlist"]])
    def test_adv_threshold_exact(self):
        c=np.full(140,10.0)+np.linspace(0,1,140)
        lo,hi=F.sessions(),None
        s,_=self.snap({"LOWADV":dict(close=up(),volume=1000.0),"OKADV":dict(close=up(seed=8),volume=1_000_000/20.0*1.0*1.0+2e5)})
        self.assertIn("LIQUIDITY",self.reasons(s,"LOWADV"))
        self.assertIsNone(self.reasons(s,"OKADV")) if self.reasons(s,"OKADV") is None else self.assertNotIn("LIQUIDITY",self.reasons(s,"OKADV"))
    def test_calendar_gap_last20_with_and_without_conflict(self):
        cal=F.sessions()
        s,_=self.snap({"GAPC":dict(close=up(),drop_dates=[cal[-5]],conflict_dates=[cal[-5]]),"GAPN":dict(close=up(seed=9),drop_dates=[cal[-6]])})
        self.assertIn("CALENDAR_GAP",self.reasons(s,"GAPC"));self.assertIn("تعارض",self.reasons(s,"GAPC"))
        self.assertIn("لا توجد ملاحظة",self.reasons(s,"GAPN"))
    def test_conflict_inside_window_blocks(self):
        cal=F.sessions();s,_=self.snap({"CNF":dict(close=up(),conflict_dates=[cal[-30]])});self.assertIn("CONFLICT",self.reasons(s,"CNF"))
    def test_old_conflict_outside_window_does_not_block(self):
        cal=F.sessions();s,_=self.snap({"OLDC":dict(close=up(),conflict_dates=[cal[5]])});self.assertIsNone(self.reasons(s,"OLDC"))
    def test_corporate_action_in_window_blocks_old_does_not(self):
        cal=F.sessions()
        s,_=self.snap({"CA1":dict(close=up(),corp=[(cal[-10],"REVIEW_REQUIRED")]),"CA2":dict(close=up(seed=3),corp=[(cal[3],"REVIEW_REQUIRED")])})
        self.assertIn("CORPORATE_ACTION",self.reasons(s,"CA1"));self.assertIsNone(self.reasons(s,"CA2"))
    def test_unresolved_jump_blocks(self):
        c=up().copy();c[120:]*=0.7
        s,_=self.snap({"JMP":dict(close=c)});self.assertIn("JUMP",self.reasons(s,"JMP"))
    def test_missing_columns_fail_loudly(self):
        p,_=mk({"X":dict(close=up())},drop_col=("conflicts","resolution"))
        with self.assertRaisesRegex(ingest.DataError,"missing columns"):snapshot.build(p,now=NOW)
    def test_missing_table_and_corrupt_db(self):
        d=tempfile.mkdtemp();p=os.path.join(d,"x.sqlite");open(p,"wb").write(b"not a database")
        with self.assertRaises(Exception):snapshot.build(p,now=NOW)
        with self.assertRaisesRegex(ingest.DataError,"not found"):snapshot.build(os.path.join(d,"nope.sqlite"),now=NOW)
    def test_future_session_refused(self):
        p,_=mk({"X":dict(close=up())},end="2026-11-20")
        with self.assertRaisesRegex(ingest.DataError,"future"):snapshot.build(p,now=NOW)
    def test_all_blocked_gives_empty_state_without_error(self):
        ex={f"Z{k:02d}":dict(close=np.full(140,5.0),volume=0.0) for k in range(55)}
        p,_=mk(ex,filler=0);s=snapshot.build(p,now=NOW)
        self.assertEqual(s["ranked"],[]);self.assertEqual(s["watchlist"],[]);self.assertEqual(len(s["blocked"]),55);self.assertEqual(s["counts"]["passed"],0)
        from egx_decision import render
        html=render.page(s);self.assertIn("لا فرص اليوم",html)
    def test_h1_unknown_when_history_short(self):
        p,_=mk({"X":dict(close=up(n=115))},n=115)
        s=snapshot.build(p,now=NOW);self.assertEqual(s["market"]["state"],"UNKNOWN")
    def test_h1_external_validation(self):
        ok={"latest_benchmark_session":"2026-10-29","status":K.H1_STATUS_ALLOWED,"signal_at_last_close":"CASH"}
        self.assertEqual(regime.validate_external(ok,"2026-10-29"),"CASH")
        self.assertEqual(regime.validate_external(ok,"2026-10-28"),"UNKNOWN")
        self.assertEqual(regime.validate_external({**ok,"signal_at_last_close":"BUY_EVERYTHING"},"2026-10-29"),"UNKNOWN")
        self.assertEqual(regime.validate_external({**ok,"status":"APPROVED"},"2026-10-29"),"UNKNOWN")
    def test_h1_matches_reference_formula(self):
        p,cal=mk({"X":dict(close=up())});data=ingest.load(p);h=regime.compute(data,cal[-1].date().isoformat())
        b=data["bars"];c=b.pivot(index="date",columns="ticker",values="close").reindex(data["calendar"]);v=b.pivot(index="date",columns="ticker",values="volume").reindex(data["calendar"])
        adv=(c*v).rolling(20,min_periods=20).mean();el=adv.shift(1)>=1e6
        r=c.pct_change(fill_method=None).where(el).clip(-.11,.11).mean(axis=1).fillna(0);L=(1+r).cumprod()
        self.assertAlmostEqual(h["index_level"],round(float(L.iloc[-1]),4),places=4)
        self.assertEqual(h["state"],"IN_MARKET" if L.iloc[-1]>L.rolling(100).mean().iloc[-1] else "CASH")
        self.assertFalse(h["orders_enabled"])
class Json(unittest.TestCase):
    def test_null_names_do_not_break_json(self):
        p,_=mk({"UPT":dict(close=up())});con=sqlite3.connect(p);con.execute("update symbol_identity set name_en=NULL,name_ar=NULL where ticker='UPT'");con.commit();con.close()
        s=snapshot.build(p,now=NOW);json.loads(json.dumps(s,allow_nan=False))
        self.assertEqual([r for r in s["ranked"] if r["ticker"]=="UPT"][0]["name"],"")
class NoLookAhead(unittest.TestCase):
    def test_future_bars_do_not_change_past_snapshot(self):
        p,cal=mk({"UPT":dict(close=up(160))},n=160)
        asof=cal[-12].date().isoformat()
        a=snapshot.build(p,now=NOW+datetime.timedelta(days=30),asof=asof)
        # same data truncated physically at asof
        con=sqlite3.connect(p);con.execute("delete from canonical_bars where date>?",(asof,));con.commit();con.close()
        b=snapshot.build(p,now=NOW+datetime.timedelta(days=30))
        self.assertEqual(a["content_sha256"],b["content_sha256"])
class Journal(unittest.TestCase):
    def setUp(self):self.p=os.path.join(tempfile.mkdtemp(),"j.jsonl")
    def test_idempotent_and_refuses_retroactive(self):
        c={"a":1};self.assertEqual(journal.append(self.p,"2026-10-29",c),"APPENDED");self.assertEqual(journal.append(self.p,"2026-10-29",c),"UNCHANGED")
        with self.assertRaises(journal.JournalError):journal.append(self.p,"2026-10-29",{"a":2})
        self.assertEqual(len(journal.read(self.p)),1);self.assertTrue(journal.verify(self.p))
    def test_older_session_refused_and_chain_detects_tamper(self):
        journal.append(self.p,"2026-10-29",{"a":1});journal.append(self.p,"2026-11-01",{"a":2})
        with self.assertRaises(journal.JournalError):journal.append(self.p,"2026-10-30",{"a":3})
        t=pathlib.Path(self.p).read_text().replace('"a": 1','"a": 9');pathlib.Path(self.p).write_text(t)
        self.assertFalse(journal.verify(self.p))
    def test_rerun_of_same_snapshot_is_noop(self):
        p,_=mk({"UPT":dict(close=up())})
        s1=snapshot.build(p,now=NOW);s2=snapshot.build(p,now=NOW+datetime.timedelta(hours=3))
        self.assertEqual(s1["content_sha256"],s2["content_sha256"])
        journal.append(self.p,s1["source_session"],snapshot.decision_facts(s1))
        self.assertEqual(journal.append(self.p,s2["source_session"],snapshot.decision_facts(s2)),"UNCHANGED")
class Waterfall(unittest.TestCase):
    def test_counts_add_up(self):
        p,cal=mk({"OLD":dict(close=up(),last_n=130),"DEAD":dict(close=np.full(140,5.0),volume=0.0),"UPT":dict(close=up(seed=4))})
        d=ingest.load(p);res,nb,s=evaluate(d);w=waterfall(res,nb)
        self.assertEqual(w["passed"]+w["blocked"],w["with_bars"]);self.assertEqual(w["registry_symbols"],w["with_bars"]+w["without_any_bar"])
        self.assertEqual(sum(w["first_blocking_reason"].values()),w["blocked"])
class Pipeline(unittest.TestCase):
    def test_ok_then_rerun_unchanged_and_failure_keeps_old_files(self):
        import run_daily
        p,_=mk({"UPT":dict(close=up())});out=tempfile.mkdtemp();j=os.path.join(out,"j.jsonl")
        self.assertEqual(run_daily.main(["--db",p,"--out",out,"--journal",j,"--now",NOW.isoformat()]),0)
        h=json.load(open(os.path.join(out,"job_health.json")));self.assertEqual(h["status"],"OK");self.assertEqual(h["journal"],"APPENDED")
        self.assertEqual(run_daily.main(["--db",p,"--out",out,"--journal",j,"--now",(NOW+datetime.timedelta(hours=2)).isoformat()]),0)
        self.assertEqual(json.load(open(os.path.join(out,"job_health.json")))["journal"],"UNCHANGED")
        self.assertEqual(len(journal.read(j)),1)
        with open(os.path.join(out,"decision_snapshot.json")) as fh:before=fh.read()
        self.assertEqual(run_daily.main(["--db",os.path.join(out,"missing.sqlite"),"--out",out,"--journal",j,"--now",NOW.isoformat()]),2)
        with open(os.path.join(out,"decision_snapshot.json")) as fh:self.assertEqual(fh.read(),before)
        self.assertEqual(json.load(open(os.path.join(out,"job_health.json")))["status"],"FAILED")

if __name__=="__main__":unittest.main(verbosity=2)
