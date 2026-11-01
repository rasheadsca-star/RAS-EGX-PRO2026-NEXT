"""Failure-safe publication.
Layout under <out>/: releases/<session>-<sha12>/{index.html,decision_snapshot.json,MANIFEST.json}, current -> releases/<id> (atomic symlink swap), job_health.json.
Order: stage -> verify -> journal (atomic) -> rename stage to release (atomic) -> swap `current` (atomic) -> health.
Invariants: (1) `current` always points to a fully verified release (or does not exist); (2) every published release is journaled;
(3) a crash at any step is repaired by simply re-running (idempotent convergence); (4) no partial file is ever visible."""
import os,json,hashlib,pathlib,shutil
from . import journal,snapshot as snapmod,render
KEEP=5
class PublishError(RuntimeError):pass
def _hook(name):pass   # fault-injection point for tests
def _sha(b):return hashlib.sha256(b).hexdigest()
def _fsync_dir(p):
    fd=os.open(p,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)
def _write_file(path,data):
    with open(path,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
def release_id(snap):return f"{snap['source_session']}-{snap['content_sha256'][:12]}"
def _verify_dir(d,snap):
    d=pathlib.Path(d);m=json.loads((d/"MANIFEST.json").read_text())
    for name,h in m["files"].items():
        if _sha((d/name).read_bytes())!=h:raise PublishError(f"hash mismatch {name}")
    s=json.loads((d/"decision_snapshot.json").read_text(),parse_constant=lambda c:(_ for _ in ()).throw(PublishError("NaN in json")))
    if s["content_sha256"]!=snap["content_sha256"]:raise PublishError("snapshot hash mismatch")
    if snap["content_sha256"] not in (d/"index.html").read_text(encoding="utf-8"):raise PublishError("html does not embed this snapshot")
    return True
def current_release(out):
    c=pathlib.Path(out)/"current"
    return os.path.basename(os.readlink(c)) if c.is_symlink() else None
def publish(out,snap,journal_path=None):
    """Returns dict(journal=..., release=..., swapped=bool). Raises on any failure leaving published state intact."""
    out=pathlib.Path(out);rel=out/"releases";rel.mkdir(parents=True,exist_ok=True)
    for s in rel.glob(".staging-*"):shutil.rmtree(s,ignore_errors=True)       # recover from earlier crash
    rid=release_id(snap);final=rel/rid;stage=rel/f".staging-{rid}"
    html=render.page(snap).encode("utf-8");sj=json.dumps(snap,ensure_ascii=False,indent=1,allow_nan=False).encode("utf-8")
    info=dict(release=rid,journal=None,swapped=False)
    try:
        if not final.exists():
            stage.mkdir();_write_file(stage/"index.html",html);_hook("after_html_written")
            _write_file(stage/"decision_snapshot.json",sj);_hook("after_snapshot_written")
            _write_file(stage/"MANIFEST.json",json.dumps(dict(release=rid,files={"index.html":_sha(html),"decision_snapshot.json":_sha(sj)}),indent=1).encode())
            _fsync_dir(stage);_verify_dir(stage,snap);_hook("after_verify")
        if journal_path:
            info["journal"]=journal.append(journal_path,snap["source_session"],snapmod.decision_facts(snap));_hook("after_journal")
        if not final.exists():
            os.rename(stage,final);_fsync_dir(rel);_hook("after_release_rename")
        _verify_dir(final,snap)
        if current_release(out)!=rid:
            tmp=out/".current.tmp"
            if tmp.is_symlink() or tmp.exists():tmp.unlink()
            os.symlink(os.path.join("releases",rid),tmp);_hook("before_symlink_swap")
            os.replace(tmp,out/"current");_fsync_dir(out);info["swapped"]=True
        _hook("after_swap")
    except BaseException:
        shutil.rmtree(stage,ignore_errors=True)
        t=out/".current.tmp"
        if t.is_symlink():t.unlink()
        raise
    olds=sorted([p for p in rel.iterdir() if p.is_dir() and not p.name.startswith(".") and p.name!=rid],key=lambda p:p.name)
    for p in olds[:-(KEEP-1)] if len(olds)>=KEEP else []:shutil.rmtree(p,ignore_errors=True)
    return info
