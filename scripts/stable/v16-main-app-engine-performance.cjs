'use strict';

const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||'.');
const OUT=path.join(ROOT,'data/stable/v16-main-app-engine-performance.json');
const V16_AUDIT=path.join(ROOT,'data/research/v16-v169-target-hit-audit.json');
const CONSENSUS=path.join(ROOT,'data/stable/v16-main-app-consensus.json');
const INDEPENDENT_CONSENSUS=path.join(ROOT,'data/stable/v16-main-app-independent-consensus-audit.json');
const V19_URLS=[
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/v19-egx-chat-gpt/data/v19/target-stop-audit-v6.json',
  'https://cdn.jsdelivr.net/gh/rasheadsca-star/RAS-EGX-PRO2026-NEXT@v19-egx-chat-gpt/data/v19/target-stop-audit-v6.json'
];
const V20_URLS=[
  'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/develop/v20-integrated-decision-platform/data/v20/retrospective-walk-forward-target-stop.json',
  'https://cdn.jsdelivr.net/gh/rasheadsca-star/RAS-EGX-PRO2026-NEXT@develop/v20-integrated-decision-platform/data/v20/retrospective-walk-forward-target-stop.json'
];

function read(file,def={}){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return def;}}
function round(v,d=2){const n=Number(v);return Number.isFinite(n)?Number(n.toFixed(d)):null;}
function pct(n,d){return d>0?round(Number(n||0)/d*100,2):null;}
async function fetchJson(url){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),9000);
  try{const r=await fetch(`${url}${url.includes('?')?'&':'?'}t=${Date.now()}`,{cache:'no-store',signal:controller.signal,headers:{'User-Agent':'EGX-MAIN-APP-PERFORMANCE-AUDIT'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json();}
  finally{clearTimeout(timer);}
}
async function firstJson(urls){let last=null;for(const url of urls){try{return {value:await fetchJson(url),url};}catch(e){last=e;}}return {value:null,url:null,error:last?.message||'unavailable'};}

function noEvidence(id,label,status,reason,sessionDate=null,extra={}){
  return {id,label,status,sessionDate,evidenceComparable:false,evidenceStatus:reason,targetRatePct:null,rawTargetTouchRatePct:null,stopRatePct:null,selectionCount:null,executableCount:null,noEntryCount:null,noEntryPct:null,ambiguousCount:null,...extra};
}

async function main(){
  const v16=read(V16_AUDIT);const consensus=read(CONSENSUS);const independent=read(INDEPENDENT_CONSENSUS,null);
  if(v16.schemaVersion!=='16.9.1-target-hit-audit')throw new Error(`V16 target audit schema mismatch: ${v16.schemaVersion}`);
  const engines=consensus?.current?.engineSessions||consensus?.engineRegistry?.comparisonEngines||[];
  const engine=id=>engines.find(x=>x.id===id)||{};
  const v16Exec=Number(v16.executableByOpenRuleCount||0),v16Sel=Number(v16.selectionCount||0);
  const v16Row={
    id:'MAIN_APP_V16_9',label:'MAIN APP · V16.9.2',status:'COMPARABLE',sessionDate:consensus.sessionDate||v16?.auditWindow?.toSignalDate||null,
    evidenceComparable:true,leaderEligible:true,evidenceStatus:'BLOCKED_WALK_FORWARD_TARGET_STOP_AUDIT',evidenceClass:'EXACT_V16_9_WALK_FORWARD',comparisonTier:'PRIMARY_WALK_FORWARD',
    auditSessions:Number(v16?.auditWindow?.completedSessions||0),fromSignalDate:v16?.auditWindow?.fromSignalDate||null,toSignalDate:v16?.auditWindow?.toSignalDate||null,lastOutcomeDate:v16?.auditWindow?.lastOutcomeDate||null,
    selectionCount:v16Sel,executableCount:v16Exec,noEntryCount:Number(v16.notExecutableByOpenRuleCount||0),noEntryPct:pct(v16.notExecutableByOpenRuleCount,v16Sel),
    targetCount:Number(v16.conservativeTargetHitCount||0),targetRatePct:round(v16.conservativeTargetHitRateOfExecutablePct),rawTargetTouchCount:Number(v16.targetTouchedCount||0),rawTargetTouchRatePct:round(v16.targetTouchRateOfExecutablePct),
    stopCount:Number(v16.stopTouchedCount||0),stopRatePct:pct(v16.stopTouchedCount,v16Exec),ambiguousCount:Number(v16.ambiguousTargetAndStopSameDayCount||0),
    noteAr:'الهدف المعروض محافظ: إذا لمس الهدف والوقف في نفس Daily bar لا تُحسب الحالة هدفًا محافظًا.'
  };

  const [v19Fetch,v20Fetch]=await Promise.all([firstJson(V19_URLS),firstJson(V20_URLS)]);
  const v19=v19Fetch.value;const v19Registry=engine('V19_CHALLENGER');
  let v19Row;
  if(v19?.schemaVersion==='19.5.0-target-stop-audit-v1'&&v19?.engineId==='V19_CHAT_GPT_NATIVE_CHALLENGER_V6'){
    const exec=Number(v19.executableByOpenRuleCount||0),sel=Number(v19.selectionCount||0);
    v19Row={
      id:'V19_V6',label:'V19 V6',status:'COMPARABLE_DIAGNOSTIC',sessionDate:v19Registry.sessionDate||v19?.auditWindow?.toSignalDate||null,
      sessionAligned:v19Registry.sessionAligned===true,evidenceComparable:true,leaderEligible:true,evidenceStatus:'REUSED_HOLDOUT_TARGET_STOP_DIAGNOSTIC',evidenceClass:v19.evidenceClass||'REUSED_V19_V6_HOLDOUT_DIAGNOSTIC',comparisonTier:'REUSED_HOLDOUT_DIAGNOSTIC',
      auditSessions:Number(v19?.auditWindow?.sessions||0),fromSignalDate:v19?.auditWindow?.fromSignalDate||null,toSignalDate:v19?.auditWindow?.toSignalDate||null,lastOutcomeDate:v19?.auditWindow?.lastOutcomeDate||null,
      selectionCount:sel,executableCount:exec,noEntryCount:Number(v19.notExecutableByOpenRuleCount||0),noEntryPct:round(v19.notExecutableByOpenRulePct??pct(v19.notExecutableByOpenRuleCount,sel)),
      targetCount:Number(v19.conservativeTargetHitCount||0),targetRatePct:round(v19.conservativeTargetHitRateOfExecutablePct),rawTargetTouchCount:Number(v19.targetTouchedCount||0),rawTargetTouchRatePct:round(v19.targetTouchRateOfExecutablePct),
      stopCount:Number(v19.stopTouchedCount||0),stopRatePct:round(v19.stopTouchRateOfExecutablePct??pct(v19.stopTouchedCount,exec)),ambiguousCount:Number(v19.ambiguousTargetAndStopSameDayCount||0),
      sourceUrl:v19Fetch.url,noteAr:'V19 V6: نفس قاعدة الافتتاح المحافظة للمقارنة، لكن الـ20 جلسة Holdout سبق استخدامها أثناء تطوير V19؛ النتيجة تشخيصية وليست Fresh Independent Holdout.'
    };
  }else{
    v19Row=noEvidence('V19_V6','V19 V6','PENDING_AUDIT','TARGET_STOP_AUDIT_PENDING',v19Registry.sessionDate||null,{sessionAligned:v19Registry.sessionAligned===true,sourceError:v19Fetch.error||null,noteAr:'تم تجهيز Target/Stop Audit في V19؛ ينتظر اكتمال ونشر الناتج قبل عرض نسبة غير موثقة.'});
  }

  const v17=engine('V17_VALIDATION');
  const v17Row=noEvidence('V17_VALIDATION','V17','SAME_UNDERLYING_METHOD','NOT_INDEPENDENT_FROM_V16_9',v17.sessionDate||null,{
    sessionAligned:v17.sessionAligned===true,sharesUnderlyingEngine:'V16_9_EQUAL_WEIGHT_BASKET',referenceTargetRatePct:v16Row.targetRatePct,referenceStopRatePct:v16Row.stopRatePct,
    noteAr:'V17 Validator لنفس محرك V16.9؛ لا نكرر نفس النتائج كأنها عينة أو Alpha مستقلة.'
  });

  const v20Registry=engine('V20_NATIVE'),v20=v20Fetch.value;let v20Row;
  if(v20?.schemaVersion==='20.0.0-retrospective-point-in-time-target-stop-1'&&v20?.engineId==='V20_FULL_MARKET_NATIVE_SELECTION_V1'&&v20?.freshIndependentForward===false){
    const s=v20.summary||{},exec=Number(s.executableByOpenRuleCount||0),sel=Number(s.selectionCount||0);
    v20Row={
      id:'V20_NATIVE',label:'V20 Native · رجعي',status:'RETROSPECTIVE_DIAGNOSTIC',sessionDate:v20Registry.sessionDate||v20?.auditWindow?.toSignalDate||null,sessionAligned:v20Registry.sessionAligned===true,
      evidenceComparable:true,leaderEligible:false,evidenceStatus:'RETROSPECTIVE_POINT_IN_TIME_DIAGNOSTIC',evidenceClass:v20.evidenceClass,comparisonTier:'RETROSPECTIVE_MEDIUM_FIDELITY',freshIndependentForward:false,
      auditSessions:Number(v20?.auditWindow?.completedSessions||0),requestedAuditSessions:Number(v20?.auditWindow?.requestedSessions||0),fromSignalDate:v20?.auditWindow?.fromSignalDate||null,toSignalDate:v20?.auditWindow?.toSignalDate||null,lastOutcomeDate:v20?.auditWindow?.lastOutcomeDate||null,
      selectionCount:sel,executableCount:exec,noEntryCount:Number(s.notExecutableByOpenRuleCount||0),noEntryPct:round(s.notExecutableByOpenRulePct),
      targetCount:Number(s.conservativeTargetHitCount||0),targetRatePct:round(s.conservativeTargetHitRateOfExecutablePct),rawTargetTouchCount:Number(s.rawTargetTouchCount||0),rawTargetTouchRatePct:round(s.rawTargetTouchRateOfExecutablePct),
      stopCount:Number(s.stopTouchedCount||0),stopRatePct:round(s.stopTouchRateOfExecutablePct),ambiguousCount:Number(s.ambiguousTargetAndStopSameDayCount||0),averageNextCloseReturnPct:round(s.averageNextCloseReturnPct,4),positiveNextCloseReturnPct:round(s.positiveNextCloseReturnPct),
      sourceUrl:v20Fetch.url,fidelity:v20.fidelity||null,
      noteAr:`V20: محاكاة رجعية Point-in-Time على ${Number(v20?.auditWindow?.completedSessions||0)} جلسات قابلة لإعادة البناء فقط؛ لا Look-Ahead، لكنها ليست Fresh Forward ولا تدخل في اختيار قائد الأداء.`
    };
  }else{
    v20Row=noEvidence('V20_NATIVE','V20 Native','PENDING_RESOLVED_EVIDENCE','NO_COMPARABLE_RESOLVED_TARGET_STOP_SAMPLE',v20Registry.sessionDate||null,{sessionAligned:v20Registry.sessionAligned===true,sourceError:v20Fetch.error||null,noteAr:'لا توجد حتى الآن عينة Forward مستقلة محسومة. المحاكاة الرجعية تظهر فقط إذا اجتازت عقد no-look-ahead.'});
  }

  const quant=engine('QUANT_EDGE');
  const quantRow=noEvidence('QUANT_EDGE','QUANT EDGE',quant.blocked?'BLOCKED_OR_STALE':'NO_COMPARABLE_EVIDENCE','NO_COMPARABLE_TARGET_STOP_SAMPLE',quant.sessionDate||null,{sessionAligned:quant.sessionAligned===true,blocked:quant.blocked===true,noteAr:'لا توجد حاليًا عينة Target/Stop قابلة للمقارنة بنفس العقد.'});

  const rows=[v16Row,v19Row,v17Row,v20Row,quantRow];
  const comparable=rows.filter(x=>x.evidenceComparable&&Number.isFinite(x.targetRatePct)&&Number.isFinite(x.stopRatePct));
  const leaderPool=comparable.filter(x=>x.leaderEligible!==false);
  const leader=leaderPool.length?leaderPool.slice().sort((a,b)=>(b.targetRatePct-b.stopRatePct)-(a.targetRatePct-a.stopRatePct))[0]:null;
  const independentSummary=independent?.schemaVersion==='16.9.2-independent-consensus-evidence-1'?{
    available:true,
    generatedAt:independent.generatedAt,
    matchedSessions:independent.sessionWindow?.matchedSessions??null,
    agreed:independent.groups?.independentAgreement||null,
    v16Only:independent.groups?.v16Only||null,
    deltasAgreementMinusV16Only:independent.deltasAgreementMinusV16Only||null,
    bonusEvidenceGate:independent.bonusEvidenceGate||null,
    governance:independent.governance||null,
  }:{available:false};
  const out={
    schemaVersion:'16.9.2-engine-performance-comparison-1',generatedAt:new Date().toISOString(),sessionDate:consensus.sessionDate||null,
    titleAr:'أداء المحركات — تحقيق الهدف / ضرب الوقف',diagnosticOnly:true,changesMainAppRanking:false,changesExecutionPermission:false,changesWeights:false,changesRiskGates:false,usedInProfessionalReadinessScore:false,
    comparisonContract:{horizon:'NEXT_SESSION_DAILY_OHLC',entryRule:'NEXT_OPEN_NOT_ABOVE_ENTRY_HIGH_AND_NOT_BELOW_STOP',targetMetric:'CONSERVATIVE_TARGET_HIT',sameSessionTargetAndStop:'COUNT_AS_STOP_NOT_CONSERVATIVE_TARGET',rateDenominator:'EXECUTABLE_BY_OPEN_RULE',noteAr:'النسب المقارنة تُحسب فقط من الحالات القابلة للتنفيذ بقاعدة الافتتاح. Daily OHLC لا يحدد ترتيب اللمسات داخل الجلسة.'},
    sourceHealth:{v19AuditAvailable:v19Row.evidenceComparable===true,v19AuditSource:v19Row.sourceUrl||null,v19AuditError:v19Row.sourceError||null,v20RetrospectiveAvailable:v20Row.evidenceComparable===true,v20RetrospectiveSource:v20Row.sourceUrl||null,v20RetrospectiveError:v20Row.sourceError||null},
    comparableEngineCount:comparable.length,leaderEligibleEngineCount:leaderPool.length,leaderByTargetMinusStop:leader?{id:leader.id,label:leader.label,edgePct:round(leader.targetRatePct-leader.stopRatePct)}:null,
    independentConsensusEvidence:independentSummary,
    rows
  };
  fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(out,null,2)+'\n');
  console.log(JSON.stringify({schemaVersion:out.schemaVersion,sessionDate:out.sessionDate,rows:out.rows.map(x=>({id:x.id,target:x.targetRatePct,stop:x.stopRatePct,status:x.status})),leader:out.leaderByTargetMinusStop,independentConsensus:out.independentConsensusEvidence},null,2));
}

main().catch(err=>{console.error(err);process.exit(1);});
