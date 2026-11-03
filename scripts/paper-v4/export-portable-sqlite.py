#!/usr/bin/env python3
"""Build a portable RESEARCH snapshot SQLite from tracked history JSON.
Never describes this as the production central/private database.
"""
from pathlib import Path
import argparse,datetime,hashlib,json,sqlite3,sys
def build(root,out):
    root=Path(root);out=Path(out)
    out.parent.mkdir(parents=True,exist_ok=True)
    if out.exists():out.unlink()
    con=sqlite3.connect(out)
    con.executescript("""
    PRAGMA journal_mode=DELETE;
    CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE symbols(ticker TEXT PRIMARY KEY,name_ar TEXT,name_en TEXT,isin TEXT,history_status TEXT,source_file TEXT NOT NULL);
    CREATE TABLE daily_bars(ticker TEXT NOT NULL,session TEXT NOT NULL,open REAL NOT NULL,high REAL NOT NULL,low REAL NOT NULL,close REAL NOT NULL,volume INTEGER NOT NULL,currency TEXT NOT NULL,primary_source TEXT,official_verified INTEGER NOT NULL DEFAULT 0,raw_evidence_json TEXT NOT NULL,PRIMARY KEY(ticker,session),FOREIGN KEY(ticker) REFERENCES symbols(ticker));
    CREATE INDEX ix_daily_bars_session ON daily_bars(session);
    CREATE TABLE rejected_rows(ticker TEXT,session TEXT,reason TEXT,source_file TEXT);
    CREATE TABLE snapshot_documents(name TEXT PRIMARY KEY,payload TEXT NOT NULL,sha256 TEXT NOT NULL);
    """)
    invalid=0;accepted=0;symcount=0;conflicts=0
    for f in sorted((root/'data/history').glob('*.json')):
        try:d=json.loads(f.read_text(encoding='utf8'))
        except Exception:continue
        ticker=d.get('ticker',f.stem)
        if not isinstance(ticker,str) or not ticker.isalnum():continue
        con.execute('INSERT OR IGNORE INTO symbols VALUES(?,?,?,?,?,?)',(ticker,d.get('companyNameAr'),d.get('companyNameEn'),d.get('isin'),d.get('historyStatus'),str(f.relative_to(root))))
        symcount+=1
        for x in d.get('sessions',[]):
            try:
                ses=x['date'];datetime.date.fromisoformat(ses)
                o,h,l,c=(float(x[k]) for k in ('open','high','low','close'))
                vol=int(x['volume'])
                if not(0<l<=min(o,c) and h>=max(o,c) and vol>=0):raise ValueError('INVALID_OHLCV')
                con.execute('INSERT INTO daily_bars VALUES(?,?,?,?,?,?,?,?,?,?,?)',(ticker,ses,o,h,l,c,vol,x.get('currency') or d.get('currency') or 'EGP',x.get('primarySource') or x.get('source'),int(x.get('officialVerified') is True),json.dumps(x,ensure_ascii=False,separators=(',',':'))))
                accepted+=1
            except sqlite3.IntegrityError:
                conflicts+=1
                con.execute('INSERT INTO rejected_rows VALUES(?,?,?,?)',(ticker,x.get('date'),'DUPLICATE_TICKER_SESSION',str(f.relative_to(root))))
            except Exception:
                invalid+=1
                con.execute('INSERT INTO rejected_rows VALUES(?,?,?,?)',(ticker,x.get('date'),'INVALID_BAR',str(f.relative_to(root))))
    for name,source in [('latest_ranking','paper-v4/latest-ranking.json'),('official_audit_2026_11_03','paper-v4/official-audit-2026-11-03.json'),('v14_decision','data/stable/v14-stable-decision.json')]:
        f=root/source
        if f.exists():
            payload=f.read_text(encoding='utf8')
            con.execute('INSERT INTO snapshot_documents VALUES(?,?,?)',(name,payload,hashlib.sha256(payload.encode()).hexdigest()))
    meta={'snapshot_type':'DERIVED_PUBLIC_RESEARCH_SNAPSHOT_NOT_PRIVATE_PRODUCTION_DB',
        'built_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source':'tracked JSON data/history/*.json','trading_authority':'NONE','official_price_certification':'NOT_CLAIMED',
        'identity_isin_certification':'NOT_CLAIMED','auto_trade_enabled':'FALSE',
        'accepted_bars':accepted,'rejected_invalid':invalid,'rejected_duplicate':conflicts,'symbols':symcount}
    con.executemany('INSERT INTO metadata VALUES(?,?)',[(k,str(v)) for k,v in meta.items()])
    con.commit()
    check=con.execute('PRAGMA integrity_check').fetchone()[0]
    if check!='ok':raise RuntimeError('SQLite integrity failed: '+check)
    con.close()
    print(json.dumps({'sqlite':str(out),'integrity_check':check,'bytes':out.stat().st_size,**meta},ensure_ascii=False))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',default='.');p.add_argument('--out',required=True);a=p.parse_args()
    build(a.root,a.out)
