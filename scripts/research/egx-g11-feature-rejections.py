#!/usr/bin/env python3
"""Read-only investigation of four G11 V16 feature exclusions."""
import json,os,runpy,math
from pathlib import Path
root=Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve()
out=Path(os.getenv('EGX_RECOVERY_OUT',root/'artifacts/history-recovery'))
base=runpy.run_path(str(root/'scripts/research/v16-probabilistic-model-impact.py'),run_name='audit_source')
truth=json.loads((root/'data/stable/v15-price-truth.json').read_text())
session=truth['expectedSession']
records=[]
for ticker in ('CFGH','GTWL','MAAL','RUBX'):
    p=root/'data/history'/(ticker+'.json')
    h=base['norm_hist'](p) if p.is_file() else {'rows':[],'ok':False}
    rows=[x for x in h['rows'] if x['date']<=session]
    i=len(rows)-1
    atr=base['atr'](rows,i) if i>=55 else None
    volume=base['sma'](rows,i-1,20,'volume') if i>=55 else None
    daily=(rows[i]['close']/rows[i-1]['close']-1)*100 if i>0 else None
    atrpct=atr/rows[i]['close']*100 if atr is not None and i>=0 and rows[i]['close']>0 else None
    feat=base['feat']({**h,'rows':rows},i) if i>=55 else None
    reasons=[]
    if len(rows)<60:reasons.append('LESS_THAN_60_VALID_BARS')
    if i>=55 and volume is not None and volume<=0:reasons.append('ZERO_AVERAGE_VOLUME')
    if atrpct is not None and not .4<=atrpct<=14:reasons.append('ATR_PERCENT_OUTSIDE_CERTIFIED_RANGE')
    if daily is not None and abs(daily)>30:reasons.append('DAILY_RETURN_GT_30_PERCENT')
    if feat is None and not reasons:reasons.append('OTHER_SOURCE_FEATURE_REJECTION')
    records.append({'ticker':ticker,'validRows':len(rows),'latest':rows[-1]['date'] if rows else None,
        'sourceFeaturePresent':feat is not None,'atrPct':round(atrpct,4) if atrpct is not None else None,
        'dailyReturnPct':round(daily,4) if daily is not None else None,
        'avg20Volume':round(volume,2) if volume is not None else None,'reasons':reasons})
out.mkdir(parents=True,exist_ok=True)
(out/'four-v16-feature-blockers.json').write_text(json.dumps({'session':session,'researchOnly':True,'records':records},indent=2)+'\n')
print('EGX_V16_FOUR_FEATURE_BLOCKERS',json.dumps(records))
