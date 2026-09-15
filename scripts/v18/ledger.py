from pathlib import Path
import json
from scripts.v18.core import canonical_hash

def append(path: Path, record: dict):
    ledger=json.loads(path.read_text()) if path.exists() else {"schemaVersion":"18.0.0-append-only","entries":[]}
    entries=ledger.get("entries",[]); prior=entries[-1]["recordHash"] if entries else "GENESIS"
    item={**record,"previousHash":prior}; item["recordHash"]=canonical_hash(item)
    if any(x.get("experimentId")==item.get("experimentId") for x in entries): raise ValueError("DUPLICATE_EXPERIMENT")
    entries.append(item); ledger["entries"]=entries; ledger["ledgerHash"]=canonical_hash(entries)
    path.parent.mkdir(parents=True,exist_ok=True); path.write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n'); return item

def verify(ledger):
    prior="GENESIS"
    for item in ledger.get("entries",[]):
        body={k:v for k,v in item.items() if k!="recordHash"}
        if item.get("previousHash")!=prior or canonical_hash(body)!=item.get("recordHash"): return False
        prior=item["recordHash"]
    return True
