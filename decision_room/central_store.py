#!/usr/bin/env python3
"""Private durable store for the central SQLite (S3 / Cloudflare R2 compatible object storage WITH versioning).
The big DB never goes into Git. Git holds code/config/test reports only.

Layout under <prefix>/ :  db/<ts>_<sha12>.sqlite  (immutable)   manifests/<ts>_<sha12>.json (immutable)   LATEST.json (pointer, written LAST)
 publish : verify local DB (integrity+schema) -> upload blob -> read BACK and compare SHA-256 -> write manifest -> move pointer.  Nothing is ever overwritten or deleted
           (except the pointer; its previous value is kept inside the new pointer and in bucket versioning).
 fetch   : pointer -> manifest -> download -> size + SHA-256 + integrity_check + schema -> atomic place. Any mismatch = hard error (NO silent fallback to an older DB).
 restore : explicit, re-points LATEST at an older manifest AFTER re-verifying that blob.
No credentials/buckets are assumed: configuration comes only from the environment and missing names are reported (StoreConfigError). Secrets are never printed.
env: EGX_STORE_BUCKET (required) EGX_STORE_PREFIX (default 'egx-central') EGX_STORE_ENDPOINT (R2/MinIO, optional) + AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (required) [AWS_REGION optional]"""
import argparse,json,os,sys,hashlib,pathlib,shutil,sqlite3,tempfile,datetime,traceback
SCHEMA="egx-central-store-1";REQUIRED_TABLES=("canonical_bars","symbol_identity","conflicts","corporate_actions","quality_gates")
class StoreError(RuntimeError):pass
class StoreConfigError(StoreError):pass
_hook=lambda name:None
def sha256_file(p):
    h=hashlib.sha256()
    with open(p,"rb") as f:
        for ch in iter(lambda:f.read(1<<20),b""):h.update(ch)
    return h.hexdigest()
def check_db(path):
    """integrity + required tables; returns dict(last_session,rows)"""
    try:
        c=sqlite3.connect(f"file:{path}?mode=ro",uri=True)
        try:
            if c.execute("pragma integrity_check").fetchone()[0]!="ok":raise StoreError("integrity_check failed")
            have={r[0] for r in c.execute("select name from sqlite_master where type='table'")}
            miss=[t for t in REQUIRED_TABLES if t not in have]
            if miss:raise StoreError(f"missing tables {miss}")
            return dict(last_session=c.execute("select max(date) from canonical_bars where price_basis='RAW'").fetchone()[0],rows=c.execute("select count(*) from canonical_bars").fetchone()[0])
        finally:c.close()
    except sqlite3.DatabaseError as e:raise StoreError(f"not a valid SQLite DB: {e}")
# ---------------- backends ----------------
class LocalBackend:
    """Directory-backed backend (tests / dry runs). Keys other than pointer.* are write-once."""
    versioned=True
    def __init__(self,root):self.root=pathlib.Path(root);self.root.mkdir(parents=True,exist_ok=True);self.history=[]
    def _p(self,k):return self.root/k
    def put_file(self,key,path,overwrite=False):
        d=self._p(key);d.parent.mkdir(parents=True,exist_ok=True)
        if d.exists() and not overwrite:raise StoreError(f"refusing to overwrite immutable object {key}")
        tmp=d.with_name(d.name+".part");shutil.copyfile(path,tmp);os.replace(tmp,d)
    def put_bytes(self,key,data,overwrite=False):
        d=self._p(key);d.parent.mkdir(parents=True,exist_ok=True)
        if d.exists() and not overwrite:raise StoreError(f"refusing to overwrite immutable object {key}")
        if d.exists():self.history.append((key,d.read_bytes()))
        tmp=d.with_name(d.name+".part");tmp.write_bytes(data);os.replace(tmp,d)
    def get_file(self,key,dest):
        s=self._p(key)
        if not s.exists():raise StoreError(f"object not found: {key}")
        shutil.copyfile(s,dest)
    def get_bytes(self,key):
        s=self._p(key)
        if not s.exists():raise StoreError(f"object not found: {key}")
        return s.read_bytes()
    def exists(self,key):return self._p(key).exists()
    def list(self,prefix):
        base=self.root;return sorted(str(p.relative_to(base)) for p in base.rglob("*") if p.is_file() and str(p.relative_to(base)).startswith(prefix) and not p.name.endswith(".part"))
    def versioning_enabled(self):return True
class S3Backend:
    """boto3 client (S3 or R2 with endpoint_url). Requires bucket versioning = Enabled (checked, not assumed)."""
    def __init__(self,client,bucket):self.c=client;self.bucket=bucket
    def put_file(self,key,path,overwrite=False):
        if not overwrite and self.exists(key):raise StoreError(f"refusing to overwrite immutable object {key}")
        self.c.upload_file(str(path),self.bucket,key)
    def put_bytes(self,key,data,overwrite=False):
        if not overwrite and self.exists(key):raise StoreError(f"refusing to overwrite immutable object {key}")
        self.c.put_object(Bucket=self.bucket,Key=key,Body=data)
    def get_file(self,key,dest):self.c.download_file(self.bucket,key,str(dest))
    def get_bytes(self,key):
        try:return self.c.get_object(Bucket=self.bucket,Key=key)["Body"].read()
        except Exception as e:raise StoreError(f"object not found/unreadable: {key} ({type(e).__name__})")
    def exists(self,key):
        r=self.c.list_objects_v2(Bucket=self.bucket,Prefix=key);return any(o["Key"]==key for o in r.get("Contents",[]))
    def list(self,prefix):
        out=[];tok=None
        while True:
            kw=dict(Bucket=self.bucket,Prefix=prefix)
            if tok:kw["ContinuationToken"]=tok
            r=self.c.list_objects_v2(**kw);out+=[o["Key"] for o in r.get("Contents",[])]
            if not r.get("IsTruncated"):break
            tok=r.get("NextContinuationToken")
        return sorted(out)
    def versioning_enabled(self):return self.c.get_bucket_versioning(Bucket=self.bucket).get("Status")=="Enabled"
def from_env(env=None,client_factory=None,kind="db"):
    env=os.environ if env is None else env
    need=["EGX_STORE_BUCKET","AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY"];miss=[k for k in need if not env.get(k)]
    if miss:raise StoreConfigError("object storage not configured; missing environment: "+", ".join(miss))
    if client_factory is None:
        try:import boto3
        except ImportError:raise StoreConfigError("boto3 is not installed (pip install boto3)")
        def client_factory(env):
            kw={}
            if env.get("EGX_STORE_ENDPOINT"):kw["endpoint_url"]=env["EGX_STORE_ENDPOINT"]
            if env.get("AWS_REGION"):kw["region_name"]=env["AWS_REGION"]
            return boto3.client("s3",**kw)
    pre=env.get("EGX_STORE_PREFIX","egx-central").strip("/")
    be=S3Backend(client_factory(env),env["EGX_STORE_BUCKET"])
    return Store(be,pre) if kind=="db" else Store(be,pre+"/journal-store",validator=journal_validator,ext=".jsonl",label="journal")
def journal_validator(path):
    sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
    from egx_decision import journal
    if not journal.verify(path):raise StoreError("journal hash-chain verification failed")
    n=len(journal.read(path));return dict(last_session=(journal.read(path)[-1].get("session") if n else None),rows=n)
# ---------------- store ----------------
class Store:
    def __init__(self,backend,prefix="egx-central",validator=None,ext=".sqlite",label="db"):
        self.b=backend;self.p=prefix.strip("/");self.validate=validator or check_db;self.ext=ext;self.label=label
    def k(self,*a):return "/".join([self.p,*a])
    def preflight(self):
        if not self.b.versioning_enabled():raise StoreConfigError("bucket versioning is NOT enabled - refusing to use this bucket for the central DB")
    def pointer(self):
        key=self.k("LATEST.json")
        if not self.b.exists(key):return None
        try:ptr=json.loads(self.b.get_bytes(key).decode("utf-8"))
        except Exception as e:raise StoreError(f"corrupt LATEST pointer: {e}")
        if "manifest_key" not in ptr or "db_sha256" not in ptr:raise StoreError("LATEST pointer missing fields")
        return ptr
    def manifest(self,key):
        try:m=json.loads(self.b.get_bytes(key).decode("utf-8"))
        except StoreError:raise
        except Exception as e:raise StoreError(f"corrupt manifest {key}: {e}")
        for f in ("schema","db_key","db_sha256","size"):
            if f not in m:raise StoreError(f"manifest {key} missing {f}")
        return m
    def _download_verified(self,m,dest_dir):
        tmp=pathlib.Path(tempfile.mkstemp(dir=dest_dir,prefix=".dl_",suffix=".sqlite")[1])
        try:
            self.b.get_file(m["db_key"],tmp)
            if os.path.getsize(tmp)!=m["size"]:raise StoreError(f"size mismatch for {m['db_key']}")
            if sha256_file(tmp)!=m["db_sha256"]:raise StoreError(f"SHA-256 mismatch for {m['db_key']} (object corrupted or replaced)")
            info=self.validate(tmp);return tmp,info
        except BaseException:
            tmp.unlink(missing_ok=True);raise
    def publish(self,db,meta=None,expect_parent=None,now=None):
        """upload a verified new version; returns manifest dict. Pointer is moved LAST."""
        self.preflight();db=pathlib.Path(db);info=self.validate(db)
        now=now or datetime.datetime.now(datetime.timezone.utc);sha=sha256_file(db);ts=now.strftime("%Y%m%dT%H%M%SZ")
        cur=self.pointer()
        if expect_parent is not None and (cur or {}).get("db_sha256")!=expect_parent:raise StoreError("store changed since fetch (parent mismatch) - refusing to publish over a newer version")
        if cur and cur["db_sha256"]==sha:return self.manifest(cur["manifest_key"])      # idempotent
        name=f"{ts}_{sha[:12]}";dbk=self.k(self.label,name+self.ext);mk=self.k("manifests",name+".json")
        self.b.put_file(dbk,db);_hook("after_blob")
        scratch=tempfile.mkdtemp(dir=db.parent)
        try:
            rb=pathlib.Path(scratch)/"rb.sqlite";self.b.get_file(dbk,rb)
            if sha256_file(rb)!=sha:raise StoreError("read-back SHA-256 mismatch after upload; pointer NOT moved")
        finally:shutil.rmtree(scratch,ignore_errors=True)
        _hook("after_readback")
        m=dict(schema=SCHEMA,db_key=dbk,db_sha256=sha,size=os.path.getsize(db),created_utc=now.isoformat(),last_session=info["last_session"],canonical_rows=info["rows"],
               parent_manifest=(cur or {}).get("manifest_key"),parent_sha256=(cur or {}).get("db_sha256"),meta=meta or {})
        self.b.put_bytes(mk,json.dumps(m,sort_keys=True,indent=1).encode());_hook("after_manifest")
        ptr=dict(schema=SCHEMA,manifest_key=mk,db_sha256=sha,updated_utc=now.isoformat(),previous=(cur or {}).get("manifest_key"))
        self.b.put_bytes(self.k("LATEST.json"),json.dumps(ptr,sort_keys=True).encode(),overwrite=True);_hook("after_pointer")
        return m
    def bootstrap(self,db,meta=None,now=None):
        self.preflight()
        if self.pointer() is not None:raise StoreError("store already initialised; use publish")
        return self.publish(db,meta,now=now)
    def fetch(self,dest,allow_empty=False):
        """verified latest -> dest (atomic). Returns manifest. No fallback to older versions."""
        self.preflight();ptr=self.pointer()
        if ptr is None and allow_empty:return None
        if ptr is None:raise StoreError("store is empty (no LATEST); bootstrap first - refusing to proceed without the central DB")
        m=self.manifest(ptr["manifest_key"])
        if m["db_sha256"]!=ptr["db_sha256"]:raise StoreError("pointer/manifest SHA mismatch")
        dest=pathlib.Path(dest);dest.parent.mkdir(parents=True,exist_ok=True)
        tmp,info=self._download_verified(m,dest.parent)
        os.chmod(tmp,0o644);os.replace(tmp,dest);return m
    def versions(self):
        out=[]
        for k in self.b.list(self.k("manifests")+"/"):
            try:m=self.manifest(k);out.append(dict(manifest_key=k,created_utc=m["created_utc"],last_session=m.get("last_session"),sha256=m["db_sha256"],size=m["size"]))
            except StoreError as e:out.append(dict(manifest_key=k,error=str(e)))
        return out
    def restore(self,manifest_key,now=None):
        """explicitly re-point LATEST at an older version, after re-verifying that blob end-to-end"""
        self.preflight();m=self.manifest(manifest_key);scratch=tempfile.mkdtemp()
        try:
            tmp,_=self._download_verified(m,scratch)
        finally:shutil.rmtree(scratch,ignore_errors=True)
        cur=self.pointer();now=now or datetime.datetime.now(datetime.timezone.utc)
        ptr=dict(schema=SCHEMA,manifest_key=manifest_key,db_sha256=m["db_sha256"],updated_utc=now.isoformat(),previous=(cur or {}).get("manifest_key"),restored=True)
        self.b.put_bytes(self.k("LATEST.json"),json.dumps(ptr,sort_keys=True).encode(),overwrite=True);return ptr
def main(argv=None):
    ap=argparse.ArgumentParser();ap.add_argument("--kind",choices=["db","journal"],default="db");sub=ap.add_subparsers(dest="cmd",required=True)
    f=sub.add_parser("fetch");f.add_argument("--dest",required=True);f.add_argument("--allow-empty",action="store_true")
    for n in ("publish","bootstrap"):
        s=sub.add_parser(n);s.add_argument("--db",required=True);s.add_argument("--meta",default=None,help="path to JSON (e.g. ingest report) stored in the manifest");s.add_argument("--expect-parent",default=None)
    sub.add_parser("list");r=sub.add_parser("restore");r.add_argument("--manifest",required=True);sub.add_parser("check-config")
    x=ap.parse_args(argv)
    try:
        st=from_env(kind=x.kind)
        if x.cmd=="check-config":st.preflight();out=dict(status="OK",bucket_versioning="Enabled",latest=(st.pointer() or {}).get("manifest_key"))
        elif x.cmd=="fetch":
            m=st.fetch(x.dest,allow_empty=x.allow_empty);out=dict(status="OK",empty=True) if m is None else dict(status="OK",db_sha256=m["db_sha256"],last_session=m["last_session"],manifest=m["db_key"])
        elif x.cmd in("publish","bootstrap"):
            meta=json.loads(pathlib.Path(x.meta).read_text(encoding="utf-8")) if x.meta else None
            m=(st.publish(x.db,meta,x.expect_parent) if x.cmd=="publish" else st.bootstrap(x.db,meta));out=dict(status="OK",db_sha256=m["db_sha256"],last_session=m["last_session"],db_key=m["db_key"])
        elif x.cmd=="list":out=dict(status="OK",versions=st.versions())
        else:out=dict(status="OK",pointer=st.restore(x.manifest))
        print(json.dumps(out,ensure_ascii=False));return 0
    except BaseException as e:
        sys.stderr.write(traceback.format_exc());print(json.dumps(dict(status="FAILED",error=f"{type(e).__name__}: {e}"),ensure_ascii=False));return 2
if __name__=="__main__":sys.exit(main())
