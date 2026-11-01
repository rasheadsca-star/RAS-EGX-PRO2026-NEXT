"""Append-only, hash-chained decision journal.
Write safety: every append rewrites the whole file to a temp file, fsyncs it, then os.replace()s it (atomic) and fsyncs the
directory, so a crash can never leave a torn line. A torn/corrupt tail created by something else is detected by verify()
and can only be removed explicitly by recover_torn_tail() (never silently)."""
import json,hashlib,pathlib,os,tempfile
class JournalError(RuntimeError):pass
def _h(o):return hashlib.sha256(json.dumps(o,sort_keys=True,ensure_ascii=False,separators=(",",":")).encode()).hexdigest()
def _lines(path):
    p=pathlib.Path(path)
    return [l for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.exists() else []
def read(path):
    out=[]
    for i,l in enumerate(_lines(path)):
        try:out.append(json.loads(l))
        except ValueError:raise JournalError(f"torn/corrupt journal line {i+1}")
    return out
def verify(path):
    try:ent=read(path)
    except JournalError:return False
    prev="GENESIS"
    for e in ent:
        body={k:v for k,v in e.items() if k!="entry_hash"}
        if e.get("prev_hash")!=prev or _h(body)!=e.get("entry_hash"):return False
        prev=e["entry_hash"]
    return True
def recover_torn_tail(path):
    """Explicit repair: drop ONE trailing unparsable line if (and only if) everything before it verifies. Returns True if repaired."""
    ls=_lines(path)
    if not ls:return False
    try:json.loads(ls[-1]);return False
    except ValueError:pass
    _write_atomic(path,[l for l in ls[:-1]])
    if not verify(path):raise JournalError("journal damaged beyond the tail; manual review required")
    return True
def _write_atomic(path,lines):
    p=pathlib.Path(path);p.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(dir=p.parent,prefix=".jtmp_")
    try:
        with os.fdopen(fd,"w",encoding="utf-8") as f:
            f.write("".join(l+"\n" for l in lines));f.flush();os.fsync(f.fileno())
        _hook("journal_before_replace")
        os.chmod(tmp,0o644);os.replace(tmp,p)
    except BaseException:
        try:os.unlink(tmp)
        except OSError:pass
        raise
    dfd=os.open(p.parent,os.O_RDONLY)
    try:os.fsync(dfd)
    finally:os.close(dfd)
def _hook(name):pass   # fault-injection point for tests
def append(path,session,content):
    """content: decision facts only (no wall-clock) so reruns are idempotent."""
    ent=read(path)
    if not verify(path):raise JournalError("journal chain broken")
    ch=_h(content)
    for e in ent:
        if e["session"]==session:
            if e["content_hash"]==ch:return "UNCHANGED"
            raise JournalError(f"session {session} already recorded with different content; retroactive change refused")
    if ent and session<ent[-1]["session"]:raise JournalError("session is older than the latest recorded session")
    prev=ent[-1]["entry_hash"] if ent else "GENESIS"
    body=dict(session=session,content=content,content_hash=ch,prev_hash=prev);body["entry_hash"]=_h(body)
    _write_atomic(path,_lines(path)+[json.dumps(body,ensure_ascii=False)])
    return "APPENDED"
