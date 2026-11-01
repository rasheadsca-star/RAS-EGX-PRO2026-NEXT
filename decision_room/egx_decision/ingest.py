"""Read-only loading with loud schema failure (no silent .get defaults)."""
import sqlite3,pathlib,pandas as pd
from .config import REQUIRED_COLUMNS,CALENDAR_MIN_TICKERS
class DataError(ValueError):pass
def open_ro(db):
    p=pathlib.Path(db)
    if not p.exists():raise DataError(f"database not found: {db}")
    c=sqlite3.connect(f"file:{p.resolve()}?mode=ro",uri=True)
    try:
        if c.execute("pragma integrity_check").fetchone()[0]!="ok":raise DataError("integrity_check failed")
        for t,cols in REQUIRED_COLUMNS.items():
            have={r[1] for r in c.execute(f"pragma table_info({t})")}
            if not have:raise DataError(f"missing table {t}")
            miss=cols-have
            if miss:raise DataError(f"table {t} missing columns {sorted(miss)}")
    except Exception:
        c.close();raise
    return c
def load(db,asof=None):
    c=open_ro(db)
    try:
        bars=pd.read_sql("select ticker,date,open,high,low,close,volume,evidence_tier from canonical_bars where price_basis='RAW' and close>0",c)
        conf=pd.read_sql("select ticker,date,kind,resolution from conflicts",c)
        ca=pd.read_sql("select ticker,date,status,raw_change_pct from corporate_actions",c)
        gates=pd.read_sql("select ticker,research_ready,paper_ready,live_ready from quality_gates",c)
        ident=pd.read_sql("select ticker,name_en,name_ar from symbol_identity",c)
    finally:c.close()
    if bars.empty:raise DataError("no RAW bars")
    bars["date"]=pd.to_datetime(bars["date"])
    if asof is not None:bars=bars[bars["date"]<=pd.Timestamp(asof)]
    cnt=bars.groupby("date")["ticker"].nunique()
    cal=cnt[cnt>=CALENDAR_MIN_TICKERS].index.sort_values()
    if len(cal)<111:raise DataError("insufficient confirmed market sessions")
    return dict(bars=bars,calendar=cal,conflicts=conf,corp=ca,gates=gates,ident=ident,session_counts=cnt)
