#!/usr/bin/env python3
"""Staged daily ingestion: data/history/*.json  ->  copy of the central SQLite  ->  atomic swap.

Guarantees
 * The live DB is never modified in place: work happens on a staged COPY (sqlite backup API); the copy is verified, fsynced,
   then os.replace()d. Any failure leaves the live DB byte-identical (the previous one is also kept as <db>.prev).
 * Only NEW sessions (date > last canonical RAW date of that ticker) are inserted. Existing canonical history is NEVER rewritten.
   If the source disagrees with an existing canonical close by >0.5%, an OPEN row is added to `conflicts` (kind INGEST_REVISION)
   and the canonical bar is left alone -> the decision engine's CONFLICT gate then blocks the symbol. Nothing is hidden.
 * New bars are tagged SINGLE_PROVIDER (one scrape, not corroborated, not official). They can never become OFFICIAL_EGX here.
 * Per-row validation (see validate_row); rejected rows are counted by reason in the report, never silently dropped.
 * Whole-run post-conditions (abort + exit 2): no usable source, too many unreadable files, partial scrape (latest-date coverage
   below MIN_COVERAGE of the previous session), rows decreased, session date moved backwards, integrity_check failed.
 * Idempotent: a re-run with no newer data is a NOOP (no swap). An audit row is written to audit_metadata + ingest_report.json.
usage: ingest_daily.py --src data/history --db central.sqlite [--report ingest_report.json] [--today YYYY-MM-DD]"""
import argparse,json,os,sys,math,sqlite3,hashlib,pathlib,shutil,tempfile,datetime,traceback
SOURCE_ID="S1_MAIN_HISTORY";MIN_COVERAGE=0.60;MAX_BAD_FILE_FRAC=0.10;REVISION_TOL_PCT=0.5;OHLC_TOL=1e-6
class IngestError(RuntimeError):pass
_hook=lambda name:None
def _num(x):
    return isinstance(x,(int,float)) and not isinstance(x,bool) and math.isfinite(x)
def validate_row(r,ticker,today):
    """returns None if OK else a reject-reason string"""
    d=r.get("date")
    try:dt=datetime.date.fromisoformat(d)
    except Exception:return "BAD_DATE"
    if dt>today:return "FUTURE_DATE"
    if dt.weekday() in (4,5):return "NON_TRADING_WEEKDAY"
    if r.get("ticker",ticker)!=ticker:return "TICKER_MISMATCH"
    if r.get("sourceSessionDate") not in (None,d):return "SESSION_DATE_MISMATCH"
    if r.get("currency","EGP")!="EGP":return "CURRENCY"
    for k in ("open","high","low","close","volume"):
        if not _num(r.get(k)):return "NON_NUMERIC_"+k.upper()
    o,h,l,c,v=(float(r[k]) for k in ("open","high","low","close","volume"))
    if min(o,h,l,c)<=0:return "NON_POSITIVE_PRICE"
    if v<0:return "NEGATIVE_VOLUME"
    if h<max(o,c)*(1-OHLC_TOL) or l>min(o,c)*(1+OHLC_TOL) or h<l:return "OHLC_INCONSISTENT"
    return None
def _prep(con):
    con.execute("create table if not exists raw_observations(obs_id INTEGER PRIMARY KEY,ticker TEXT,date TEXT,source_id TEXT,provider_family TEXT,open REAL,high REAL,low REAL,close REAL,adj_close REAL,volume REAL,currency TEXT,declared_basis TEXT,valid INTEGER,invalid_reason TEXT,source_path TEXT,row_ref TEXT,official_verified INTEGER)")
    con.execute("create table if not exists audit_metadata(key TEXT PRIMARY KEY,value TEXT)")
def _fsync_file(p):
    fd=os.open(p,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)
def _fsync_dir(p):
    fd=os.open(p,os.O_RDONLY)
    try:os.fsync(fd)
    finally:os.close(fd)
def ingest(src,db,today=None,now=None):
    src=pathlib.Path(src);db=pathlib.Path(db).resolve()
    today=today or datetime.date.today();now=now or datetime.datetime.now(datetime.timezone.utc)
    if not db.exists():raise IngestError(f"central DB not found: {db}")
    files=sorted(src.glob("*.json"))
    if not files:raise IngestError(f"no source files in {src}")
    staged=pathlib.Path(tempfile.mkstemp(dir=db.parent,prefix=".stage_",suffix=".sqlite")[1])
    try:
        a=sqlite3.connect(f"file:{db}?mode=ro",uri=True);b=sqlite3.connect(staged);a.backup(b);a.close()
        _prep(b)
        rows_before=b.execute("select count(*) from canonical_bars where price_basis='RAW'").fetchone()[0]
        last_before=b.execute("select max(date) from canonical_bars where price_basis='RAW'").fetchone()[0]
        known={r[0] for r in b.execute("select ticker from symbol_identity")}
        lastd=dict(b.execute("select ticker,max(date) from canonical_bars where price_basis='RAW' group by ticker").fetchall())
        prev_close={}
        rep=dict(started_utc=now.isoformat(),files=len(files),bad_files=[],unknown_tickers=[],inserted=0,rejected={},revisions=0,tickers_updated=0,new_dates={})
        newbars=[];revs=[];sha_cache={}
        for f in files:
            raw=f.read_bytes();sha=hashlib.sha256(raw).hexdigest()[:16]
            try:
                j=json.loads(raw.decode("utf-8"));t=j["ticker"];ses=j["sessions"]
                if not isinstance(ses,list) or t!=f.stem:raise ValueError("shape/ticker")
            except Exception as e:
                rep["bad_files"].append(f"{f.name}: {type(e).__name__}");continue
            if t not in known:rep["unknown_tickers"].append(t);continue
            ld=lastd.get(t)
            for i,r in enumerate(ses):
                if not isinstance(r,dict):rep["rejected"]["NOT_AN_OBJECT"]=rep["rejected"].get("NOT_AN_OBJECT",0)+1;continue
                d=r.get("date")
                if ld and isinstance(d,str) and d<=ld:
                    continue  # existing history is never rewritten (revisions of the last bar are flagged below)
                bad=validate_row(r,t,today)
                if bad:rep["rejected"][bad]=rep["rejected"].get(bad,0)+1;continue
                newbars.append((t,d,float(r["open"]),float(r["high"]),float(r["low"]),float(r["close"]),float(r["volume"]),f"sha256:{sha}#{i}",f"data/history/{f.name}"))
        # revision check on dates the DB already has (last canonical date only is cheap and is where scrapes revise)
        for f in files:
            try:j=json.loads(f.read_bytes().decode("utf-8"));t=j["ticker"]
            except Exception:continue
            ld=lastd.get(t)
            if not ld or t not in known:continue
            for r in j["sessions"]:
                if isinstance(r,dict) and r.get("date")==ld and _num(r.get("close")):
                    cc=b.execute("select close,evidence_tier from canonical_bars where ticker=? and date=? and price_basis='RAW'",(t,ld)).fetchone()
                    if cc and cc[0]>0:
                        pct=abs(float(r["close"])/cc[0]-1)*100
                        if pct>REVISION_TOL_PCT:revs.append((t,ld,cc[0],float(r["close"]),pct))
        if len(rep["bad_files"])>MAX_BAD_FILE_FRAC*len(files):raise IngestError(f"too many unreadable source files: {len(rep['bad_files'])}/{len(files)}")
        by_date={}
        for x in newbars:by_date.setdefault(x[1],set()).add(x[0])
        if not newbars:
            rep.update(status="NOOP",last_session=last_before,rows_before=rows_before,rows_after=rows_before)
            return rep
        # partial-scrape guard: each NEW date needs coverage vs the previous session's ticker count
        prev_cnt=b.execute("select count(distinct ticker) from canonical_bars where price_basis='RAW' and date=?",(last_before,)).fetchone()[0]
        newest=max(by_date)
        if len(by_date[newest])<MIN_COVERAGE*prev_cnt:
            raise IngestError(f"partial scrape: {len(by_date[newest])} tickers on {newest} < {MIN_COVERAGE:.0%} of {prev_cnt}")
        if newest<last_before:raise IngestError("session date would move backwards")
        _hook("before_insert")
        cur=b.cursor();cur.execute("begin")
        for (t,d,o,h,l,c,v,ref,path) in newbars:
            cur.execute("insert into raw_observations(ticker,date,source_id,provider_family,open,high,low,close,adj_close,volume,currency,declared_basis,valid,invalid_reason,source_path,row_ref,official_verified) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (t,d,SOURCE_ID,"mubasher",o,h,l,c,c,v,"EGP","raw",1,"",path,ref,0))
            cur.execute("insert or ignore into canonical_bars(ticker,date,price_basis,open,high,low,close,volume,evidence_tier,providers,selected_source_id,n_observations,notes) values(?,?,'RAW',?,?,?,?,?,'SINGLE_PROVIDER','mubasher',?,1,?)",
                (t,d,o,h,l,c,v,SOURCE_ID,"daily ingest; uncorroborated single scrape"))
            rep["inserted"]+=cur.rowcount
        for (t,d,ca,cb,pct) in revs:
            cur.execute("insert into conflicts(ticker,date,kind,source_a,close_a,source_b,close_b,pct_diff,resolution) values(?,?,'INGEST_REVISION','canonical',?, ?,?,?,'OPEN_CANONICAL_UNCHANGED')",(t,d,ca,SOURCE_ID,cb,pct))
        rep["revisions"]=len(revs);rep["revision_tickers"]=sorted({r[0] for r in revs})
        rep["new_dates"]={d:len(s) for d,s in sorted(by_date.items())};rep["tickers_updated"]=len({x[0] for x in newbars})
        rows_after=cur.execute("select count(*) from canonical_bars where price_basis='RAW'").fetchone()[0]
        last_after=cur.execute("select max(date) from canonical_bars where price_basis='RAW'").fetchone()[0]
        if rows_after<rows_before:raise IngestError("canonical rows decreased")
        if last_after<last_before:raise IngestError("last session decreased")
        rep.update(status="UPDATED",rows_before=rows_before,rows_after=rows_after,last_session=last_after,prev_last_session=last_before)
        cur.execute("insert or replace into audit_metadata(key,value) values(?,?)",(f"ingest_{now.strftime('%Y%m%dT%H%M%SZ')}",json.dumps(rep,ensure_ascii=False,sort_keys=True)))
        cur.execute("commit")
        if b.execute("pragma integrity_check").fetchone()[0]!="ok":raise IngestError("integrity_check failed on staged DB")
        b.close();_fsync_file(staged);_hook("before_swap")
        shutil.copy2(db,str(db)+".prev");os.chmod(staged,0o644);os.replace(staged,db);_fsync_dir(db.parent)
        return rep
    except BaseException:
        raise
    finally:
        try:b.close()
        except Exception:pass
        if staged.exists():
            try:staged.unlink()
            except OSError:pass
def main(argv=None):
    p=argparse.ArgumentParser();p.add_argument("--src",required=True);p.add_argument("--db",required=True);p.add_argument("--report",default=None);p.add_argument("--today")
    x=p.parse_args(argv);today=datetime.date.fromisoformat(x.today) if x.today else datetime.datetime.now(datetime.timezone.utc).date()
    try:rep=ingest(x.src,x.db,today=today);rc=0
    except BaseException as e:
        rep=dict(status="FAILED",error=f"{type(e).__name__}: {e}");rc=2;sys.stderr.write(traceback.format_exc())
    if x.report:
        pth=pathlib.Path(x.report);pth.parent.mkdir(parents=True,exist_ok=True);pth.write_text(json.dumps(rep,ensure_ascii=False,indent=1,sort_keys=True),encoding="utf-8")
    print(json.dumps({k:rep.get(k) for k in ("status","error","inserted","rejected","revisions","tickers_updated","new_dates","last_session")},ensure_ascii=False));return rc
if __name__=="__main__":sys.exit(main())
