"""Cloudflare R2-style store: immutable unique objects, SHA-256 manifests, pointer, recovery, no deletion, hard cost guard.
LocalBackend and a fake S3 client (head/put/get/list) exercise the same code. No real credentials or buckets are used or assumed."""
import unittest,tempfile,os,sys,json,pathlib,io,datetime,gzip,re
ROOT=str(pathlib.Path(__file__).resolve().parent.parent);sys.path.insert(0,ROOT);sys.path.insert(0,str(pathlib.Path(__file__).parent))
import fixtures as F
import central_store as S
T0=datetime.datetime(2026,11,2,10,tzinfo=datetime.timezone.utc)
def at(m):return T0+datetime.timedelta(minutes=m)
class NotFound(Exception):
    def __init__(s):s.response={"Error":{"Code":"404"}}
class FakeS3:
    def __init__(self):self.o={};self.calls=[]
    def head_object(self,Bucket,Key):
        self.calls.append("head")
        if Key not in self.o:raise NotFound()
        return {"ContentLength":len(self.o[Key])}
    def upload_file(self,path,bucket,key,**kw):self.calls.append("put");self.o[key]=open(path,"rb").read()
    def download_file(self,bucket,key,dest,**kw):
        self.calls.append("get")
        if key not in self.o:raise KeyError(key)
        open(dest,"wb").write(self.o[key])
    def put_object(self,Bucket,Key,Body):self.calls.append("put");self.o[Key]=Body
    def get_object(self,Bucket,Key):
        self.calls.append("get")
        if Key not in self.o:raise KeyError(Key)
        return {"Body":io.BytesIO(self.o[Key])}
    def list_objects_v2(self,Bucket,Prefix,**kw):self.calls.append("list");return {"Contents":[{"Key":k,"Size":len(v)} for k,v in sorted(self.o.items()) if k.startswith(Prefix)],"IsTruncated":False}
def mkdb(d,name,seed=1,end="2026-10-29"):
    p=os.path.join(d,name);F.build(p,{"UPT":dict(close=F.series(140,20,0.004,0.003,seed))},filler=5,end=end);return p
def sha(p):return S.sha256_file(p)
class Common:
    LIM=None
    def mkstore(self,now=None,limits=None,run_budget=None):
        inner=self.inner();m=S.Metered(inner,"egx-central",limits or self.LIM or S.Limits(),now or T0,run_budget);return S.Store(m,"egx-central")
    def setUp(self):
        self.d=tempfile.mkdtemp();self.mk();self.st=self.mkstore()
        self.db1=mkdb(self.d,"a.sqlite",1);self.db2=mkdb(self.d,"b.sqlite",2);self.db3=mkdb(self.d,"c.sqlite",3)
    def keys(self):return sorted(k for k,_ in self.st.b.i.list_sizes(""))
    def test_bootstrap_fetch_roundtrip_manifest_compressed(self):
        m=self.st.bootstrap(self.db1,meta={"x":1},now=at(0))
        self.assertEqual(m["db_sha256"],sha(self.db1));self.assertEqual(m["size"],os.path.getsize(self.db1));self.assertLess(m["stored_size"],m["size"])
        self.assertTrue(m["stored_key"].endswith(".sqlite.gz"));self.assertIn(m["db_sha256"][:12],m["stored_key"]);self.assertIsNone(m["parent_manifest"])
        dest=os.path.join(self.d,"out","c.sqlite");m2=self.st.fetch(dest);self.assertEqual(sha(dest),sha(self.db1));self.assertEqual(m2["meta"],{"x":1})
    def test_unique_names_never_overwrite_chain_idempotence(self):
        self.st.bootstrap(self.db1,now=at(0));m=self.st.publish(self.db2,now=at(1));self.assertIsNotNone(m["parent_manifest"])
        before=self.keys();self.assertEqual(self.st.publish(self.db2,now=at(2))["db_sha256"],m["db_sha256"]);self.assertEqual(before,self.keys())   # same content = no new version
        self.assertEqual(len(self.st.versions()),2)
        with self.assertRaises(S.StoreError):self.st.bootstrap(self.db1,now=at(3))
        for k in self.keys():
            if "/db/" in k or "/manifests/" in k or "/pointer-log/" in k:
                with self.assertRaises(S.StoreError):self.st.b.put_bytes(k,b"x")
    def test_pointer_log_written_for_every_move(self):
        self.st.bootstrap(self.db1,now=at(0));self.st.publish(self.db2,now=at(1));self.st.restore(self.st.pointer()["previous"],now=at(2))
        self.assertEqual(len([k for k in self.keys() if "/pointer-log/" in k]),3)
    def test_empty_store_fetch_fails_loudly(self):
        with self.assertRaises(S.StoreError):self.st.fetch(os.path.join(self.d,"x.sqlite"))
        self.assertFalse(os.path.exists(os.path.join(self.d,"x.sqlite")))
        self.assertIsNone(self.st.fetch(os.path.join(self.d,"x.sqlite"),allow_empty=True))
    def test_corrupted_blob_rejected_dest_untouched(self):
        m=self.st.bootstrap(self.db1,now=at(0));dest=os.path.join(self.d,"live.sqlite");open(dest,"w").write("OLD");self.corrupt(m["stored_key"])
        with self.assertRaises(S.StoreError):self.st.fetch(dest)
        self.assertEqual(open(dest).read(),"OLD");self.assertEqual([f for f in os.listdir(self.d) if f.startswith(".dl_")],[])
    def test_blob_replaced_by_other_valid_gzip_is_caught(self):
        m=self.st.bootstrap(self.db1,now=at(0));self.overwrite(m["stored_key"],gzip.compress(b"SQLite format 3\0"+b"x"*500))
        with self.assertRaises(S.StoreError):self.st.fetch(os.path.join(self.d,"y.sqlite"))
    def test_manifest_raw_sha_mismatch_caught(self):
        m=self.st.bootstrap(self.db1,now=at(0));mk=self.st.pointer()["manifest_key"];mm=json.loads(self.read(mk));mm["db_sha256"]="0"*64;self.overwrite(mk,json.dumps(mm).encode())
        with self.assertRaises(S.StoreError):self.st.fetch(os.path.join(self.d,"y.sqlite"))
    def test_crash_at_every_publish_step_keeps_previous_latest(self):
        self.st.bootstrap(self.db1,now=at(0));old=self.st.pointer()
        for point in("after_blob","after_readback","after_manifest","after_pointer_log"):
            def hook(n,point=point):
                if n==point:raise RuntimeError("boom")
            S._hook=hook
            try:
                with self.assertRaises(RuntimeError):self.st.publish(self.db2,now=at(5))
            finally:S._hook=lambda n:None
            ptr=self.st.pointer()
            self.assertEqual(ptr["db_sha256"],old["db_sha256"],point)
            dest=os.path.join(self.d,"f.sqlite");self.st.fetch(dest);self.assertEqual(sha(dest),sha(self.db1))
        self.assertEqual(self.st.publish(self.db2,now=at(9))["db_sha256"],sha(self.db2))
    def test_parent_guard(self):
        m=self.st.bootstrap(self.db1,now=at(0))
        with self.assertRaises(S.StoreError):self.st.publish(self.db2,expect_parent="deadbeef",now=at(1))
        self.st.publish(self.db2,expect_parent=m["db_sha256"],now=at(1))
    def test_restore_previous_version_safe_and_nothing_lost(self):
        m1=self.st.bootstrap(self.db1,now=at(0));m2=self.st.publish(self.db2,now=at(1));n=len(self.keys())
        ptr=self.st.restore(self.st.pointer()["previous"],now=at(2));self.assertTrue(ptr["restored"])
        dest=os.path.join(self.d,"r.sqlite");self.st.fetch(dest);self.assertEqual(sha(dest),m1["db_sha256"])
        self.assertTrue(set(k for k in self.keys() if "/db/" in k)>={m1["stored_key"],m2["stored_key"]})   # newer version still there
        self.corrupt(m1["stored_key"])
        with self.assertRaises(S.StoreError):self.st.restore(ptr["manifest_key"],now=at(3))                 # refuses a damaged version
        self.assertEqual(self.st.pointer()["db_sha256"],m1["db_sha256"])                                  # pointer unchanged by the refused restore
    def test_fetch_older_manifest_does_not_move_pointer(self):
        m1=self.st.bootstrap(self.db1,now=at(0));self.st.publish(self.db2,now=at(1));ptr=self.st.pointer()
        dest=os.path.join(self.d,"old.sqlite");self.st.fetch(dest,manifest_key=ptr["previous"]);self.assertEqual(sha(dest),m1["db_sha256"]);self.assertEqual(self.st.pointer(),ptr)
    def test_invalid_db_not_published(self):
        bad=os.path.join(self.d,"bad.sqlite");open(bad,"wb").write(b"not sqlite at all"*100)
        with self.assertRaises(S.StoreError):self.st.bootstrap(bad,now=at(0))
        self.assertIsNone(self.st.pointer());self.assertEqual([k for k in self.keys() if "/db/" in k],[])
    def test_tampered_manifest_or_pointer_fail_loudly(self):
        self.st.bootstrap(self.db1,now=at(0));key=self.st.pointer()["manifest_key"];self.overwrite(key,b"{not json")
        with self.assertRaises(S.StoreError):self.st.fetch(os.path.join(self.d,"z.sqlite"))
        self.overwrite("egx-central/LATEST.json",b"garbage")
        with self.assertRaises(S.StoreError):self.st.pointer()
    def test_corrupt_pointer_then_recover(self):
        m1=self.st.bootstrap(self.db1,now=at(0));m2=self.st.publish(self.db2,now=at(1));self.overwrite("egx-central/LATEST.json",b"garbage")
        with self.assertRaises(S.StoreError):self.st.fetch(os.path.join(self.d,"z.sqlite"))              # no silent fallback
        r=self.st.recover();self.assertFalse(r["applied"]);self.assertEqual(r["db_sha256"],m2["db_sha256"])  # dry run
        with self.assertRaises(S.StoreError):self.st.pointer()
        r=self.st.recover(apply=True);self.assertTrue(r["applied"]);dest=os.path.join(self.d,"z.sqlite");self.st.fetch(dest);self.assertEqual(sha(dest),m2["db_sha256"])
    def test_recover_skips_damaged_newest(self):
        m1=self.st.bootstrap(self.db1,now=at(0));m2=self.st.publish(self.db2,now=at(1));self.corrupt(m2["stored_key"]);self.overwrite("egx-central/LATEST.json",b"garbage")
        r=self.st.recover(apply=True);self.assertEqual(r["db_sha256"],m1["db_sha256"]);self.assertEqual(len(r["skipped_invalid"]),1)
        dest=os.path.join(self.d,"z.sqlite");self.st.fetch(dest);self.assertEqual(sha(dest),m1["db_sha256"])
    def test_recover_fails_when_nothing_valid(self):
        m1=self.st.bootstrap(self.db1,now=at(0));self.corrupt(m1["stored_key"])
        with self.assertRaises(S.StoreError):self.st.recover()
    def test_no_delete_operation_and_retention_plan_is_dry(self):
        for cls in(S.LocalBackend,S.S3Backend,S.Metered,S.Store):
            self.assertEqual([n for n in dir(cls) if re.match(r"(delete|remove|unlink|purge|prune|expire|gc)",n)],[],cls.__name__)
        src=open(os.path.join(ROOT,"central_store.py"),encoding="utf-8").read()
        for bad in("delete_object","delete_objects","abort_multipart","lifecycle","put_bucket"):self.assertNotIn(bad,src)
        self.st.bootstrap(self.db1,now=at(0));self.st.publish(self.db2,now=at(1));before=self.keys();p=self.st.retention_plan()
        self.assertEqual((p["policy"],p["deletions_performed"],p["deletable_now"]),("NONE_APPROVED",0,[]));self.assertEqual(before,self.keys())
    # ---- cost guard ----
    def test_storage_stop_at_80_percent_writes_nothing(self):
        m=self.st.bootstrap(self.db1,now=at(0));one=m["stored_size"]+4096;self.st.flush()
        st=self.mkstore(limits=S.Limits(bytes_=int(one*1.5)));keys=self.keys()      # 80% of the limit = 1.2 versions
        with self.assertRaises(S.BudgetError) as e:st.publish(self.db2,now=at(1))
        self.assertIn("storage guard",str(e.exception));self.assertEqual([k for k in self.keys() if "/usage/" not in k],[k for k in keys if "/usage/" not in k])   # nothing written
        dest=os.path.join(self.d,"r.sqlite");st.fetch(dest);self.assertEqual(sha(dest),sha(self.db1))  # reads still work
    def test_monthly_class_a_stop_at_80_percent(self):
        st=self.mkstore(limits=S.Limits(class_a=12))
        with self.assertRaises(S.BudgetError):st.bootstrap(self.db1,now=at(0))                          # est 10 + used > 16
        self.assertEqual([k for k in self.keys() if "/db/" in k],[])
    def test_monthly_class_b_stop_at_80_percent(self):
        st=self.mkstore(limits=S.Limits(class_b=20))
        with self.assertRaises(S.BudgetError):st.bootstrap(self.db1,now=at(0))
        self.assertEqual([k for k in self.keys() if "/db/" in k],[])
    def test_ledger_counts_persist_across_runs_and_new_month_resets(self):
        self.st.bootstrap(self.db1,now=at(0));u1=self.st.usage();self.st.flush()
        st2=self.mkstore();u2=st2.usage();self.assertGreaterEqual(u2["class_a"],u1["class_a"]);self.assertGreater(u2["class_b"],0)
        nov=json.loads(self.st.b.i.get_bytes("egx-central/usage/2026-11.json"));self.assertGreater(nov["a"],5)
        dec=self.mkstore(now=datetime.datetime(2026,12,1,tzinfo=datetime.timezone.utc)).usage();self.assertEqual(dec["month"],"2026-12");self.assertLessEqual(dec["class_a"],1)
    def test_100_percent_monthly_limit_blocks_even_reads(self):
        self.st.bootstrap(self.db1,now=at(0));self.st.flush()
        self.st.b.i.put_bytes("egx-central/usage/2026-11.json",json.dumps(dict(month="2026-11",a=10**5,b=10**6)).encode(),overwrite=True)
        st=self.mkstore()
        with self.assertRaises(S.BudgetError):st.fetch(os.path.join(self.d,"x.sqlite"))
    def test_ledger_corrupt_fails_closed(self):
        self.st.bootstrap(self.db1,now=at(0));self.st.flush();self.st.b.i.put_bytes("egx-central/usage/2026-11.json",b"{broken",overwrite=True)
        st=self.mkstore()
        with self.assertRaises(S.BudgetError):st.publish(self.db2,now=at(1))
        with self.assertRaises(S.BudgetError):st.fetch(os.path.join(self.d,"x.sqlite"))
        self.assertEqual(len([k for k in self.keys() if "/db/" in k]),1)
    def test_run_op_budget_stops_runaway(self):
        st=self.mkstore(run_budget=dict(a=2,b=60))
        with self.assertRaises(S.BudgetError):st.bootstrap(self.db1,now=at(0))
        st=self.mkstore(run_budget=dict(a=60,b=3))
        with self.assertRaises(S.BudgetError):st.bootstrap(self.db1,now=at(0))
    def test_flush_after_failure_still_records_ops(self):
        st=self.mkstore()
        with self.assertRaises(S.StoreError):st.fetch(os.path.join(self.d,"x.sqlite"))
        st.flush();led=json.loads(st.b.i.get_bytes("egx-central/usage/2026-11.json"));self.assertGreaterEqual(led["b"],2)
    def test_oversize_object_refused(self):
        old=S.MAX_OBJECT;S.MAX_OBJECT=1000
        try:
            with self.assertRaises(S.StoreError):self.st.bootstrap(self.db1,now=at(0))
        finally:S.MAX_OBJECT=old
        self.assertEqual([k for k in self.keys() if "/db/" in k],[])
class LocalTests(Common,unittest.TestCase):
    def mk(self):self._root=os.path.join(self.d,"bucket")
    def inner(self):return S.LocalBackend(self._root)
    def corrupt(self,key):
        p=pathlib.Path(self._root)/key;b=bytearray(p.read_bytes());b[len(b)//2]^=0xFF;p.write_bytes(bytes(b))
    def overwrite(self,key,data):(pathlib.Path(self._root)/key).write_bytes(data)
    def read(self,key):return (pathlib.Path(self._root)/key).read_bytes()
class S3Tests(Common,unittest.TestCase):
    def mk(self):self.cli=FakeS3()
    def inner(self):return S.S3Backend(self.cli,"bkt")
    def corrupt(self,key):
        b=bytearray(self.cli.o[key]);b[len(b)//2]^=0xFF;self.cli.o[key]=bytes(b)
    def overwrite(self,key,data):self.cli.o[key]=data
    def read(self,key):return self.cli.o[key]
    def test_no_versioning_api_needed_and_single_put_per_object(self):
        self.st.bootstrap(self.db1,now=at(0));self.assertFalse(any(c=="versioning" for c in self.cli.calls))
        self.assertEqual(sorted(k.split("/")[1] for k in self.cli.o),["LATEST.json","db","manifests","pointer-log"])
class LimitsAndConfig(unittest.TestCase):
    def test_ceiling_is_half_of_free_tier_and_can_only_be_lowered(self):
        self.assertEqual(S.CEIL,dict(bytes=5*10**9,class_a=500_000,class_b=5_000_000))
        for kw in(dict(bytes_=6*10**9),dict(class_a=600_000),dict(class_b=6_000_000),dict(bytes_=-1)):
            with self.assertRaises(S.StoreConfigError):S.Limits(**kw)
        self.assertEqual(S.Limits(bytes_=10**9).bytes,10**9);self.assertEqual(S.Limits().bytes,3*10**9)
    def test_env_limits_validated(self):
        with self.assertRaises(S.StoreConfigError):S.Limits.from_env({"EGX_STORE_LIMIT_BYTES":"abc"})
        with self.assertRaises(S.StoreConfigError):S.Limits.from_env({"EGX_STORE_LIMIT_BYTES":str(9*10**9)})
    def test_missing_env_names_not_values(self):
        with self.assertRaises(S.StoreConfigError) as e:S.from_env({"AWS_ACCESS_KEY_ID":"SECRETVALUE"})
        msg=str(e.exception)
        for n in("EGX_STORE_BUCKET","EGX_STORE_ENDPOINT","AWS_SECRET_ACCESS_KEY"):self.assertIn(n,msg)
        self.assertNotIn("SECRETVALUE",msg)
    def test_from_env_injected_client_metered(self):
        st=S.from_env({"EGX_STORE_BUCKET":"b","EGX_STORE_ENDPOINT":"https://x.r2.cloudflarestorage.com","AWS_ACCESS_KEY_ID":"k","AWS_SECRET_ACCESS_KEY":"s","EGX_STORE_PREFIX":"/pfx/"},client_factory=lambda e:FakeS3(),now=T0)
        self.assertEqual(st.p,"pfx");self.assertIsInstance(st.b,S.Metered)
    def test_cli_fails_cleanly_without_config(self):
        for k in("EGX_STORE_BUCKET","EGX_STORE_ENDPOINT","AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY"):os.environ.pop(k,None)
        self.assertEqual(S.main(["check-config"]),2)
class JournalStore(unittest.TestCase):
    def test_journal_roundtrip_and_tamper_rejected(self):
        from egx_decision import journal
        d=tempfile.mkdtemp();j=os.path.join(d,"j.jsonl");journal.append(j,"2026-10-29",{"a":1});journal.append(j,"2026-10-30",{"a":2})
        st=S.Store(S.Metered(S.S3Backend(FakeS3(),"b"),"p",S.Limits(),T0),"p/journal-store",validator=S.journal_validator,ext=".jsonl.gz",label="journal")
        self.assertIsNone(st.fetch(os.path.join(d,"x"),allow_empty=True))
        st.bootstrap(j,now=at(0));dest=os.path.join(d,"o.jsonl");st.fetch(dest);self.assertEqual(open(dest).read(),open(j).read())
        bad=os.path.join(d,"bad.jsonl");open(bad,"w").write(open(j).read().replace('"a":1','"a":9').replace('"a": 1','"a": 9'))
        with self.assertRaises(S.StoreError):st.publish(bad,now=at(1))
        self.assertEqual(st.pointer()["db_sha256"],sha(j))
class CLI(unittest.TestCase):
    def setUp(self):
        self.d=tempfile.mkdtemp();self.cli=FakeS3();self.orig=S.from_env;self.db=mkdb(self.d,"a.sqlite",1);self.db2=mkdb(self.d,"b.sqlite",2)
        S.from_env=lambda env=None,client_factory=None,kind="db",now=None:S.Store(S.Metered(S.S3Backend(self.cli,"b"),"egx-central",S.Limits(),T0),"egx-central")
    def tearDown(self):S.from_env=self.orig
    def test_cli_flow_updates_ledger_and_reports(self):
        import contextlib
        def run(*a):
            buf=io.StringIO()
            with contextlib.redirect_stdout(buf),contextlib.redirect_stderr(io.StringIO()):rc=S.main(list(a))
            return rc,json.loads(buf.getvalue().strip().splitlines()[-1])
        rc,o=run("bootstrap","--db",self.db);self.assertEqual(rc,0);self.assertIn("usage",o)
        rc,o=run("publish","--db",self.db2);self.assertEqual(rc,0)
        rc,o=run("fetch","--dest",os.path.join(self.d,"f.sqlite"));self.assertEqual((rc,o["db_sha256"]),(0,sha(self.db2)))
        rc,o=run("list");self.assertEqual(len(o["versions"]),2)
        rc,o=run("usage");self.assertEqual(rc,0);self.assertLess(o["usage"]["pct"]["class_a"],1)
        rc,o=run("retention-plan");self.assertEqual(o["plan"]["deletions_performed"],0)
        led=json.loads(self.cli.o["egx-central/usage/2026-11.json"]);self.assertGreater(led["a"],10)
        n=len(self.cli.o);rc,o=run("fetch","--dest",os.path.join(self.d,"g.sqlite"),"--manifest","egx-central/manifests/none.json");self.assertEqual(rc,2);self.assertEqual(o["status"],"FAILED")
        led2=json.loads(self.cli.o["egx-central/usage/2026-11.json"]);self.assertGreater(led2["b"],led["b"])      # failed run still counted
if __name__=="__main__":unittest.main(verbosity=1)
