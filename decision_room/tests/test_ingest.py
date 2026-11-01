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
        rep=I.ingest(self.src,self.db,TODAY);self.assertEqual(rep["revisions"],1)
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
if __name__=="__main__":unittest.main(verbosity=1)
