#!/usr/bin/env python3
import json, os, runpy
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(os.getenv('GITHUB_WORKSPACE') or '.').resolve();V4=runpy.run_path(str(ROOT/'scripts/v19/native-challenger-v4.py'),run_name='v19_v4_diag');V2=runpy.run_path(str(ROOT/'scripts/v19/native-challenger-v2.py'),run_name='v19_v2_diag')
OUT=ROOT/'data/v19/v4-policy-diagnostic.json';HOLDOUT=V4['HOLDOUT'];TW=V4['TW'];build_rows=V4['build_rows'];all_policies=V4['all_policies'];apply_policy=V4['apply_policy'];aggregate=V4['aggregate'];init_models=V4['init_models'];score_session=V4['score_session'];rd=V4['rd'];rv=V4['rv'];finite=V4['finite'];pid=V4['policy_id']

def main():
 hs,bd,dates,rb=build_rows();signals=sorted(rb);cut=len(signals)-HOLDOUT;dev=signals[:cut];hold=signals[cut:];pre=[r for d in dev for r in rb[d]];n=len(pre[0]['x']);frozen=init_models(n,pre);pols=all_policies();rets={p:[] for p in pols};baseline=pid(0,None,None,'EQUAL',4);base=[]
 for day in hold:
  ranked=score_session(rb[day],frozen,pre,'TOP10_BASELINE')
  br,_,_=apply_policy(ranked,baseline);base.append(br)
  for p in pols:
   rr,_,_=apply_policy(ranked,p);rets[p].append(rr)
 bm=aggregate(base);champ=rd(ROOT/'data/research/v16-v169-basket-engine.json',{}).get('blockedWalkForwardMetrics',{});ca=finite(champ.get('averageNetReturnPct'),999);cpf=finite(champ.get('profitFactor'),999);cwin=finite(champ.get('sessionWinRatePct'),999);cdd=finite(champ.get('maximumDrawdownPct'),-999);ba=finite(bm.get('averageNetReturnPct'),999);rows=[]
 for p in pols:
  m=aggregate(rets[p]);checks={'avg':finite(m['averageNetReturnPct'],-999)>=ca+.15,'pf':finite(m['profitFactor'],-999)>=cpf,'win':finite(m['sessionWinRatePct'],-999)>=cwin,'dd':finite(m['maximumDrawdownPct'],-999)>=cdd,'vsBaseline':finite(m['averageNetReturnPct'],-999)>=ba+.10};rows.append({'policy':p,'metrics':m,'strictDominant':all(checks.values()),'checks':checks})
 rows.sort(key=lambda x:(x['strictDominant'],sum(x['checks'].values()),finite(x['metrics']['averageNetReturnPct'],-99),finite(x['metrics']['maximumDrawdownPct'],-99)),reverse=True);dom=[x for x in rows if x['strictDominant']]
 out={'schemaVersion':'19.3.1-v4-policy-diagnostic','generatedAt':datetime.now(timezone.utc).isoformat(),'researchOnly':True,'postHocHoldoutInspection':True,'countsAsIndependentEvidence':False,'warning':'This file may reveal what could have worked on an already-seen benchmark. It must never be used directly for promotion or parameter selection.','benchmarkSessions':len(hold),'champion':champ,'internalBaseline':bm,'strictDominantPoliciesCount':len(dom),'strictDominantPolicies':dom[:25],'topPoliciesDiagnosticOnly':rows[:40]};OUT.parent.mkdir(parents=True,exist_ok=True);OUT.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(json.dumps({'strictDominantPoliciesCount':len(dom),'top':rows[:10]},ensure_ascii=False,indent=2))
if __name__=='__main__':main()
