"""End-to-end (no network): store fetch -> ingest -> run_daily -> store publish -> prepare_preview, two consecutive days, plus failure days that must change nothing."""
import unittest,tempfile,os,sys,json,pathlib,sqlite3,datetime
ROOT=str(pathlib.Path(__file__).resolve().parent.parent);sys.path.insert(0,ROOT);sys.path.insert(0,str(pathlib.Path(__file__).parent));sys.path.insert(0,os.path.join(ROOT,"preview"))
import fixtures as F,central_store as S,ingest_daily as I,run_daily as R,prepare_preview as P
def bar(t,d,c):return dict(ticker=t,date=d,sourceSessionDate=d,open=c*0.998,high=c*1.004,low=c*0.996,close=c,volume=6e6,currency="EGP")
class E2E(unittest.TestCase):
    def day(self,w,src,store,jstore,date,today,now,close_of):
        db=os.path.join(w,"central.sqlite");jp=os.path.join(w,"journal.jsonl")
        for f in(db,jp):
            if os.path.exists(f):os.unlink(f)
        m=store.fetch(db);jstore.fetch(jp,allow_empty=True)
        for t,c in close_of.items():(src/f"{t}.json").write_text(json.dumps(dict(ticker=t,sessions=[bar(t,date,c)])))
        rep=I.ingest(src,db,datetime.date.fromisoformat(today));out=os.path.join(w,"public")
        self.assertEqual(R.main(["--db",db,"--out",out,"--journal",jp,"--now",now]),0)
        store.publish(db,rep,expect_parent=m["db_sha256"])
        if os.path.exists(jp):jstore.publish(jp) if jstore.pointer() else jstore.bootstrap(jp)
        P.prepare(out,os.path.join(w,"dist"));return rep,out
    def test_two_days(self):
        w=tempfile.mkdtemp();db0=os.path.join(w,"seed.sqlite");F.build(db0,{"UPT":dict(close=F.series(140,20,0.004,0.003,5))},end="2026-10-29")
        be=S.LocalBackend(os.path.join(w,"bucket"));store=S.Store(be,"egx");jstore=S.Store(be,"egx/journal-store",validator=S.journal_validator,ext=".jsonl",label="journal")
        store.bootstrap(db0,now=datetime.datetime(2026,11,1,tzinfo=datetime.timezone.utc))
        con=sqlite3.connect(db0);last={t:c for t,c in con.execute("select ticker,close from canonical_bars where date='2026-10-29'")};con.close()
        src=pathlib.Path(w)/"src";src.mkdir()
        rep1,out=self.day(w,src,store,jstore,"2026-11-01","2026-11-02","2026-11-02T09:00:00+00:00",{t:c*1.01 for t,c in last.items()})
        self.assertEqual(rep1["status"],"UPDATED");rep2,out=self.day(w,src,store,jstore,"2026-11-02","2026-11-03","2026-11-03T09:00:00+00:00",{t:c*1.02 for t,c in last.items()})
        self.assertEqual(rep2["status"],"UPDATED");self.assertEqual(len(store.versions()),3);self.assertEqual(len(jstore.versions()),2)
        from egx_decision import journal
        self.assertTrue(journal.verify(os.path.join(w,"journal.jsonl")));self.assertEqual(len(journal.read(os.path.join(w,"journal.jsonl"))),2)
        # failure day: partial scrape -> nothing published anywhere
        ptr=store.pointer();jptr=jstore.pointer()
        db=os.path.join(w,"central.sqlite");os.unlink(db);store.fetch(db)
        for i,(t,c) in enumerate(last.items()):
            (src/f"{t}.json").write_text(json.dumps(dict(ticker=t,sessions=[bar(t,"2026-11-03",c)] if i<5 else [])))
        with self.assertRaises(I.IngestError):I.ingest(src,db,datetime.date(2026,11,4))
        self.assertEqual(store.pointer(),ptr);self.assertEqual(jstore.pointer(),jptr)
if __name__=="__main__":unittest.main()
