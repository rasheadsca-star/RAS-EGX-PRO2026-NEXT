#!/usr/bin/env python3
"""Atomic, replay-safe EGX official merge for RESEARCH ONLY.

Tickers derived from previous close/name are provisional. NEVER label such
bars OFFICIAL_EGX or publish executable trading recommendations.
"""
import argparse, hashlib, json, os, shutil, sqlite3, tempfile
from pathlib import Path
from official_resolver import norm

class MergeError(RuntimeError):pass

def sha(path):
    h=hashlib.sha256()
    with open(path,"rb") as f:
        for chunk in iter(lambda:f.read(1048576),b""):h.update(chunk)
    return h.hexdigest()
def fsync_file(path):
    fd=os.open(path,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)
def fsync_dir(path):
    fd=os.open(path,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)

def merge(db,pdf,mapping,session,research_allow_provisional=False,fail_at=None,bulletin=None):
    db=Path(db).resolve();pdf=Path(pdf).resolve()
    if not db.is_file() or not pdf.is_file():raise MergeError("MISSING_DATABASE_OR_SOURCE_PDF")
    if not research_allow_provisional:raise MergeError("UNVERIFIED_SYMBOL_MAPPING: research only; approval required")
    body=json.loads(Path(mapping).read_text(encoding="utf-8"))
    meta=body["summary"];items=body["items"];digest=sha(pdf)
    if meta.get("source_sha256")!=digest:raise MergeError("PDF_SHA256_MISMATCH")
    if meta.get("mapping_verification")!="PROVISIONAL_REQUIRES_APPROVAL":raise MergeError("MAPPING_PROVENANCE_UNKNOWN")
    if meta.get("source_rows")!=len(items) or not items:raise MergeError("ROW_COUNT_MISMATCH")
    if len({(r["market"],r["rank"]) for r in items})!=len(items):raise MergeError("DUPLICATE_MARKET_RANK")
    if meta.get("provisional")!=sum(bool(r.get("ticker")) for r in items):raise MergeError("MATCH_COUNT_MISMATCH")
    if any(r.get("currency")!="EGP" for r in items if r.get("ticker")):raise MergeError("NON_EGP_MAPPED")
    if bulletin is None:raise MergeError("STAGED_BULLETIN_REQUIRED")
    original=json.loads(Path(bulletin).read_text(encoding="utf-8"))
    if original.get("pdf_sha256")!=digest or original.get("session")!=session:
        raise MergeError("STAGED_SOURCE_DATE_OR_SHA_MISMATCH")
    if len(original.get("items",[]))!=len(items):raise MergeError("STAGED_SOURCE_COUNT_MISMATCH")
    for idx,mapped in enumerate(items):
        raw=original["items"][idx]
        if mapped.get("row_index")!=idx:raise MergeError("STAGED_ROW_ORDER_MISMATCH")
        for field in ("page","rank","market","name","currency","open","high","low","close","chg_pct","volume","trades"):
            if mapped.get(field)!=raw.get(field):
                raise MergeError("STAGED_ROW_CHANGED:%d:%s"%(idx,field))
    before=sha(db)
    fd,p=tempfile.mkstemp(prefix=".official_stage_",suffix=".sqlite",dir=db.parent)
    os.close(fd);temp=Path(p);c=None
    try:
        src=sqlite3.connect("file:"+str(db)+"?mode=ro",uri=True)
        c=sqlite3.connect(temp)
        try:src.backup(c)
        finally:src.close()
        if c.execute("pragma integrity_check").fetchone()[0]!="ok":raise MergeError("STAGED_DB_INTEGRITY")
        c.execute("""create table if not exists official_alias_registry(
            alias_normalized text primary key,ticker text not null,status text not null,
            first_session text not null,source_sha256 text not null,evidence_json text not null)""")
        prior=c.execute("select max(date) from canonical_bars where price_basis='RAW'").fetchone()[0]
        if prior not in (meta["previous_session"],session):raise MergeError("UNEXPECTED_PREVIOUS_SESSION:"+str(prior))
        known={r[0] for r in c.execute("select ticker from symbol_identity")}
        inserted=0
        for r in items:
            t=r.get("ticker");market=r["market"];rank=r["rank"]
            if t and t not in known:raise MergeError("UNRECOGNISED_TICKER:"+t)
            if t:
                alias_key=norm(r["name"])
                if not alias_key:raise MergeError("EMPTY_NORMALIZED_ALIAS")
                existing_alias=c.execute("select ticker from official_alias_registry where alias_normalized=?",(alias_key,)).fetchone()
                if existing_alias and existing_alias[0]!=t:raise MergeError("ALIAS_CONFLICT:"+alias_key)
                if not existing_alias:
                    c.execute("insert into official_alias_registry(alias_normalized,ticker,status,first_session,source_sha256,evidence_json) values (?,?,?,?,?,?)",
                        (alias_key,t,"PROVISIONAL",session,digest,json.dumps(r.get("evidence",{}),sort_keys=True)))
            if t:
                old=c.execute("select open,high,low,close,volume from canonical_bars where ticker=? and date=? and price_basis='RAW'",(t,session)).fetchone()
                price=tuple(float(r[k]) for k in ("open","high","low","close","volume"))
                if old:
                    if any(abs(a-b)>1e-7*max(1,abs(b)) for a,b in zip(old,price)):
                        raise MergeError("REPLAY_CONFLICT:"+t)
                else:
                    c.execute("insert into canonical_bars(ticker,date,price_basis,open,high,low,close,volume,evidence_tier,providers,selected_source_id,n_observations,notes) values (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (t,session,"RAW",*price,"PROVISIONAL_SYMBOL_IDENTITY","egx_official","S6_EGX_"+session,1,"PDF verified, ticker identity unapproved; research only"))
                    c.execute("insert into raw_observations(ticker,date,source_id,provider_family,open,high,low,close,adj_close,volume,currency,declared_basis,valid,invalid_reason,source_path,row_ref,official_verified) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                        (t,session,"S6_EGX_"+session,"egx_official",*price[:4],None,price[4],"EGP","RAW",1,None,pdf.name,"p%d:rank%d:sha256:%s"%(r["page"],rank,digest[:16]),0))
                    inserted+=1
            status=r["resolution_status"]
            existing=c.execute("select ticker,resolution_status,close from official_session where session_date=? and market=? and pdf_rank=?",(session,market,rank)).fetchone()
            if existing:
                if existing!=(t,status,float(r["close"])):raise MergeError("OFFICIAL_SESSION_REPLAY_CONFLICT")
            else:
                c.execute("insert into official_session(session_date,market,pdf_page,pdf_rank,name_en,currency,open,high,low,close,volume,value,chg_pct,ticker,resolution_status,resolution_evidence,bounds_status) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                    (session,market,r["page"],rank,r["name"],r["currency"],r["open"],r["high"],r["low"],r["close"],r["volume"],r.get("value_traded"),r["chg_pct"],t,status,json.dumps(r.get("evidence",{}),sort_keys=True),"CHECK" if status=="QUARANTINED_OHLC" else "OK"))
        if not inserted:
            c.rollback();c.close();c=None
            if sha(db)!=before:raise MergeError("DB_CHANGED_EXTERNALLY")
            return dict(outcome="NOOP",inserted=0,db_sha256_before=before,db_sha256_after=before,source_sha256=digest)
        c.execute("insert or replace into source_registry(source_id,provider_family,description,location,snapshot_ref,file_sha256,license_status,adjusted_or_raw,interval,currency,date_timezone,independence_note) values (?,?,?,?,?,?,?,?,?,?,?,?)",
            ("S6_EGX_"+session,"egx_official","Research EGX PDF: ticker identity provisional",pdf.name,session,digest,"Official PDF, symbol identity UNVERIFIED","RAW","1d","EGP","Africa/Cairo","Never executable"))
        c.commit()
        if c.execute("pragma integrity_check").fetchone()[0]!="ok":raise MergeError("AFTER_MERGE_INTEGRITY")
        c.close();c=None
        if fail_at=="before_swap":raise MergeError("INJECTED_BEFORE_SWAP")
        if sha(db)!=before:raise MergeError("CONCURRENT_SOURCE_DB_MODIFICATION")
        fsync_file(temp)
        backup=Path(str(db)+".prev");tmp_backup=Path(str(db)+".prev.tmp")
        try:
            shutil.copy2(db,tmp_backup);fsync_file(tmp_backup)
            os.replace(tmp_backup,backup);fsync_dir(db.parent)
        finally:tmp_backup.unlink(missing_ok=True)
        os.replace(temp,db);fsync_dir(db.parent)
        return dict(outcome="RESEARCH_STAGED",inserted=inserted,
                    db_sha256_before=before,db_sha256_after=sha(db),
                    source_sha256=digest,backup_path=str(backup))
    finally:
        if c is not None:c.close()
        temp.unlink(missing_ok=True)

def main():
    p=argparse.ArgumentParser()
    for k in ("db","pdf","mapping","session"):p.add_argument("--"+k,required=True)
    p.add_argument("--research-allow-provisional",action="store_true")
    p.add_argument("--fail-at",choices=["before_swap"]);p.add_argument("--out");p.add_argument("--bulletin",required=True)
    a=p.parse_args()
    try:
        result=merge(a.db,a.pdf,a.mapping,a.session,a.research_allow_provisional,a.fail_at,a.bulletin)
        if a.out:Path(a.out).write_text(json.dumps(result,indent=2))
        print(json.dumps(result))
    except MergeError as e:
        print("FAIL_CLOSED:",e);raise SystemExit(2)
if __name__=="__main__":main()
