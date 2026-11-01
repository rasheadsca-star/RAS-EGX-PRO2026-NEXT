"""Object-store tests: LocalBackend + a fake S3 client exercising S3Backend. No real credentials or buckets are used or assumed."""
import unittest,tempfile,os,sys,json,pathlib,sqlite3,io,datetime
ROOT=str(pathlib.Path(__file__).resolve().parent.parent);sys.path.insert(0,ROOT);sys.path.insert(0,str(pathlib.Path(__file__).parent))
import fixtures as F
import central_store as S
T0=datetime.datetime(2026,11,2,10,tzinfo=datetime.timezone.utc)
def at(m):return T0+datetime.timedelta(minutes=m)
class FakeS3:
    """minimal boto3-like client; objects dict key->bytes; versioning flag"""
    def __init__(self,versioning="Enabled"):self.o={};self.v=versioning
    def upload_file(self,path,bucket,key):self.o[key]=open(path,"rb").read()
    def download_file(self,bucket,key,dest):
        if key not in self.o:raise KeyError(key)
        open(dest,"wb").write(self.o[key])
    def put_object(self,Bucket,Key,Body):self.o[Key]=Body
    def get_object(self,Bucket,Key):
        if Key not in self.o:raise KeyError(Key)
        return {"Body":io.BytesIO(self.o[Key])}
    def list_objects_v2(self,Bucket,Prefix,**kw):return {"Contents":[{"Key":k} for k in sorted(self.o) if k.startswith(Prefix)],"IsTruncated":False}
    def get_bucket_versioning(self,Bucket):return {"Status":self.v} if self.v else {}
def mkdb(d,name,seed=1,end="2026-10-29"):
    p=os.path.join(d,name);F.build(p,{"UPT":dict(close=F.series(140,20,0.004,0.003,seed))},filler=5,end=end);return p
class Common:
    def setUp(self):
        self.d=tempfile.mkdtemp();self.mk()
        self.db1=mkdb(self.d,"a.sqlite",1);self.db2=mkdb(self.d,"b.sqlite",2)
    def test_bootstrap_fetch_roundtrip_and_manifest(self):
        m=self.st.bootstrap(self.db1,meta={"x":1},now=at(0))
        self.assertEqual(m["db_sha256"],S.sha256_file(self.db1));self.assertEqual(m["size"],os.path.getsize(self.db1));self.assertIsNone(m["parent_manifest"])
        dest=os.path.join(self.d,"out","c.sqlite");m2=self.st.fetch(dest);self.assertEqual(S.sha256_file(dest),m["db_sha256"]);self.assertEqual(m2["meta"],{"x":1})
    def test_publish_chain_versions_and_idempotence(self):
        self.st.bootstrap(self.db1,now=at(0));m=self.st.publish(self.db2,now=at(1));self.assertIsNotNone(m["parent_manifest"])
        self.assertEqual(self.st.publish(self.db2,now=at(2))["db_sha256"],m["db_sha256"])      # same content = no new version
        self.assertEqual(len(self.st.versions()),2)
        with self.assertRaises(S.StoreError):self.st.bootstrap(self.db1,now=at(3))
    def test_empty_store_fetch_fails_loudly(self):
        with self.assertRaises(S.StoreError):self.st.fetch(os.path.join(self.d,"x.sqlite"))
        self.assertFalse(os.path.exists(os.path.join(self.d,"x.sqlite")))
    def test_corrupted_blob_rejected_dest_untouched(self):
        m=self.st.bootstrap(self.db1,now=at(0));dest=os.path.join(self.d,"live.sqlite");open(dest,"w").write("OLD")
        self.corrupt(m["db_key"])
        with self.assertRaises(S.StoreError):self.st.fetch(dest)
        self.assertEqual(open(dest).read(),"OLD");self.assertEqual([f for f in os.listdir(self.d) if f.startswith(".dl_")],[])
    def test_immutable_objects_not_overwritten(self):
        self.st.bootstrap(self.db1,now=at(0))
        with self.assertRaises(S.StoreError):self.st.b.put_bytes(self.st.pointer()["manifest_key"],b"{}")
    def test_crash_before_pointer_keeps_previous_latest(self):
        self.st.bootstrap(self.db1,now=at(0));old=self.st.pointer()
        for point in ("after_blob","after_readback","after_manifest"):
            def hook(n,point=point):
                if n==point:raise RuntimeError("boom")
            S._hook=hook
            try:
                with self.assertRaises(RuntimeError):self.st.publish(self.db2,now=at(5))
            finally:S._hook=lambda n:None
            self.assertEqual(self.st.pointer(),old,point)
            dest=os.path.join(self.d,"f.sqlite");self.st.fetch(dest);self.assertEqual(S.sha256_file(dest),S.sha256_file(self.db1))
            self.cleanup_orphans()
        self.assertEqual(self.st.publish(self.db2,now=at(6))["db_sha256"],S.sha256_file(self.db2))
    def test_parent_guard(self):
        m=self.st.bootstrap(self.db1,now=at(0))
        with self.assertRaises(S.StoreError):self.st.publish(self.db2,expect_parent="deadbeef",now=at(1))
        self.st.publish(self.db2,expect_parent=m["db_sha256"],now=at(1))
    def test_restore_previous_version_safe(self):
        m1=self.st.bootstrap(self.db1,now=at(0));self.st.publish(self.db2,now=at(1))
        ptr=self.st.restore(self.st.pointer()["previous"]);self.assertTrue(ptr["restored"])
        dest=os.path.join(self.d,"r.sqlite");self.st.fetch(dest);self.assertEqual(S.sha256_file(dest),m1["db_sha256"])
        self.corrupt(m1["db_key"])
        with self.assertRaises(S.StoreError):self.st.restore(ptr["manifest_key"])   # refuses to restore a damaged version
    def test_invalid_db_not_published(self):
        bad=os.path.join(self.d,"bad.sqlite");open(bad,"wb").write(b"not sqlite at all"*100)
        with self.assertRaises(S.StoreError):self.st.bootstrap(bad,now=at(0))
        self.assertIsNone(self.st.pointer())
    def test_tampered_manifest_or_pointer(self):
        m=self.st.bootstrap(self.db1,now=at(0));key=self.st.pointer()["manifest_key"]
        self.overwrite(key,b"{not json")
        with self.assertRaises(S.StoreError):self.st.fetch(os.path.join(self.d,"z.sqlite"))
class LocalTests(Common,unittest.TestCase):
    def mk(self):self.st=S.Store(S.LocalBackend(os.path.join(self.d,"bucket")),"egx-central")
    def corrupt(self,key):
        p=self.st.b._p(key);b=bytearray(p.read_bytes());b[len(b)//2]^=0xFF;p.write_bytes(bytes(b))
    def overwrite(self,key,data):self.st.b._p(key).write_bytes(data)
    def cleanup_orphans(self):pass
class S3Tests(Common,unittest.TestCase):
    def mk(self):self.cli=FakeS3();self.st=S.Store(S.S3Backend(self.cli,"bkt"),"egx-central")
    def corrupt(self,key):
        b=bytearray(self.cli.o[key]);b[len(b)//2]^=0xFF;self.cli.o[key]=bytes(b)
    def overwrite(self,key,data):self.cli.o[key]=data
    def cleanup_orphans(self):pass
    def test_versioning_must_be_enabled(self):
        self.cli.v=None
        with self.assertRaises(S.StoreConfigError):self.st.bootstrap(self.db1,now=at(0))
        self.assertEqual(self.cli.o,{})
class JournalStore(unittest.TestCase):
    def test_journal_roundtrip_and_tamper_rejected(self):
        from egx_decision import journal
        d=tempfile.mkdtemp();j=os.path.join(d,"j.jsonl");journal.append(j,"2026-10-29",{"a":1});journal.append(j,"2026-10-30",{"a":2})
        st=S.Store(S.S3Backend(FakeS3(),"b"),"p/journal-store",validator=S.journal_validator,ext=".jsonl",label="journal")
        self.assertIsNone(st.fetch(os.path.join(d,"x"),allow_empty=True))
        st.bootstrap(j,now=at(0));dest=os.path.join(d,"o.jsonl");st.fetch(dest);self.assertEqual(open(dest).read(),open(j).read())
        bad=os.path.join(d,"bad.jsonl");open(bad,"w").write(open(j).read().replace('"a":1','"a":9').replace('"a": 1','"a": 9'))
        with self.assertRaises(S.StoreError):st.publish(bad,now=at(1))
        self.assertEqual(st.pointer()["db_sha256"],S.sha256_file(j))
class Config(unittest.TestCase):
    def test_missing_env_reports_names_not_values(self):
        with self.assertRaises(S.StoreConfigError) as e:S.from_env({"AWS_ACCESS_KEY_ID":"SECRETVALUE"})
        msg=str(e.exception);self.assertIn("EGX_STORE_BUCKET",msg);self.assertIn("AWS_SECRET_ACCESS_KEY",msg);self.assertNotIn("SECRETVALUE",msg)
    def test_from_env_with_injected_client(self):
        st=S.from_env({"EGX_STORE_BUCKET":"b","AWS_ACCESS_KEY_ID":"k","AWS_SECRET_ACCESS_KEY":"s","EGX_STORE_PREFIX":"/pfx/"},client_factory=lambda e:FakeS3())
        self.assertEqual(st.p,"pfx")
    def test_cli_fails_cleanly_without_config(self):
        for k in ("EGX_STORE_BUCKET","AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY"):os.environ.pop(k,None)
        self.assertEqual(S.main(["check-config"]),2)
if __name__=="__main__":unittest.main(verbosity=1)
