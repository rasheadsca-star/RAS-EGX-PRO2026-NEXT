#!/usr/bin/env python3
"""Cross-check reviewed EGX official report CSV with source PDF.
Research-only: no ticker/ISIN certification, central DB writes or trading.
Usage: python tools/egx_official_pdf_crosscheck.py report.pdf reviewed.csv
"""
import csv,datetime,hashlib,json,sys
import fitz

def audit(pdf_path,csv_path):
    b=open(pdf_path,'rb').read()
    doc=fitz.open(stream=b,filetype='pdf')
    with open(csv_path,encoding='utf-8-sig',newline='') as f: rows=list(csv.DictReader(f))
    if not rows: raise ValueError('empty CSV')
    dates={r['session'] for r in rows}
    if len(dates)!=1: raise ValueError('mixed dates')
    session=next(iter(dates))
    date=datetime.date.fromisoformat(session)
    if date.strftime('%d/%m/%Y') not in doc[2].get_text():
        raise ValueError('PDF trading date does not match CSV')
    seen=set()
    items=[]
    for r in rows:
        key=(r['session'],int(r['rank']))
        if key in seen: raise ValueError('duplicate source row: '+str(key))
        seen.add(key)
        page=int(r['pdf_page'])-1
        if not 0<=page<len(doc): raise ValueError('invalid page')
        words=doc[page].get_text('words')
        anchors=[w for w in words if 15<w[0]<45 and w[4]==str(key[1]) and 60<w[1]<1070]
        matched=False
        for a in anchors:
            y=a[1]
            cells={}
            for field,lo,hi in [('open',225,286),('high',288,332),('low',329,381),('close',475,532),('volume',690,755)]:
                token=''.join(w[4] for w in words if lo<=w[0]<hi and abs(w[1]-y)<6)
                try: cells[field]=float(token.replace(',',''))
                except ValueError: cells[field]=None
            if all(cells[k] is not None and abs(cells[k]-float(r[k]))<1e-7 for k in cells):
                matched=True
                break
        items.append({'rank':key[1],'pdf_page':page+1,'source_match':matched,'ohlc_consistency':r.get('validation','UNSPECIFIED')})
    n=sum(x['source_match'] for x in items)
    return {'session':session,'source_pdf_sha256':hashlib.sha256(b).hexdigest(),'total_rows':len(rows),
      'pdf_value_matched':n,'pdf_value_mismatched':len(rows)-n,
      'numeric_ohlc_pass':sum(x['ohlc_consistency']=='PASS_OHLC' for x in items),
      'numeric_ohlc_review':sum(x['ohlc_consistency']=='REVIEW_OHLC' for x in items),
      'identity_crosswalk_approved':False,'central_db_updated':False,'rows':items}

if __name__=='__main__':
    if len(sys.argv)!=3: sys.exit('usage: verify.py report.pdf reviewed.csv')
    result=audit(sys.argv[1],sys.argv[2])
    print(json.dumps(result,ensure_ascii=False,indent=2))
    sys.exit(0 if result['pdf_value_mismatched']==0 else 2)
