import hashlib,json,sqlite3,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/"tools"))
from official_resolver import resolve,similarity
from official_atomic_merge import merge,MergeError,sha

SCHEMA="""
create table symbol_identity(ticker text primary key,name_en text,currency text);
create table canonical_bars(ticker text,date text,price_basis text,open real,high real,low real,close real,volume real,evidence_tier text,providers text,selected_source_id text,n_observations int,notes text,primary key(ticker,date,price_basis));
create table official_session(session_date text,market text,pdf_page int,pdf_rank int,name_en text,currency text,open real,high real,low real,close real,volume real,value real,chg_pct real,ticker text,resolution_status text,resolution_evidence text,bounds_status text,primary key(session_date,market,pdf_rank));
create table raw_observations(obs_id integer primary key,ticker text,date text,source_id text,provider_family text,open real,high real,low real,close real,adj_close real,volume real,currency text,declared_basis text,valid int,invalid_reason text,source_path text,row_ref text,official_verified int);
create table source_registry(source_id text primary key,provider_family text,description text,location text,snapshot_ref text,file_sha256 text,license_status text,adjusted_or_raw text,interval text,currency text,date_timezone text,independence_note text);
"""
class OfficialPipelineTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory()
  base=Path(self.tmp.name)
  self.db=base/"db.sqlite";self.pdf=base/"official.pdf";self.mapped=base/"mapped.json"
  self.pdf.write_bytes(b"%PDF-fixture-only")
  c=sqlite3.connect(self.db);c.executescript(SCHEMA)
  c.execute("insert into symbol_identity values (?,?,?)",("TEST","Test Maritime Company","EGP"))
  c.execute("insert into canonical_bars(ticker,date,price_basis,open,high,low,close,volume) values (?,?,?,?,?,?,?,?)",("TEST","2026-11-01","RAW",10,10,10,10,100))
  c.execute("insert into official_session(session_date,market,pdf_rank,name_en,ticker) values (?,?,?,?,?)",("2026-11-01","MAIN",1,"Test Maritime Company","TEST"))
  c.commit();c.close()
  self.items=[dict(page=17,rank=1,market="MAIN",name="Test Maritime Company",currency="EGP",status="CANDIDATE",open=10,high=11,low=9,close=10.5,chg_pct=5,volume=1000,trades=10,value_traded=10000),
              dict(page=17,rank=2,market="MAIN",name="Other Company",currency="USD",status="CANDIDATE",open=10,high=11,low=9,close=10,chg_pct=0,volume=500,trades=5)]
  self.map=resolve(self.items,self.db,"2026-11-01",sha(self.pdf))
  self.mapped.write_text(json.dumps(self.map))
 def tearDown(self):self.tmp.cleanup()
 def test_match_requires_name_price_currency(self):
  self.assertEqual(self.map["summary"]["provisional"],1)
  self.assertEqual(self.map["items"][0]["ticker"],"TEST")
  self.assertEqual(self.map["items"][1]["resolution_status"],"QUARANTINED_NON_EGP")
  bad={**self.items[0],"close":13,"chg_pct":5}
  self.assertIsNone(resolve([bad],self.db,"2026-11-01")["items"][0]["ticker"])
 def test_wrapped_name_normalization(self):
  self.assertEqual(similarity("Test Maritime\n Company","Test Maritime Company"),1)
 def test_research_opt_in_required(self):
  with self.assertRaisesRegex(MergeError,"UNVERIFIED_SYMBOL_MAPPING"):
   merge(self.db,self.pdf,self.mapped,"2026-11-02")
 def test_import_twice_noop_and_backup(self):
  start=sha(self.db)
  self.assertEqual(merge(self.db,self.pdf,self.mapped,"2026-11-02",True)["inserted"],1)
  self.assertEqual(sha(Path(str(self.db)+".prev")),start)
  after=sha(self.db)
  self.assertEqual(merge(self.db,self.pdf,self.mapped,"2026-11-02",True)["outcome"],"NOOP")
  self.assertEqual(sha(self.db),after)
  c=sqlite3.connect(self.db)
  self.assertEqual(c.execute("pragma integrity_check").fetchone()[0],"ok")
  self.assertEqual(c.execute("select evidence_tier from canonical_bars where date='2026-11-02'").fetchone()[0],"PROVISIONAL_SYMBOL_IDENTITY")
  self.assertEqual(c.execute("select count(*) from official_session where session_date='2026-11-02'").fetchone()[0],2)
  c.close()
 def test_injected_failure_preserves_bytes(self):
  start=sha(self.db)
  with self.assertRaisesRegex(MergeError,"INJECTED_BEFORE_SWAP"):
   merge(self.db,self.pdf,self.mapped,"2026-11-02",True,"before_swap")
  self.assertEqual(sha(self.db),start)
 def test_pdf_tamper_rejected(self):
  self.pdf.write_bytes(self.pdf.read_bytes()+b"tamper")
  with self.assertRaisesRegex(MergeError,"PDF_SHA256_MISMATCH"):
   merge(self.db,self.pdf,self.mapped,"2026-11-02",True)
 def test_replay_conflict_rejected(self):
  merge(self.db,self.pdf,self.mapped,"2026-11-02",True)
  start=sha(self.db);body=json.loads(self.mapped.read_text())
  body["items"][0]["close"]=10.55;self.mapped.write_text(json.dumps(body))
  with self.assertRaisesRegex(MergeError,"REPLAY_CONFLICT"):
   merge(self.db,self.pdf,self.mapped,"2026-11-02",True)
  self.assertEqual(sha(self.db),start)
if __name__=="__main__":unittest.main()
