#!/usr/bin/env python3
"""EGX official daily bulletin intake. Never infer that a downloaded PDF is today's."""
import argparse,datetime,json,pathlib,re,subprocess,urllib.request,hashlib,sys
URL='https://www.egx.com.eg/en/get_pdf.aspx?Lang=ENG&ID=1022'
class BulletinError(RuntimeError):pass
def parse_pdf(path, expected):
    raw=pathlib.Path(path).read_bytes()
    if not raw.startswith(b'%PDF-'):raise BulletinError('SOURCE_NOT_PDF')
    txt=subprocess.check_output(['pdftotext','-layout',str(path),'-'],text=True,timeout=40)
    expected_display=datetime.date.fromisoformat(expected).strftime('%d/%m/%Y')
    if not re.search(r'Trading Date:\s*'+re.escape(expected_display),txt,re.I):
        raise BulletinError('WRONG_SESSION_DATE: expected '+expected_display)
    if 'Main Market Stocks Indicators' not in txt:raise BulletinError('NO_STOCK_TABLE')
    # Guard against accidentally accepting only a market summary.
    stocks=[]
    # The source has wrapped company names; collect numeric rows with the original description.
    for match in re.finditer(r'(?m)^\s*(\d{1,3})\s+(.{0,85}?)\s+(EGP|USD)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+(-?[\d,.]+)\s+([\d,]+)\s+([\d.]+%)?\s+([\d,]+)\s+([\d,]+)',txt):
        index,name,currency,op,hi,lo,weekhi,weeklo,close,pct,value,share,volume,trades=match.groups()
        def num(x):return float(x.replace(',',''))
        o,h,l,c=num(op),num(hi),num(lo),num(close)
        if max(o,h,l,c)<=0 or min(o,h,l,c)<=0:continue
        # A suspicious official row goes to quarantine, not into a price series.
        reason=None if l<=min(o,c)<=max(o,c)<=h else 'INCONSISTENT_OHLC'
        stocks.append(dict(rank=int(index),name=name.strip(),currency=currency,open=o,high=h,low=l,close=c,volume=int(volume.replace(',','')),value_egp=int(value.replace(',','')),trades=int(trades.replace(',','')),status='CHECK' if reason else 'CANDIDATE',reason=reason))
    if len(stocks)<40:raise BulletinError('INSUFFICIENT_PARSE_COVERAGE: '+str(len(stocks)))
    return dict(session=expected,source=URL,source_type='OFFICIAL_EGX_PDF',pdf_sha256=hashlib.sha256(raw).hexdigest(),items=stocks,rows=len(stocks),quarantined=sum(x['status']=='CHECK' for x in stocks),verified_for_trading=False)
def main():
    p=argparse.ArgumentParser();p.add_argument('--date',required=True);p.add_argument('--pdf');p.add_argument('--out',required=True)
    args=p.parse_args();date=datetime.date.fromisoformat(args.date)
    if date>datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=2))).date():raise BulletinError('FUTURE_SESSION')
    pdf=pathlib.Path(args.pdf or '/tmp/egx-latest.pdf')
    if not args.pdf:
        req=urllib.request.Request(URL,headers={'User-Agent':'Mozilla/5.0 EGX-PRO-research/1.0'})
        with urllib.request.urlopen(req,timeout=35) as resp:
            body=resp.read(15_000_001)
        if len(body)>15_000_000:raise BulletinError('PDF_OVERSIZE')
        pdf.write_bytes(body)
    data=parse_pdf(pdf,args.date)
    dest=pathlib.Path(args.out);dest.parent.mkdir(parents=True,exist_ok=True)
    dest.write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in data.items() if k!='items'}))
if __name__=='__main__':
    try:main()
    except Exception as exc:
        print('::error::'+type(exc).__name__+': '+str(exc),file=sys.stderr)
        sys.exit(2)
