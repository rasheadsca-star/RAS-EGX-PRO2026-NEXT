"""Synthetic SQLite fixtures with the central-DB schema. No real data."""
import sqlite3,numpy as np,pandas as pd
SCHEMA={
"canonical_bars":"ticker TEXT,date TEXT,price_basis TEXT,open REAL,high REAL,low REAL,close REAL,volume REAL,evidence_tier TEXT,providers TEXT,selected_source_id TEXT,n_observations INTEGER,notes TEXT",
"conflicts":"conflict_id INTEGER,ticker TEXT,date TEXT,kind TEXT,source_a TEXT,close_a REAL,source_b TEXT,close_b REAL,pct_diff REAL,resolution TEXT",
"corporate_actions":"ticker TEXT,date TEXT,source_id TEXT,raw_change_pct REAL,adjusted_change_pct REAL,status TEXT,authoritative INTEGER",
"quality_gates":"ticker TEXT,research_ready INTEGER,paper_ready INTEGER,live_ready INTEGER",
"symbol_identity":"ticker TEXT,name_en TEXT,name_ar TEXT",
}
def sessions(n=140,end="2026-10-29"):
    return pd.bdate_range(end=end,periods=n)
def series(n,start=10.0,drift=0.0,vol=0.004,seed=0):
    rng=np.random.default_rng(seed);return start*np.cumprod(1+drift+rng.normal(0,vol,n))
def bars(t,cal,close,volume=5e6,tier="SINGLE_PROVIDER"):
    rows=[]
    for i,d in enumerate(cal):
        c=float(close[i]);o=c*0.998;h=max(o,c)*1.004;l=min(o,c)*0.996
        v=volume if np.isscalar(volume) else float(volume[i])
        rows.append((t,d.strftime("%Y-%m-%d"),"RAW",o,h,l,c,v,tier,"yahoo","S2",1,""))
    return rows
def build(path,extra=None,filler=60,n=140,end="2026-10-29",drop_col=None):
    """extra: dict ticker -> dict(close=..., volume=..., drop_dates=[...], last_n=int)"""
    cal=sessions(n,end);con=sqlite3.connect(path)
    for t,ddl in SCHEMA.items():
        if drop_col and drop_col[0]==t:
            ddl=",".join(x for x in ddl.split(",") if not x.startswith(drop_col[1]+" "))
        con.execute(f"create table {t}({ddl})")
    rows=[];ident=[];gates=[]
    for k in range(filler):
        t=f"F{k:03d}";rows+=bars(t,cal,series(n,10+k,0.0,0.004,k),volume=8e6);ident.append((t,f"Filler {k}","فلر"));gates.append((t,1,0,0))
    for t,spec in (extra or {}).items():
        idx=list(range(n))
        if "last_n" in spec:idx=idx[:spec["last_n"]]
        c=spec.get("close",series(n,20,0.001,0.004,99))
        v=spec.get("volume",8e6)
        allrows=bars(t,cal,c,volume=v,tier=spec.get("tier","SINGLE_PROVIDER"))
        drops={pd.Timestamp(d).strftime("%Y-%m-%d") for d in spec.get("drop_dates",[])}
        rows+=[allrows[i] for i in idx if allrows[i][1] not in drops]
        ident.append((t,t,t));gates.append((t,1,1 if spec.get("paper") else 0,0))
        for d in spec.get("conflict_dates",[]):
            con.execute("insert into conflicts(ticker,date,kind,resolution,pct_diff) values(?,?,?,?,?)",(t,pd.Timestamp(d).strftime("%Y-%m-%d"),"CROSS_PROVIDER","QUARANTINED_CANONICAL_WITHHELD",1.0))
        for d,stt in spec.get("corp",[]):
            con.execute("insert into corporate_actions(ticker,date,status,raw_change_pct) values(?,?,?,?)",(t,pd.Timestamp(d).strftime("%Y-%m-%d"),stt,-10.0))
    con.executemany("insert into canonical_bars values(?,?,?,?,?,?,?,?,?,?,?,?,?)",rows)
    con.executemany("insert into symbol_identity values(?,?,?)",ident)
    con.executemany("insert into quality_gates values(?,?,?,?)",gates)
    con.commit();con.close();return cal
