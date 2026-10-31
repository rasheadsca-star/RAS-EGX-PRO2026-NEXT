#!/usr/bin/env python3
"""Fail-closed, read-only immutable V4 STATIC DISPLAY guard. Does not certify market data."""
import hashlib,re,pathlib,sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
EXPECTED={
 'LCSW':('36.47','36.288','36.652','34.245','40.919','43.144','68.9','8.2'),
 'CANA':('46.5','46.267','46.732','43.756','51.987','54.73','65.4','8.47'),
 'AMOC':('14','13.93','14.07','13.384','15.232','15.848','64.6','10'),
 'EAST':('32.44','32.278','32.602','31.11','35.1','36.43','60.4','10'),
 'SWDY':('112.3','111.739','112.861','107.022','122.856','128.134','58.8','10'),
 'ICID':('17.71','17.621','17.799','16.736','19.658','20.632','56.2','9.09'),
}
FROZEN={'database_sha256':'ed46e2ab4c2aef63f8106fed27d09ec31ade22dba6fe7b8bdf4cb7852bb13b6d',
'seed_sha256':'2efb6a81d77ebc5e5732c58aafea746721665dd74a40bad97317e999a7663b70',
'original_ui_sha256':'45d94751d1cdba70e3b3400fc04fe07cfdd353572291cf619cf360cc3cf96d20'}
def check(root=ROOT):
    errors=[]
    try:
        page=(root/'paper-v4/index.html').read_text(encoding='utf-8')
        index=(root/'index.html').read_text(encoding='utf-8')
    except (OSError,UnicodeError) as e: return [str(e)]
    if 'independent paper trading v4' not in page.lower():errors.append('V4 independent identity missing')
    if '2026-10-29' not in page:errors.append('frozen session label missing')
    if 'astra-prod' in page.lower() or 'astra pro' in page.lower():errors.append('Astra reference forbidden')
    if 'content="0;url=./paper-v4/index.html"' not in index:errors.append('main HTML redirect is not independent V4')
    if "location.replace('./paper-v4/index.html')" not in index:errors.append('main JS redirect is not independent V4')
    if 'astra-prod' in index.lower() or 'astra pro' in index.lower():errors.append('Astra root redirect forbidden')
    rows=re.findall(r'<tr><td><strong>([A-Z]+)</strong></td><td>([^<]+)</td><td>([^<]+)</td><td>([^<]+)</td><td>([^<]+)</td><td>([^<]+)</td><td[^>]*>([^<]+)</td><td>([^<]+)</td></tr>',page)
    seen={}
    for t,last,entry,stop,t1,t2,score,weight in rows:
        bits=[x.strip() for x in entry.split('–')]
        if len(bits)!=2:errors.append(t+': entry parsing failed');continue
        seen[t]=(last,*bits,stop,t1,t2,score.removesuffix('/100'),weight.removesuffix('%'))
    if set(seen)!=set(EXPECTED):errors.append('ticker set differs from V4 frozen display')
    for t,v in EXPECTED.items():
        if seen.get(t)!=v:errors.append(t+': price, plan, score or allocation changed')
    return errors
if __name__=='__main__':
    errors=check()
    print('V4 FROZEN DISPLAY GUARD PASS' if not errors else 'V4 GUARD FAIL: '+ '; '.join(errors))
    sys.exit(bool(errors))
