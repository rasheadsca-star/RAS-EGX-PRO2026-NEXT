'use strict';

const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||'.');
const V16=path.join(ROOT,'data/research/v16-v169-target-hit-audit.json');
const OUT=path.join(ROOT,'data/stable/v16-main-app-independent-consensus-audit.json');
const V19_URLS=[
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/v19-egx-chat-gpt/data/v19/target-stop-audit-v6.json',
  'https://cdn.jsdelivr.net/gh/rasheadsca-star/RAS-EGX-PRO2026-NEXT@v19-egx-chat-gpt/data/v19/target-stop-audit-v6.json'
];
function read(f){return JSON.parse(fs.readFileSync(f,'utf8'));}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null;}
function round(v,d=2){const x=n(v);return x===null?null:Number(x.toFixed(d));}
function pct(a,b){return b>0?round(a/b*100,2):null;}
async function fetchJson(url){const c=new AbortController(),t=setTimeout(()=>c.abort(),9000);try{const r=await fetch(`${url}${url.includes('?')?'&':'?'}t=${Date.now()}`,{cache:'no-store',signal:c.signal,headers:{'User-Agent':'EGX-INDEPENDENT-CONSENSUS-AUDIT'}});if(!r.ok)throw Error(`HTTP ${r.status}`);return await r.json();}finally{clearTimeout(t)}}
async function firstJson(urls){let last=null;for(const url of urls){try{return{value:await fetchJson(url),url}}catch(e){last=e}}throw last||Error('V19 audit unavailable')}
function groupStats(rows){
  const total=rows.length,exec=rows.filter(x=>x.executableByOpenRule===true),noEntry=rows.filter(x=>x.executableByOpenRule!==true),raw=exec.filter(x=>x.targetTouched===true),target=exec.filter(x=>x.conservativeTargetHit===true),stop=exec.filter(x=>x.stopTouched===true),amb=exec.filter(x=>x.ambiguousSameDay===true),returns=exec.map(x=>n(x.nextCloseReturnPct)).filter(x=>x!==null);
  return {selectionCount:total,executableCount:exec.length,noEntryCount:noEntry.length,noEntryPct:pct(noEntry.length,total),rawTargetTouchCount:raw.length,rawTargetTouchRatePct:pct(raw.length,exec.length),conservativeTargetHitCount:target.length,conservativeTargetHitRatePct:pct(target.length,exec.length),stopTouchedCount:stop.length,stopTouchRatePct:pct(stop.length,exec.length),ambiguousCount:amb.length,averageNextCloseReturnPct:returns.length?round(returns.reduce((a,b)=>a+b,0)/returns.length,4):null,positiveNextCloseReturnPct:returns.length?pct(returns.filter(x=>x>0).length,returns.length):null,targetMinusStopEdgePct:exec.length?round(pct(target.length,exec.length)-pct(stop.length,exec.length),2):null};
}
async function main(){
  const v16=read(V16);if(v16.schemaVersion!=='16.9.1-target-hit-audit')throw Error(`V16 audit schema mismatch ${v16.schemaVersion}`);
  const got=await firstJson(V19_URLS),v19=got.value;if(v19.schemaVersion!=='19.5.0-target-stop-audit-v1'||v19.engineId!=='V19_CHAT_GPT_NATIVE_CHALLENGER_V6')throw Error('V19 V6 target-stop audit schema/engine mismatch');
  const v19BySession=new Map((v19.sessions||[]).map(s=>[s.signalDate,new Set((s.tickers||s.members?.map(m=>m.ticker)||[]).map(x=>String(x||'').trim().toUpperCase()) )]));
  const agreed=[],v16Only=[],unmatchedSessions=[];const perSession=[];
  for(const session of v16.sessions||[]){
    const set=v19BySession.get(session.signalDate);if(!set){unmatchedSessions.push(session.signalDate);continue}
    const row={signalDate:session.signalDate,outcomeDate:session.outcomeDate,agreed:[],v16Only:[]};
    for(const member of session.members||[]){const ticker=String(member.ticker||'').trim().toUpperCase();const item={signalDate:session.signalDate,outcomeDate:session.outcomeDate,ticker,...member,v19Agreed:set.has(ticker)};if(item.v19Agreed){agreed.push(item);row.agreed.push(ticker)}else{v16Only.push(item);row.v16Only.push(ticker)}}
    perSession.push(row);
  }
  const a=groupStats(agreed),b=groupStats(v16Only);
  const deltas={targetRatePct:round((a.conservativeTargetHitRatePct??0)-(b.conservativeTargetHitRatePct??0),2),stopRatePct:round((a.stopTouchRatePct??0)-(b.stopTouchRatePct??0),2),targetMinusStopEdgePct:round((a.targetMinusStopEdgePct??0)-(b.targetMinusStopEdgePct??0),2),averageNextCloseReturnPct:round((a.averageNextCloseReturnPct??0)-(b.averageNextCloseReturnPct??0),4),positiveNextCloseReturnPct:round((a.positiveNextCloseReturnPct??0)-(b.positiveNextCloseReturnPct??0),2)};
  const gate={minimumAgreedExecutable:12,minimumTargetUpliftPctPoints:5,maximumStopDeteriorationPctPoints:0,minimumTargetMinusStopEdgeUpliftPctPoints:8};
  const checks={sample:a.executableCount>=gate.minimumAgreedExecutable,targetUplift:deltas.targetRatePct>=gate.minimumTargetUpliftPctPoints,stopNotWorse:deltas.stopRatePct<=gate.maximumStopDeteriorationPctPoints,edgeUplift:deltas.targetMinusStopEdgePct>=gate.minimumTargetMinusStopEdgeUpliftPctPoints};
  const evidenceSupportsBonus=Object.values(checks).every(Boolean);
  const suggestedBonusPct=evidenceSupportsBonus?Math.min(7.5,round(2.5+deltas.targetMinusStopEdgePct/8,2)):0;
  const out={schemaVersion:'16.9.2-independent-consensus-evidence-1',generatedAt:new Date().toISOString(),sessionWindow:{from:v16.auditWindow?.fromSignalDate||null,to:v16.auditWindow?.toSignalDate||null,lastOutcome:v16.auditWindow?.lastOutcomeDate||null,v16Sessions:Number(v16.auditWindow?.completedSessions||0),v19Sessions:Number(v19.auditWindow?.sessions||0),matchedSessions:perSession.length,unmatchedSessions},engines:{primary:{id:'V16_9_EQUAL_WEIGHT_BASKET',independentMethodFamily:'V16_TOP_GAINER_PROBABILITY_BASKET'},confirmation:{id:'V19_CHAT_GPT_NATIVE_CHALLENGER_V6',independentMethodFamily:'V19_NATIVE_RISK_BUDGET_CHALLENGER'},methodIndependenceAssumedForDiagnostic:true,v17ExcludedAsIndependentVote:true,v17ExclusionReason:'SHARES_V16_9_UNDERLYING_SELECTION_METHOD'},comparisonContract:{unit:'V16_SELECTION',sameSignalSessionRequired:true,agreementDefinition:'TICKER_SELECTED_BY_BOTH_V16_9_AND_V19_V6_ON_SAME_SIGNAL_DATE',targetMetric:'CONSERVATIVE_TARGET_HIT',stopMetric:'STOP_TOUCHED',denominator:'EXECUTABLE_BY_OPEN_RULE'},groups:{independentAgreement:a,v16Only:b},deltasAgreementMinusV16Only:deltas,bonusEvidenceGate:{...gate,checks,evidenceSupportsBonus,suggestedBonusPct,rankingMutationActivated:false,activationState:evidenceSupportsBonus?'EVIDENCE_SUPPORTS_SEPARATE_REVIEW':'INSUFFICIENT_OR_MIXED_EVIDENCE',noteAr:evidenceSupportsBonus?'يوجد Edge تشخيصي يبرر مراجعة Bonus محدود، لكن لم يتم تغيير ترتيب MAIN APP تلقائيًا.':'العينة/الأداء لا يحقق شروط تفعيل Bonus؛ يبقى التوافق مؤشرًا فقط.'},governance:{diagnosticOnly:true,changesMainAppRanking:false,changesSelectionTechnique:false,changesWeights:false,changesFilters:false,changesRiskGates:false,changesExecutionPermission:false,usedInProfessionalReadinessScore:false,automaticBonusActivation:false},source:{v16Audit:'data/research/v16-v169-target-hit-audit.json',v19Audit:got.url,v19EvidenceClass:v19.evidenceClass||null},perSession};
  fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({groups:out.groups,deltas,bonusEvidenceGate:out.bonusEvidenceGate},null,2));
  return out;
}
if(require.main===module)main().catch(e=>{console.error(e.stack||e);process.exit(1)});
module.exports={main,groupStats};
