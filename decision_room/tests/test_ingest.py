"""Ingestion tests: happy path, idempotence, validation rejects, revision conflict, partial scrape, crash/atomicity, engine integration."""
import unittest,tempfile,os,sys,json,pathlib,sqlite3,hashlib,datetime
ROOT=str(pathlib.Path(__file__).resolve().parent.parent);sys.path.insert(0,ROOT);sys.path.insert(0,str(pathlib.Path(__file__).parent))
import fixtures as F
import ingest_daily as I
from egx_decision import snapshot
TODAY=datetime.date(2026,11,2)
def sha(p):
    with open(p,"rb") as f:return hashlib.sha256(f.read()).hexdigest()
def bar(t,d,c,**kw):
    r=dict(ticker=t,date=d,sourceSessionDate=d,open=c*0.998,high=c*1.004,low=c*0.996,close=c,volume=6e6,currency="EGP");r.update(kw);return r
class Base(unittest.TestCase):
    FILLER=10
    def setUp(self):
        self.d=tempfile.mkdtemp();self.db=os.path.join(self.d,"c.sqlite")
        self.cal=F.build(self.db,{"UPT":dict(close=F.series(140,20,0.004,0.003,3))},filler=self.FILLER)   # last 2026-10-29 (Thu)
        self.src=pathlib.Path(self.d)/"hist";self.src.mkdir()
        con=sqlite3.connect(self.db);self.tick=[r[0] for r in con.execute("select ticker from symbol_identity")];
        self.lastc={t:con.execute("select close from canonical_bars where ticker=? order by date desc limit 1",(t,)).fetchone()[0] for t in self.tick};con.close()
    def write(self,t,sessions):(self.src/f"{t}.json").write_text(json.dumps(dict(ticker=t,sessions=sessions)))
    def all_new(self,date="2026-11-01",skip=()):
        for t in self.tick:
            if t in skip:continue
            self.write(t,[bar(t,"2026-10-29",self.lastc[t]),bar(t,date,self.lastc[t]*1.01)])
    def q(self,sql,*a):
        c=sqlite3.connect(self.db);r=c.execute(sql,a).fetchall();c.close();return r
class Ingest(Base):
    def test_happy_path_and_provenance(self):
        self.all_new();rep=I.ingest(self.src,self.db,TODAY)
        self.assertEqual(rep["status"],"UPDATED");self.assertEqual(rep["inserted"],len(self.tick))
        self.assertEqual(self.q("select max(date) from canonical_bars")[0][0],"2026-11-01")
        self.assertEqual(self.q("select distinct evidence_tier from canonical_bars where date='2026-11-01'"),[("SINGLE_PROVIDER",)])
        self.assertEqual(self.q("select count(*) from raw_observations where date='2026-11-01' and row_ref like 'sha256:%'")[0][0],len(self.tick))
        self.assertEqual(len(self.q("select key from audit_metadata where key like 'ingest_%'")),1)
        self.assertTrue(os.path.exists(self.db+".prev"))
    def test_idempotent_noop(self):
        self.all_new();I.ingest(self.src,self.db,TODAY);h=sha(self.db)
        rep=I.ingest(self.src,self.db,TODAY);self.assertEqual(rep["status"],"NOOP");self.assertEqual(sha(self.db),h)
    def test_history_never_rewritten(self):
        before=self.q("select * from canonical_bars where date<='2026-10-29' order by ticker,date")
        self.all_new();I.ingest(self.src,self.db,TODAY)
        self.assertEqual(before,self.q("select * from canonical_bars where date<='2026-10-29' order by ticker,date"))
    def test_validation_rejects_counted(self):
        self.all_new(skip=("UPT",))
        t="UPT";c=self.lastc[t]
        self.write(t,[bar(t,"2026-11-01",c,close=-1),bar(t,"2026-11-03",c)])  # negative + future (today=11-02)
        rep=I.ingest(self.src,self.db,TODAY)
        self.assertEqual(rep["rejected"].get("NON_POSITIVE_PRICE"),1);self.assertEqual(rep["rejected"].get("FUTURE_DATE"),1)
        self.assertEqual(self.q("select count(*) from canonical_bars where ticker='UPT' and date>'2026-10-29'")[0][0],0)
    def test_reject_reasons(self):
        t="UPT";c=10.0
        cases={"NON_TRADING_WEEKDAY":bar(t,"2026-10-30",c),"OHLC_INCONSISTENT":bar(t,"2026-11-01",c,high=c*0.9),
               "SESSION_DATE_MISMATCH":bar(t,"2026-11-01",c,sourceSessionDate="2026-10-29"),"NEGATIVE_VOLUME":bar(t,"2026-11-01",c,volume=-5),
               "NON_NUMERIC_CLOSE":bar(t,"2026-11-01",c,close="x"),"NON_NUMERIC_VOLUME":bar(t,"2026-11-01",c,volume=float("nan")),"CURRENCY":bar(t,"2026-11-01",c,currency="USD"),"BAD_DATE":bar(t,"nope",c)}
        for k,r in cases.items():self.assertEqual(I.validate_row(r,t,TODAY),k,k)
        self.assertIsNone(I.validate_row(bar(t,"2026-11-01",c),t,TODAY))
    def test_revision_flagged_not_applied(self):
        self.all_new()
        t="UPT";self.write(t,[bar(t,"2026-10-29",self.lastc[t]*1.05),bar(t,"2026-11-01",self.lastc[t])])
        keep=self.q("select close from canonical_bars where ticker='UPT' and date='2026-10-29'")
        rep=I.ingest(self.src,self.db,TODAY);self.assertEqual(rep["revisions_new"],1)
        self.assertEqual(keep,self.q("select close from canonical_bars where ticker='UPT' and date='2026-10-29'"))
        self.assertEqual(self.q("select kind,resolution from conflicts where ticker='UPT' and kind='INGEST_REVISION'"),[("INGEST_REVISION","OPEN_CANONICAL_UNCHANGED")])
    def test_partial_scrape_aborts_db_untouched(self):
        self.all_new(skip=self.tick[:8]);h=sha(self.db)   # only 3/11 tickers
        with self.assertRaises(I.IngestError):I.ingest(self.src,self.db,TODAY)
        self.assertEqual(sha(self.db),h);self.assertEqual([f for f in os.listdir(self.d) if f.startswith(".stage_")],[])
    def test_corrupt_files_threshold(self):
        self.all_new()
        for t in self.tick[:3]:(self.src/f"{t}.json").write_text("{not json")   # 3/11 > 10%
        h=sha(self.db)
        with self.assertRaises(I.IngestError):I.ingest(self.src,self.db,TODAY)
        self.assertEqual(sha(self.db),h)
    def test_one_corrupt_file_reported_not_fatal(self):
        files=[]
        self.all_new()
        for k in range(12):self.write(f"ZZ{k}",[]) # extra files unknown tickers
        rep=I.ingest(self.src,self.db,TODAY);self.assertEqual(len(rep["unknown_tickers"]),12)
    def test_missing_source_or_db(self):
        with self.assertRaises(I.IngestError):I.ingest(self.src,self.db,TODAY)   # empty src
        with self.assertRaises(I.IngestError):I.ingest(self.src,os.path.join(self.d,"none.sqlite"),TODAY)
    def test_crash_before_swap_leaves_db_identical(self):
        self.all_new();h=sha(self.db)
        for point in ("before_insert","before_swap"):
            def hook(n,point=point):
                if n==point:raise RuntimeError("boom")
            I._hook=hook
            with self.assertRaises(RuntimeError):I.ingest(self.src,self.db,TODAY)
            self.assertEqual(sha(self.db),h,point);self.assertEqual([f for f in os.listdir(self.d) if f.startswith(".stage_")],[],point)
        I._hook=lambda n:None
        self.assertEqual(I.ingest(self.src,self.db,TODAY)["status"],"UPDATED")   # converges after crash
    def test_cli_exit_codes_and_report(self):
        self.all_new();rp=os.path.join(self.d,"r.json")
        self.assertEqual(I.main(["--src",str(self.src),"--db",self.db,"--report",rp,"--today","2026-11-02"]),0)
        self.assertEqual(json.load(open(rp))["status"],"UPDATED")
        self.assertEqual(I.main(["--src",str(self.d)+"/nope","--db",self.db,"--report",rp]),2)
        self.assertEqual(json.load(open(rp))["status"],"FAILED")
class EngineAfterIngest(Base):
    FILLER=60
    def test_engine_reads_ingested_session_and_flags_single_source(self):
        # next Sunday session 2026-11-01 for all; engine must advance and show the uncorroborated warning
        self.all_new();I.ingest(self.src,self.db,TODAY)
        s=snapshot.build(self.db,now=datetime.datetime(2026,11,2,9,tzinfo=datetime.timezone.utc))
        self.assertEqual(s["source_session"],"2026-11-01")

class Revisions(Base):
    def revise(self,t,date,factor):
        con=sqlite3.connect(self.db);c=con.execute("select close from canonical_bars where ticker=? and date=?",(t,date)).fetchone()[0];con.close()
        return c*factor
    def src_with(self,t,date,newclose):
        con=sqlite3.connect(self.db);rows=con.execute("select date,close from canonical_bars where ticker=? and date>='2026-10-20' order by date",(t,)).fetchall();con.close()
        self.write(t,[bar(t,d,(newclose if d==date else c)) for d,c in rows])
    def test_revision_without_new_session_is_recorded_not_noop(self):
        t="UPT";old="2026-10-22";self.src_with(t,old,self.revise(t,old,1.04))
        before=self.q("select * from canonical_bars where ticker='UPT' order by date");rep=I.ingest(self.src,self.db,TODAY)
        self.assertEqual(rep["status"],"REVISIONS_RECORDED");self.assertEqual(rep["revisions_new"],1);self.assertEqual(rep["inserted"],0)
        self.assertEqual(before,self.q("select * from canonical_bars where ticker='UPT' order by date"))   # canonical untouched
        self.assertEqual(len(self.q("select * from conflicts where kind='INGEST_REVISION' and ticker='UPT' and date=?",old)),1)
    def test_older_than_last_session_revision_with_new_session(self):
        t="UPT";old="2026-10-21";self.all_new(skip=(t,))
        con=sqlite3.connect(self.db);rows=con.execute("select date,close from canonical_bars where ticker=? and date>='2026-10-20' order by date",(t,)).fetchall();con.close()
        self.write(t,[bar(t,d,c*(1.06 if d==old else 1)) for d,c in rows]+[bar(t,"2026-11-01",rows[-1][1])])
        rep=I.ingest(self.src,self.db,TODAY);self.assertEqual(rep["status"],"UPDATED");self.assertEqual(rep["revisions_new"],1)
        self.assertEqual(self.q("select date from conflicts where kind='INGEST_REVISION'"),[(old,)])
    def test_rerun_does_not_duplicate_conflict(self):
        t="UPT";old="2026-10-22";self.src_with(t,old,self.revise(t,old,1.04))
        I.ingest(self.src,self.db,TODAY);h=sha(self.db);rep=I.ingest(self.src,self.db,TODAY)
        self.assertEqual(rep["status"],"NOOP");self.assertEqual(rep["revisions_already_recorded"],1);self.assertEqual(sha(self.db),h)
        self.assertEqual(len(self.q("select * from conflicts where kind='INGEST_REVISION'")),1)
    def test_provider_revises_again_new_value_new_conflict(self):
        t="UPT";old="2026-10-22";self.src_with(t,old,self.revise(t,old,1.04));I.ingest(self.src,self.db,TODAY)
        self.src_with(t,old,self.revise(t,old,1.09));rep=I.ingest(self.src,self.db,TODAY)
        self.assertEqual(rep["revisions_new"],1);self.assertEqual(len(self.q("select * from conflicts where kind='INGEST_REVISION'")),2)
    def test_small_difference_ignored(self):
        t="UPT";old="2026-10-22";self.src_with(t,old,self.revise(t,old,1.002))
        self.assertEqual(I.ingest(self.src,self.db,TODAY)["status"],"NOOP")
class RevisionReachesEngine(Base):
    FILLER=60
    def test_revision_blocks_symbol_in_engine(self):
        t="UPT";old="2026-10-22"
        con=sqlite3.connect(self.db);rows=con.execute("select date,close from canonical_bars where ticker=? and date>='2026-10-20' order by date",(t,)).fetchall();con.close()
        self.write(t,[bar(t,d,c*(1.05 if d==old else 1)) for d,c in rows]);I.ingest(self.src,self.db,TODAY)
        s=snapshot.build(self.db,now=datetime.datetime(2026,10,30,9,tzinfo=datetime.timezone.utc))
        self.assertIn(t,[b["ticker"] for b in s["blocked"]]);self.assertNotIn(t,[r["ticker"] for r in s["ranked"]])
class FailureHandling(Base):
    def tmp_left(self):return [f for f in os.listdir(self.d) if f.startswith(".stage_") or f.endswith(".tmp")]
    def test_failure_preserves_db_and_prev_backup(self):
        self.all_new();I.ingest(self.src,self.db,TODAY)          # first success creates .prev (= original DB)
        prev_h=sha(self.db+".prev");live_h=sha(self.db)
        for t in self.tick:self.write(t,[bar(t,"2026-11-01",1.0),bar(t,"2026-11-03",1.0)]) if False else None
        # a second run that FAILS: partial scrape on a newer date
        for t in self.tick[:9]:(self.src/f"{t}.json").write_text(json.dumps(dict(ticker=t,sessions=[bar(t,"2026-11-01",1.0)])))
        for t in self.tick[9:]:(self.src/f"{t}.json").write_text(json.dumps(dict(ticker=t,sessions=[bar(t,"2026-11-01",1.0),bar(t,"2026-11-02",1.0)])))
        with self.assertRaises(I.IngestError):I.ingest(self.src,self.db,datetime.date(2026,11,3))
        self.assertEqual(sha(self.db),live_h);self.assertEqual(sha(self.db+".prev"),prev_h);self.assertEqual(self.tmp_left(),[])
    def test_crash_after_prev_backup_is_consistent(self):
        self.all_new();orig=sha(self.db)
        def hook(n):
            if n=="after_prev":raise RuntimeError("boom")
        I._hook=hook
        try:
            with self.assertRaises(RuntimeError):I.ingest(self.src,self.db,TODAY)
        finally:I._hook=lambda n:None
        self.assertEqual(sha(self.db),orig);self.assertEqual(sha(self.db+".prev"),orig);self.assertEqual(self.tmp_left(),[])
        self.assertEqual(I.ingest(self.src,self.db,TODAY)["status"],"UPDATED")
    def test_cli_failure_updates_report_and_error_log(self):
        self.all_new(skip=self.tick[:8]);rp=os.path.join(self.d,"r.json");lg=os.path.join(self.d,"logs","err.jsonl");h=sha(self.db)
        for _ in range(2):
            self.assertEqual(I.main(["--src",str(self.src),"--db",self.db,"--report",rp,"--errlog",lg,"--today","2026-11-02"]),2)
        with open(rp) as f:r=json.load(f)
        self.assertEqual(r["status"],"FAILED");self.assertIn("partial scrape",r["error"]);self.assertEqual(r["db_sha256_now"],h)
        with open(lg) as f:lines=[json.loads(x) for x in f]
        self.assertEqual(len(lines),2);self.assertTrue(all(l["job"]=="ingest_daily" and l["db_sha256_now"]==h for l in lines))
        # a later success overwrites the report with UPDATED and keeps the error log append-only
        self.all_new();self.assertEqual(I.main(["--src",str(self.src),"--db",self.db,"--report",rp,"--errlog",lg,"--today","2026-11-02"]),0)
        with open(rp) as f:self.assertEqual(json.load(f)["status"],"UPDATED")
        with open(lg) as f:self.assertEqual(len(f.readlines()),2)
    def test_success_report_has_hashes_and_audit_row(self):
        self.all_new();rep=I.ingest(self.src,self.db,TODAY)
        self.assertEqual(rep["db_sha256_after"],sha(self.db));self.assertNotEqual(rep["db_sha256_before"],rep["db_sha256_after"])
    def test_corrupt_staged_db_rejected(self):
        self.all_new();h=sha(self.db);orig=I._integrity;I._integrity=lambda c:"corrupt"
        try:
            with self.assertRaises(I.IngestError):I.ingest(self.src,self.db,TODAY)
        finally:I._integrity=orig
        self.assertEqual(sha(self.db),h);self.assertEqual(self.tmp_left(),[]);self.assertFalse(os.path.exists(self.db+".prev"))
if __name__=="__main__":unittest.main(verbosity=1)
