#!/usr/bin/env python3
"""Private durable store for the central SQLite on Cloudflare R2 (or any S3-compatible store). NO bucket versioning is required or used.

Data model (everything immutable except two tiny mutable objects):
  <prefix>/db/<UTC ts>_<rawsha12>.sqlite.gz     gzip of the DB, unique name, write-once (never overwritten, never deleted by this code)
  <prefix>/manifests/<same name>.json           raw+stored SHA-256, sizes, parent, last_session, meta - write-once
  <prefix>/pointer-log/<name>.json              write-once record of every pointer move (audit + recovery)
  <prefix>/LATEST.json                          MUTABLE pointer to the current manifest (written LAST)
  <prefix>/usage/<YYYY-MM>.json                 MUTABLE monthly operation ledger (see cost guard)
publish : verify DB -> compress -> cost guard -> upload blob (write-once) -> read BACK and verify -> manifest -> pointer-log -> LATEST.
fetch   : pointer -> manifest -> download -> stored SHA -> gunzip -> raw SHA + size -> integrity_check + schema -> atomic place. No silent fallback.
          `fetch --manifest KEY` reads any older version (verified) WITHOUT moving the pointer. `restore` re-verifies before re-pointing.
recover : if LATEST is lost/corrupt: scan newest manifests, report the newest one that fully verifies; moves the pointer only with --apply.
NO DELETION: the backends have no delete operation. `retention-plan` is a dry-run report only. A retention policy needs the owner's approval first.

COST GUARD (R2 free tier = 10 GB-month, 1M Class A, 10M Class B per month; usage ABOVE it is BILLED, not blocked, and budget alerts do not stop spending):
  * hard ceilings in code = 50% of the free tier; env can only LOWER them. Defaults: 3 GB stored, 100k Class A, 1M Class B per month.
  * publish refuses at 80% of any limit (bytes or monthly ops); every operation is counted (Class A: put/list; Class B: head/get) and a run is aborted
    if it would exceed its own small op budget or 100% of a monthly limit. Ledger unreadable/corrupt => fail closed.
  * objects are single PutObject uploads (multipart threshold 512 MiB; objects > 400 MiB are refused) so no orphan multipart parts accrue storage.
  * Infrequent Access storage is never used (it has no free tier).
env: EGX_STORE_BUCKET, EGX_STORE_ENDPOINT (https://<account>.r2.cloudflarestorage.com), AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (required);
     EGX_STORE_PREFIX (default egx-central), AWS_REGION (default auto), EGX_STORE_LIMIT_BYTES / _CLASS_A / _CLASS_B (may only lower the defaults)."""
import argparse,json,os,sys,gzip,hashlib,pathlib,shutil,sqlite3,tempfile,datetime,traceback,math
SCHEMA="egx-central-store-2";REQUIRED_TABLES=("canonical_bars","symbol_identity","conflicts","corporate_actions","quality_gates")
FREE=dict(bytes=10*10**9,class_a=1_000_000,class_b=10_000_000)
CEIL={k:v//2 for k,v in FREE.items()}
DEFAULTS=dict(bytes=3*10**9,class_a=100_000,class_b=1_000_000)
STOP_AT=0.80;RUN_BUDGET=dict(a=60,b=60);MAX_OBJECT=400*1024*1024;MULTIPART_THRESHOLD=512*1024*1024
class StoreError(RuntimeError):pass
class StoreConfigError(StoreError):pass
class BudgetError(StoreError):pass
_hook=lambda name:None
def sha256_file(p):
    h=hashlib.sha256()
    with open(p,"rb") as f:
        for ch in iter(lambda:f.read(1<<20),b""):h.update(ch)
    return h.hexdigest()
def check_db(path):
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
def journal_validator(path):
    sys.path.insert(0,str(pathlib.Path(__file__).resolve().parent))
    from egx_decision import journal
    if not journal.verify(path):raise StoreError("journal hash-chain verification failed")
    ent=journal.read(path);return dict(last_session=(ent[-1].get("session") if ent else None),rows=len(ent))
def _gzip_file(src,dst):
    with open(src,"rb") as f,open(dst,"wb") as raw:
        with gzip.GzipFile(filename="",mode="wb",fileobj=raw,compresslevel=6,mtime=0) as z:shutil.copyfileobj(f,z,1<<20)
        raw.flush();os.fsync(raw.fileno())
def _gunzip_file(src,dst):
    try:
        with gzip.open(src,"rb") as z,open(dst,"wb") as o:shutil.copyfileobj(z,o,1<<20)
    except (OSError,EOFError) as e:raise StoreError(f"gzip decode failed: {e}")
# ---------------- backends (NO delete operation exists) ----------------
class LocalBackend:
    def __init__(self,root):self.root=pathlib.Path(root);self.root.mkdir(parents=True,exist_ok=True)
    def _p(self,k):return self.root/k
    def head(self,key):
        p=self._p(key);return p.stat().st_size if p.exists() else None
    def put_file(self,key,path,overwrite=False):
        d=self._p(key);d.parent.mkdir(parents=True,exist_ok=True)
        if d.exists() and not overwrite:raise StoreError(f"refusing to overwrite immutable object {key}")
        tmp=d.with_name(d.name+".part");shutil.copyfile(path,tmp);os.replace(tmp,d)
    def put_bytes(self,key,data,overwrite=False):
        d=self._p(key);d.parent.mkdir(parents=True,exist_ok=True)
        if d.exists() and not overwrite:raise StoreError(f"refusing to overwrite immutable object {key}")
        tmp=d.with_name(d.name+".part");tmp.write_bytes(data);os.replace(tmp,d)
    def get_file(self,key,dest):
        s=self._p(key)
        if not s.exists():raise StoreError(f"object not found: {key}")
        shutil.copyfile(s,dest)
    def get_bytes(self,key):
        s=self._p(key)
        if not s.exists():raise StoreError(f"object not found: {key}")
        return s.read_bytes()
    def list_sizes(self,prefix):
        b=self.root;return sorted((str(p.relative_to(b)),p.stat().st_size) for p in b.rglob("*") if p.is_file() and str(p.relative_to(b)).startswith(prefix) and not p.name.endswith(".part"))
class S3Backend:
    """boto3 client for R2/S3. Single-request transfers only (threshold 512 MiB)."""
    def __init__(self,client,bucket,transfer_config=None):self.c=client;self.bucket=bucket;self.tc=transfer_config
    def _kw(self):return {"Config":self.tc} if self.tc is not None else {}
    def head(self,key):
        try:return self.c.head_object(Bucket=self.bucket,Key=key)["ContentLength"]
        except Exception as e:
            code=str(getattr(e,"response",{}).get("Error",{}).get("Code",""))
            if code in("404","NoSuchKey","NotFound"):return None
            raise StoreError(f"head failed for {key}: {type(e).__name__} {code}")
    def put_file(self,key,path,overwrite=False):
        if not overwrite and self.head(key) is not None:raise StoreError(f"refusing to overwrite immutable object {key}")
        self.c.upload_file(str(path),self.bucket,key,**self._kw())
    def put_bytes(self,key,data,overwrite=False):
        if not overwrite and self.head(key) is not None:raise StoreError(f"refusing to overwrite immutable object {key}")
        self.c.put_object(Bucket=self.bucket,Key=key,Body=data)
    def get_file(self,key,dest):
        try:self.c.download_file(self.bucket,key,str(dest),**self._kw())
        except Exception as e:raise StoreError(f"download failed for {key}: {type(e).__name__}")
    def get_bytes(self,key):
        try:return self.c.get_object(Bucket=self.bucket,Key=key)["Body"].read()
        except Exception as e:raise StoreError(f"object not found/unreadable: {key} ({type(e).__name__})")
    def list_sizes(self,prefix):
        out=[];tok=None
        while True:
            kw=dict(Bucket=self.bucket,Prefix=prefix)
            if tok:kw["ContinuationToken"]=tok
            r=self.c.list_objects_v2(**kw);out+=[(o["Key"],o["Size"]) for o in r.get("Contents",[])]
            if not r.get("IsTruncated"):break
            tok=r.get("NextContinuationToken")
        return sorted(out)
# ---------------- cost guard ----------------
class Limits:
    def __init__(self,bytes_=None,class_a=None,class_b=None):
        self.bytes=bytes_ or DEFAULTS["bytes"];self.class_a=class_a or DEFAULTS["class_a"];self.class_b=class_b or DEFAULTS["class_b"]
        for n,v in(("bytes",self.bytes),("class_a",self.class_a),("class_b",self.class_b)):
            if not isinstance(v,int) or v<=0:raise StoreConfigError(f"limit {n} must be a positive integer")
            if v>CEIL[n]:raise StoreConfigError(f"limit {n}={v} exceeds the hard ceiling {CEIL[n]} (50% of the free tier); limits may only be lowered")
    @classmethod
    def from_env(cls,env):
        def g(k):
            v=env.get(k)
            if not v:return None
            try:return int(v)
            except ValueError:raise StoreConfigError(f"{k} must be an integer")
        return cls(g("EGX_STORE_LIMIT_BYTES"),g("EGX_STORE_LIMIT_CLASS_A"),g("EGX_STORE_LIMIT_CLASS_B"))
class Metered:
    """counts every operation, enforces per-run and monthly budgets, tracks a monthly ledger stored in the bucket"""
    def __init__(self,inner,root,limits=None,now=None,run_budget=None):
        self.i=inner;self.root=root.strip("/");self.limits=limits or Limits();self.now=now or datetime.datetime.now(datetime.timezone.utc)
        self.rb=run_budget or RUN_BUDGET;self.a=0;self.b=0;self.base=None;self.month=self.now.strftime("%Y-%m");self.lkey=f"{self.root}/usage/{self.month}.json"
    def _charge(self,cls,n=1):
        self._load()
        if cls=="a":
            if self.a+n>self.rb["a"]:raise BudgetError(f"run Class A budget {self.rb['a']} exceeded")
            if self.base["a"]+self.a+n>self.limits.class_a:raise BudgetError("monthly Class A limit reached; refusing to operate")
            self.a+=n
        else:
            if self.b+n>self.rb["b"]:raise BudgetError(f"run Class B budget {self.rb['b']} exceeded")
            if self.base["b"]+self.b+n>self.limits.class_b:raise BudgetError("monthly Class B limit reached; refusing to operate")
            self.b+=n
    def _load(self):
        if self.base is not None:return
        base=dict(a=0,b=0)
        sz=self.i.head(self.lkey);self.b+=1
        if sz is not None:
            try:
                d=json.loads(self.i.get_bytes(self.lkey).decode("utf-8"));self.b+=1
                if not(isinstance(d.get("a"),int) and isinstance(d.get("b"),int) and d["a"]>=0 and d["b"]>=0):raise ValueError("fields")
                base=dict(a=d["a"],b=d["b"])
            except Exception as e:raise BudgetError(f"usage ledger unreadable ({type(e).__name__}); failing closed")
        self.base=base                                     # assigned ONLY after a successful read (a failed load must stay failed)
    def head(self,key):self._charge("b");return self.i.head(key)
    def get_bytes(self,key):self._charge("b");return self.i.get_bytes(key)
    def get_file(self,key,dest):self._charge("b",2);return self.i.get_file(key,dest)       # download_file = HEAD + GET
    def put_bytes(self,key,data,overwrite=False):
        if not overwrite:self._charge("b")                                                  # existence check
        self._charge("a");return self.i.put_bytes(key,data,overwrite)
    def put_file(self,key,path,overwrite=False):
        if os.path.getsize(path)>MAX_OBJECT:raise StoreError("object larger than 400 MiB refused (would need multipart upload)")
        if not overwrite:self._charge("b")
        self._charge("a");return self.i.put_file(key,path,overwrite)
    def list_sizes(self,prefix):
        r=self.i.list_sizes(prefix);self._charge("a",max(1,math.ceil(len(r)/1000)));return r
    def stored_bytes(self):return sum(s for k,s in self.list_sizes(self.root+"/") if "/usage/" not in k)
    def usage(self):
        self._load();tot=self.stored_bytes()
        return dict(month=self.month,class_a=self.base["a"]+self.a,class_b=self.base["b"]+self.b,stored_bytes=tot,
                    limits=dict(bytes=self.limits.bytes,class_a=self.limits.class_a,class_b=self.limits.class_b),stop_fraction=STOP_AT,
                    pct=dict(bytes=round(100*tot/self.limits.bytes,2),class_a=round(100*(self.base["a"]+self.a)/self.limits.class_a,2),class_b=round(100*(self.base["b"]+self.b)/self.limits.class_b,2)))
    def guard_publish(self,new_bytes,est_a=10,est_b=14):
        """called BEFORE any write: stop the update at 80% of any limit"""
        u=self.usage();L=self.limits
        if u["stored_bytes"]+new_bytes>STOP_AT*L.bytes:raise BudgetError(f"storage guard: {u['stored_bytes']}+{new_bytes} bytes would pass {int(STOP_AT*100)}% of the {L.bytes}-byte limit; update stopped (owner must approve a retention policy)")
        if u["class_a"]+est_a>STOP_AT*L.class_a:raise BudgetError("Class A monthly guard: update stopped at 80% of the limit")
        if u["class_b"]+est_b>STOP_AT*L.class_b:raise BudgetError("Class B monthly guard: update stopped at 80% of the limit")
        return u
    def flush(self):
        """persist this run's operations (always called, also after failures)"""
        if self.base is None and self.a==0 and self.b==0:return
        self._load()
        data=json.dumps(dict(month=self.month,a=self.base["a"]+self.a+1,b=self.base["b"]+self.b,updated_utc=self.now.isoformat()),sort_keys=True).encode()
        self.i.put_bytes(self.lkey,data,overwrite=True);self.base=dict(a=self.base["a"]+self.a+1,b=self.base["b"]+self.b);self.a=0;self.b=0
def from_env(env=None,client_factory=None,kind="db",now=None):
    env=os.environ if env is None else env
    need=["EGX_STORE_BUCKET","EGX_STORE_ENDPOINT","AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY"];miss=[k for k in need if not env.get(k)]
    if miss:raise StoreConfigError("object storage not configured; missing environment: "+", ".join(miss))
    limits=Limits.from_env(env)
    tc=None
    if client_factory is None:
        try:
            import boto3
            from boto3.s3.transfer import TransferConfig
            from botocore.config import Config
        except ImportError:raise StoreConfigError("boto3 is not installed (pip install boto3)")
        tc=TransferConfig(multipart_threshold=MULTIPART_THRESHOLD,multipart_chunksize=MULTIPART_THRESHOLD,max_concurrency=1,use_threads=False)
        def client_factory(env):
            try:cfg=Config(request_checksum_calculation="when_required",response_checksum_validation="when_required",retries={"max_attempts":3,"mode":"standard"})   # R2 rejects the newer default CRC checksums
            except TypeError:cfg=Config(retries={"max_attempts":3,"mode":"standard"})
            return boto3.client("s3",endpoint_url=env["EGX_STORE_ENDPOINT"],region_name=env.get("AWS_REGION") or "auto",config=cfg)
    pre=(env.get("EGX_STORE_PREFIX") or "egx-central").strip("/")
    m=Metered(S3Backend(client_factory(env),env["EGX_STORE_BUCKET"],tc),pre,limits,now)
    return Store(m,pre) if kind=="db" else Store(m,pre+"/journal-store",validator=journal_validator,ext=".jsonl.gz",label="journal")
# ---------------- store ----------------
class Store:
    def __init__(self,backend,prefix="egx-central",validator=None,ext=".sqlite.gz",label="db"):
        self.b=backend;self.p=prefix.strip("/");self.validate=validator or check_db;self.ext=ext;self.label=label
    def k(self,*a):return "/".join([self.p,*a])
    def _meter(self):return self.b if isinstance(self.b,Metered) else None
    def usage(self):
        m=self._meter()
        if m is None:raise StoreError("no cost guard attached")
        return m.usage()
    def flush(self):
        m=self._meter()
        if m:m.flush()
    def pointer(self):
        key=self.k("LATEST.json")
        if self.b.head(key) is None:return None
        try:ptr=json.loads(self.b.get_bytes(key).decode("utf-8"))
        except StoreError:raise
        except Exception as e:raise StoreError(f"corrupt LATEST pointer: {e}")
        if not isinstance(ptr,dict) or "manifest_key" not in ptr or "db_sha256" not in ptr:raise StoreError("LATEST pointer missing fields")
        return ptr
    def manifest(self,key):
        try:m=json.loads(self.b.get_bytes(key).decode("utf-8"))
        except StoreError:raise
        except Exception as e:raise StoreError(f"corrupt manifest {key}: {e}")
        if not isinstance(m,dict):raise StoreError(f"corrupt manifest {key}")
        for f in("schema","stored_key","stored_sha256","stored_size","db_sha256","size"):
            if f not in m:raise StoreError(f"manifest {key} missing {f}")
        return m
    def _download_verified(self,m,dest_dir):
        gz=pathlib.Path(tempfile.mkstemp(dir=dest_dir,prefix=".dl_",suffix=".gz")[1]);raw=pathlib.Path(tempfile.mkstemp(dir=dest_dir,prefix=".dl_",suffix=".raw")[1])
        try:
            self.b.get_file(m["stored_key"],gz)
            if os.path.getsize(gz)!=m["stored_size"]:raise StoreError(f"stored size mismatch for {m['stored_key']}")
            if sha256_file(gz)!=m["stored_sha256"]:raise StoreError(f"SHA-256 mismatch for {m['stored_key']} (object corrupted or replaced)")
            _gunzip_file(gz,raw)
            if os.path.getsize(raw)!=m["size"] or sha256_file(raw)!=m["db_sha256"]:raise StoreError("decompressed content does not match manifest SHA-256")
            info=self.validate(raw);return raw,info
        except BaseException:
            raw.unlink(missing_ok=True);raise
        finally:gz.unlink(missing_ok=True)
    def _move_pointer(self,manifest_key,m,cur,now,restored=False):
        tag=f"{now.strftime('%Y%m%dT%H%M%SZ')}_{'restore_' if restored else ''}{m['db_sha256'][:12]}"
        ptr=dict(schema=SCHEMA,manifest_key=manifest_key,db_sha256=m["db_sha256"],updated_utc=now.isoformat(),previous=(cur or {}).get("manifest_key"))
        if restored:ptr["restored"]=True
        data=json.dumps(ptr,sort_keys=True).encode()
        self.b.put_bytes(self.k("pointer-log",tag+".json"),data);_hook("after_pointer_log")      # write-once audit record first
        self.b.put_bytes(self.k("LATEST.json"),data,overwrite=True);_hook("after_pointer");return ptr
    def publish(self,db,meta=None,expect_parent=None,now=None):
        db=pathlib.Path(db);info=self.validate(db)
        now=now or datetime.datetime.now(datetime.timezone.utc);sha=sha256_file(db);ts=now.strftime("%Y%m%dT%H%M%SZ")
        cur=self.pointer()
        if expect_parent is not None and (cur or {}).get("db_sha256")!=expect_parent:raise StoreError("store changed since fetch (parent mismatch) - refusing to publish over a newer version")
        if cur and cur["db_sha256"]==sha:return self.manifest(cur["manifest_key"])      # idempotent
        scratch=pathlib.Path(tempfile.mkdtemp(dir=db.parent))
        try:
            gz=scratch/"blob.gz";_gzip_file(db,gz);ssha=sha256_file(gz);ssize=os.path.getsize(gz)
            if ssize>MAX_OBJECT:raise StoreError("compressed object larger than 400 MiB refused")
            m_=self._meter()
            if m_:m_.guard_publish(ssize+4096)                                        # STOP at 80% BEFORE writing anything
            name=f"{ts}_{sha[:12]}";dbk=self.k(self.label,name+self.ext);mk=self.k("manifests",name+".json")
            self.b.put_file(dbk,gz);_hook("after_blob")
            rb=scratch/"rb.gz";self.b.get_file(dbk,rb)
            if sha256_file(rb)!=ssha:raise StoreError("read-back SHA-256 mismatch after upload; pointer NOT moved")
            chk=scratch/"rb.raw";_gunzip_file(rb,chk)
            if sha256_file(chk)!=sha:raise StoreError("read-back content mismatch after upload; pointer NOT moved")
        finally:shutil.rmtree(scratch,ignore_errors=True)
        _hook("after_readback")
        m=dict(schema=SCHEMA,stored_key=dbk,stored_sha256=ssha,stored_size=ssize,compression="gzip",db_sha256=sha,size=os.path.getsize(db),created_utc=now.isoformat(),
               last_session=info["last_session"],canonical_rows=info["rows"],parent_manifest=(cur or {}).get("manifest_key"),parent_sha256=(cur or {}).get("db_sha256"),meta=meta or {})
        self.b.put_bytes(mk,json.dumps(m,sort_keys=True,indent=1).encode());_hook("after_manifest")
        self._move_pointer(mk,m,cur,now);return m
    def bootstrap(self,db,meta=None,now=None):
        if self.pointer() is not None:raise StoreError("store already initialised; use publish")
        return self.publish(db,meta,now=now)
    def fetch(self,dest,allow_empty=False,manifest_key=None):
        """verified version -> dest (atomic). Latest by default; a specific older manifest on request (pointer is NOT moved)."""
        ptr=None
        if manifest_key is None:
            ptr=self.pointer()
            if ptr is None and allow_empty:return None
            if ptr is None:raise StoreError("store is empty (no LATEST); bootstrap first - refusing to proceed without the central DB")
            manifest_key=ptr["manifest_key"]
        m=self.manifest(manifest_key)
        if ptr and m["db_sha256"]!=ptr["db_sha256"]:raise StoreError("pointer/manifest SHA mismatch")
        dest=pathlib.Path(dest);dest.parent.mkdir(parents=True,exist_ok=True)
        tmp,_=self._download_verified(m,dest.parent);os.chmod(tmp,0o644);os.replace(tmp,dest);return m
    def versions(self,limit=20):
        keys=sorted(k for k,_ in self.b.list_sizes(self.k("manifests")+"/"))[-limit:];out=[]
        for k in reversed(keys):
            try:m=self.manifest(k);out.append(dict(manifest_key=k,created_utc=m["created_utc"],last_session=m.get("last_session"),sha256=m["db_sha256"],stored_size=m["stored_size"]))
            except StoreError as e:out.append(dict(manifest_key=k,error=str(e)))
        return out
    def restore(self,manifest_key,now=None):
        m=self.manifest(manifest_key);scratch=tempfile.mkdtemp()
        try:tmp,_=self._download_verified(m,scratch)
        finally:shutil.rmtree(scratch,ignore_errors=True)
        cur=None
        try:cur=self.pointer()
        except StoreError:pass                                   # restoring is how a corrupt pointer gets fixed
        return self._move_pointer(manifest_key,m,cur,now or datetime.datetime.now(datetime.timezone.utc),restored=True)
    def recover(self,apply=False,candidates=5,now=None):
        """pointer lost/corrupt: newest manifest whose blob fully verifies. Pointer moves only with apply=True."""
        keys=sorted(k for k,_ in self.b.list_sizes(self.k("manifests")+"/"))[-candidates:];tried=[]
        for k in reversed(keys):
            try:
                m=self.manifest(k);scratch=tempfile.mkdtemp()
                try:tmp,_=self._download_verified(m,scratch)
                finally:shutil.rmtree(scratch,ignore_errors=True)
            except StoreError as e:tried.append(dict(manifest_key=k,error=str(e)));continue
            res=dict(manifest_key=k,last_session=m.get("last_session"),db_sha256=m["db_sha256"],skipped_invalid=tried,applied=False)
            if apply:self._move_pointer(k,m,None,now or datetime.datetime.now(datetime.timezone.utc),restored=True);res["applied"]=True
            return res
        raise StoreError(f"no verifiable version among the newest {candidates} manifests: {tried}")
    def retention_plan(self):
        """DRY RUN ONLY. This code has no delete operation; an approved policy must be written and reviewed first."""
        v=self.versions(limit=1000);tot=sum(s for k,s in self.b.list_sizes(self.p+"/") if "/usage/" not in k)
        return dict(policy="NONE_APPROVED",deletions_performed=0,deletable_now=[],versions=len(v),stored_bytes=tot,
                    note="No automatic deletion exists. When storage approaches the guard the update STOPS; the owner decides what to remove manually.")
def main(argv=None):
    ap=argparse.ArgumentParser();ap.add_argument("--kind",choices=["db","journal"],default="db");sub=ap.add_subparsers(dest="cmd",required=True)
    f=sub.add_parser("fetch");f.add_argument("--dest",required=True);f.add_argument("--allow-empty",action="store_true");f.add_argument("--manifest",default=None)
    for n in("publish","bootstrap"):
        s=sub.add_parser(n);s.add_argument("--db",required=True);s.add_argument("--meta",default=None);s.add_argument("--expect-parent",default=None)
    for n in("list","usage","check-config","retention-plan"):sub.add_parser(n)
    r=sub.add_parser("restore");r.add_argument("--manifest",required=True);rc=sub.add_parser("recover");rc.add_argument("--apply",action="store_true")
    x=ap.parse_args(argv);st=None
    try:
        st=from_env(kind=x.kind)
        if x.cmd=="check-config":out=dict(status="OK",latest=(st.pointer() or {}).get("manifest_key"),usage=st.usage())
        elif x.cmd=="usage":out=dict(status="OK",usage=st.usage())
        elif x.cmd=="fetch":
            m=st.fetch(x.dest,allow_empty=x.allow_empty,manifest_key=x.manifest);out=dict(status="OK",empty=True) if m is None else dict(status="OK",db_sha256=m["db_sha256"],last_session=m["last_session"],manifest=m["stored_key"])
        elif x.cmd in("publish","bootstrap"):
            meta=json.loads(pathlib.Path(x.meta).read_text(encoding="utf-8")) if x.meta else None
            m=(st.publish(x.db,meta,x.expect_parent) if x.cmd=="publish" else st.bootstrap(x.db,meta));out=dict(status="OK",db_sha256=m["db_sha256"],last_session=m["last_session"],stored_key=m["stored_key"],stored_size=m["stored_size"],usage=st.usage())
        elif x.cmd=="list":out=dict(status="OK",versions=st.versions())
        elif x.cmd=="retention-plan":out=dict(status="OK",plan=st.retention_plan())
        elif x.cmd=="recover":out=dict(status="OK",**st.recover(apply=x.apply))
        else:out=dict(status="OK",pointer=st.restore(x.manifest))
        rc_=0
    except BaseException as e:
        sys.stderr.write(traceback.format_exc());out=dict(status="FAILED",error=f"{type(e).__name__}: {e}");rc_=2
    finally:
        try:
            if st is not None:st.flush()
        except BaseException as e:
            sys.stderr.write(f"ledger flush failed: {e}\n");rc_=2;out=dict(status="FAILED",error=f"ledger flush failed: {type(e).__name__}: {e}")
    print(json.dumps(out,ensure_ascii=False));return rc_
if __name__=="__main__":sys.exit(main())
