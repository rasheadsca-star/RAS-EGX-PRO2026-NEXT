"""Append-only, hash-chained decision journal. A session can be written once; re-runs with identical content are no-ops;
different content for an already-recorded session is refused (no retroactive edits)."""
import json,hashlib,pathlib
class JournalError(RuntimeError):pass
def _h(o):return hashlib.sha256(json.dumps(o,sort_keys=True,ensure_ascii=False,separators=(",",":")).encode()).hexdigest()
def read(path):
    p=pathlib.Path(path)
    if not p.exists():return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
def verify(path):
    prev="GENESIS"
    for e in read(path):
        body={k:v for k,v in e.items() if k!="entry_hash"}
        if e["prev_hash"]!=prev or _h(body)!=e["entry_hash"]:return False
        prev=e["entry_hash"]
    return True
def append(path,session,content):
    """content: dict with only decision facts (no wall-clock fields) so reruns are idempotent."""
    ent=read(path)
    if not verify(path):raise JournalError("journal chain broken")
    ch=_h(content)
    for e in ent:
        if e["session"]==session:
            if e["content_hash"]==ch:return "UNCHANGED"
            raise JournalError(f"session {session} already recorded with different content; retroactive change refused")
    if ent and session<ent[-1]["session"]:raise JournalError("session is older than the latest recorded session")
    prev=ent[-1]["entry_hash"] if ent else "GENESIS"
    body=dict(session=session,content=content,content_hash=ch,prev_hash=prev)
    body["entry_hash"]=_h(body)
    pathlib.Path(path).parent.mkdir(parents=True,exist_ok=True)
    with open(path,"a",encoding="utf-8") as f:f.write(json.dumps(body,ensure_ascii=False)+"\n")
    return "APPENDED"
