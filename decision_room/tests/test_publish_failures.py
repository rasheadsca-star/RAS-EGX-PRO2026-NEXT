"""Fault-injection tests: crash at every step of journal+publication; assert invariants and convergence on re-run."""
import unittest,tempfile,os,sys,json,pathlib,datetime
ROOT=str(pathlib.Path(__file__).resolve().parent.parent);sys.path.insert(0,ROOT);sys.path.insert(0,str(pathlib.Path(__file__).parent))
import fixtures as F
import numpy as np
from egx_decision import snapshot,journal,publish
NOW=datetime.datetime(2026,10,30,12,tzinfo=datetime.timezone.utc)
def mkdb(seed=5,end="2026-10-29"):
    d=tempfile.mkdtemp();p=os.path.join(d,"t.sqlite");F.build(p,{"UPT":dict(close=F.series(140,20,0.004,0.003,seed))},end=end);return p
class Boom(RuntimeError):pass
def inject(mod,point):
    def hook(name):
        if name==point:raise Boom(point)
    mod._hook=hook
def clear():
    publish._hook=lambda n:None;journal._hook=lambda n:None
PUBLISH_POINTS=["after_html_written","after_snapshot_written","after_verify","after_journal","after_release_rename","before_symlink_swap","after_swap"]
class Faults(unittest.TestCase):
    def tearDown(self):clear()
    def setUp(self):
        clear();self.db=mkdb();self.out=tempfile.mkdtemp();self.j=os.path.join(self.out,"journal","j.jsonl")
        self.snap=snapshot.build(self.db,now=NOW)
        # a previous good release for a different (older) session
        self.old=snapshot.build(self.db,now=NOW,asof="2026-10-22")
        publish.publish(self.out,self.old,self.j);self.old_id=publish.current_release(self.out)
    def assert_invariants(self):
        cur=publish.current_release(self.out)
        if cur:
            d=pathlib.Path(self.out)/"releases"/cur
            self.assertTrue(d.is_dir());m=json.loads((d/"MANIFEST.json").read_text())
            import hashlib
            for n,h in m["files"].items():self.assertEqual(hashlib.sha256((d/n).read_bytes()).hexdigest(),h)
        self.assertTrue(journal.verify(self.j))
        # every non-hidden release dir must be fully verifiable
        for d in (pathlib.Path(self.out)/"releases").iterdir():
            if d.name.startswith("."):continue
            self.assertTrue((d/"MANIFEST.json").exists(),d)
    def test_crash_at_every_publish_step_then_rerun_converges(self):
        for point in PUBLISH_POINTS:
            with self.subTest(point=point):
                self.setUp() if point!=PUBLISH_POINTS[0] else None
                inject(publish,point)
                with self.assertRaises(Boom):publish.publish(self.out,self.snap,self.j)
                clear();self.assert_invariants()
                served=publish.current_release(self.out)
                if point in("after_swap",):self.assertEqual(served,publish.release_id(self.snap))
                else:self.assertEqual(served,self.old_id,f"old release must stay live after crash at {point}")
                # journal never has duplicate/partial entries
                self.assertEqual(len([e for e in journal.read(self.j) if e["session"]==self.snap["source_session"]]),0 if point in PUBLISH_POINTS[:3] else 1)
                info=publish.publish(self.out,self.snap,self.j)       # re-run converges
                self.assertEqual(publish.current_release(self.out),publish.release_id(self.snap))
                self.assertEqual(len([e for e in journal.read(self.j) if e["session"]==self.snap["source_session"]]),1)
                self.assertTrue(journal.verify(self.j));self.assert_invariants()
    def test_journal_crash_before_replace_leaves_journal_intact_and_nothing_served(self):
        before=pathlib.Path(self.j).read_text()
        inject(journal,"journal_before_replace")
        with self.assertRaises(Boom):publish.publish(self.out,self.snap,self.j)
        clear();self.assertEqual(pathlib.Path(self.j).read_text(),before)
        self.assertEqual(publish.current_release(self.out),self.old_id)
        self.assertFalse(any(p.name.startswith(".jtmp_") for p in pathlib.Path(self.j).parent.iterdir()))
        publish.publish(self.out,self.snap,self.j);self.assertEqual(publish.current_release(self.out),publish.release_id(self.snap))
    def test_truncated_staged_file_is_rejected_before_journal(self):
        orig=publish._write_file
        def short(path,data):orig(path,data[:len(data)//2] if str(path).endswith("decision_snapshot.json") else data)
        publish._write_file=short
        try:
            with self.assertRaises(Exception):publish.publish(self.out,self.snap,self.j)
        finally:publish._write_file=orig
        self.assertEqual(publish.current_release(self.out),self.old_id)
        self.assertEqual([e["session"] for e in journal.read(self.j)],[self.old["source_session"]])
        self.assertFalse(any((pathlib.Path(self.out)/"releases").glob(".staging-*")))
    def test_corrupted_published_release_detected(self):
        d=pathlib.Path(self.out)/"releases"/self.old_id;(d/"index.html").write_text("tampered")
        with self.assertRaises(publish.PublishError):publish._verify_dir(d,self.old)
    def test_torn_journal_tail_blocks_publish_until_explicit_recovery(self):
        with open(self.j,"a",encoding="utf-8") as f:f.write('{"session": "2026-10-29", "content": {"x"')   # torn partial line
        self.assertFalse(journal.verify(self.j))
        with self.assertRaises(journal.JournalError):publish.publish(self.out,self.snap,self.j)
        self.assertEqual(publish.current_release(self.out),self.old_id)   # nothing new served while journal is untrustworthy
        self.assertTrue(journal.recover_torn_tail(self.j));self.assertTrue(journal.verify(self.j))
        publish.publish(self.out,self.snap,self.j);self.assertEqual(publish.current_release(self.out),publish.release_id(self.snap))
    def test_damage_beyond_tail_is_not_auto_repaired(self):
        t=pathlib.Path(self.j).read_text().replace(self.old["source_session"],"2026-01-01",1);pathlib.Path(self.j).write_text(t+"garbage")
        with self.assertRaises(journal.JournalError):journal.recover_torn_tail(self.j)
    def test_retroactive_change_refused_and_nothing_swapped(self):
        other=snapshot.build(self.db,now=NOW,asof="2026-10-22");other["content_sha256"]="f"*64;other["ranked"]=[]   # same session, different content
        with self.assertRaises(journal.JournalError):publish.publish(self.out,other,self.j)
        self.assertEqual(publish.current_release(self.out),self.old_id)
    def test_health_reports_failure_and_serving_release(self):
        import run_daily
        inject(publish,"after_journal")
        rc=run_daily.main(["--db",self.db,"--out",self.out,"--journal",self.j,"--now",NOW.isoformat()]);clear()
        self.assertEqual(rc,2);h=json.load(open(os.path.join(self.out,"job_health.json")))
        self.assertEqual(h["status"],"FAILED");self.assertEqual(h["phase"],"publish");self.assertEqual(h["serving"],self.old_id)
        self.assertEqual(run_daily.main(["--db",self.db,"--out",self.out,"--journal",self.j,"--now",NOW.isoformat()]),0)
        h=json.load(open(os.path.join(self.out,"job_health.json")));self.assertEqual(h["status"],"OK");self.assertEqual(h["journal"],"UNCHANGED")
    def test_retention_keeps_recent_releases_and_current(self):
        cur=None
        for k in range(8):
            db=mkdb(seed=20+k,end=(datetime.date(2026,10,29)).isoformat());s=snapshot.build(db,now=NOW);s["source_session"]=f"2026-10-{10+k:02d}"
            s["content_sha256"]=f"{k:064x}"
            publish.publish(self.out,s,None);cur=publish.current_release(self.out)
        rels=[p.name for p in (pathlib.Path(self.out)/"releases").iterdir() if not p.name.startswith(".")]
        self.assertLessEqual(len(rels),publish.KEEP+1);self.assertIn(cur,rels)
if __name__=="__main__":unittest.main(verbosity=2)
