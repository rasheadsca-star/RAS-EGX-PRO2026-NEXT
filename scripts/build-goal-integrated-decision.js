#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=process.cwd(),NOW=new Date().toISOString();
const p=(...x)=>path.join(ROOT,...x);
const read=(f,d)=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}};
const write=(f,o)=>{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(o,null,2)+'\n')};
const rowsOf=x=>Array.isArray(x)?x:Array.isArray(x?.rows)?x.rows:Array.isArray(x?.items)?x.items:Array.isArray(x?.data)?x.data:[];
const num=v=>{if(v==null||v==='')return null;const n=Number(String(v).replace(/[,%٬،]/g,'').replace(/[^0-9.+\-eE]/g,''));return Number.isFinite(n)?n:null};
const first=(...v)=>v.find(x=>x!==null&&x!==undefined&&x!=='')??null;
const sym=v=>String(v||'').toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9.]/g,'');
const clean=s=>String(s||'').replace(/\s+/g,' ').split(/End 1\s*-->/i).pop().replace(/-->/g,'').replace(/^[\d,\[\]\s:'"#]+/,'').trim();
const round=(v,d=3)=>{const n=num(v);if(n===null)return null;const m=10**d;return Math.round(n*m)/m};
const validSR=r=>num(r?.support1)>0&&num(r?.resistance1)>0&&num(r.support1)<num(r.resistance1);
const gradeRank=g=>({P1:5,P2:4,P3:3,Watch:2,Blocked:1}[g]||0);
function latestHistorySession(history){
  const dates=[];
  for(const rows of Object.values(history?.symbols||{})){
    if(!Array.isArray(rows))continue;
    for(const row of rows){if(/^\d{4}-\d{2}-\d{2}$/.test(String(row?.date||'')))dates.push(String(row.date));}
  }
  return dates.sort().at(-1)||null;
}
function validOhlc(r){
  return [r?.high,r?.low,r?.close??r?.price??r?.last].every(v=>num(v)!==null)&&num(r?.high)>=num(r?.low);
}
function latestCompletedOhlc(symbol,marketRow,history50,sessionDate){
  const history=Array.isArray(history50?.symbols?.[symbol])?history50.symbols[symbol]:[];
  const candidates=history.filter(validOhlc).map(r=>({
    date:String(r.date||''),high:num(r.high),low:num(r.low),close:num(r.close),open:num(r.open),
    source:r.source||'history-50',provenance:'data/history-50.json'
  }));
  if(validOhlc(marketRow)){
    candidates.push({
      date:sessionDate||'',high:num(marketRow.high),low:num(marketRow.low),close:num(first(marketRow.price,marketRow.last,marketRow.close)),open:num(marketRow.open),
      source:marketRow.source||'market-current-session',provenance:'data/market.json'
    });
  }
  return candidates.filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)).sort((a,b)=>a.date.localeCompare(b.date)).at(-1)||null;
}
function level(value,type,base,confidence,externalState){
  return {
    value:round(value),type,source:'INTERNAL_OHLC_PIVOT',provenance:base.provenance,
    sessionDate:base.date,freshness:externalState==='CURRENT_SESSION'?'CURRENT_SESSION':'LATEST_COMPLETED_SESSION',
    confidence,methodology:'CLASSIC_PIVOT_FROM_COMPLETED_SESSION_OHLC',externalValidationState:'UNAVAILABLE_OR_NOT_CURRENT'
  };
}
function deriveResearchSr(symbol,marketRow,history50,sessionDate){
  const base=latestCompletedOhlc(symbol,marketRow,history50,sessionDate);
  if(!base)return null;
  const h=num(base.high),l=num(base.low),c=num(base.close);
  if(!(h>0&&l>0&&c>0&&h>=l))return null;
  const pivot=(h+l+c)/3;
  const support1=2*pivot-h;
  const resistance1=2*pivot-l;
  const support2=pivot-(h-l);
  const resistance2=pivot+(h-l);
  if(!(support1>0&&resistance1>support1&&support2>0&&resistance2>resistance1))return null;
  const current=base.date===sessionDate?'CURRENT_SESSION':'HISTORICAL_SESSION';
  const confidence=current==='CURRENT_SESSION'?0.78:0.68;
  return {
    grade:'RESEARCH_ONLY',source:'INTERNAL_OHLC_PIVOT',sessionDate:base.date,
    freshness:current==='CURRENT_SESSION'?'CURRENT_SESSION':'LATEST_COMPLETED_SESSION',confidence,
    methodology:'CLASSIC_PIVOT_FROM_COMPLETED_SESSION_OHLC',
    provenance:{input:base.provenance,inputSource:base.source,high:h,low:l,close:c},
    externalValidation:{source:'MUBASHER',state:marketRow?.supportResistancePartialOnly===true?'PARTIAL_RESEARCH_EVIDENCE_NOT_EXECUTION_GRADE':'UNAVAILABLE_OR_NOT_CURRENT'},
    pivot:round(pivot),
    levels:{
      support1:level(support1,'SUPPORT_1',base,confidence,current),
      support2:level(support2,'SUPPORT_2',base,confidence,current),
      resistance1:level(resistance1,'RESISTANCE_1',base,confidence,current),
      resistance2:level(resistance2,'RESISTANCE_2',base,confidence,current)
    },
    executionEligible:false
  };
}
function externalSr(m,sessionDate){
  if(!validSR(m)||m?.supportResistancePartialOnly===true)return null;
  const currentRunProof=m?.supportResistanceVerified===true||m?.sources?.mubasherRendered?.currentRunOk===true;
  if(!currentRunProof)return null;
  const source=m.supportResistanceSource||m.sources?.mubasherRendered?.source||'MUBASHER_EXTERNAL';
  return {
    grade:'VERIFIED_EXTERNAL',source,sessionDate,
    freshness:'CURRENT_RUN_VERIFIED',confidence:0.9,
    methodology:'EXTERNAL_REPORTED_SUPPORT_RESISTANCE',
    provenance:{updatedAt:m.supportResistanceUpdatedAt||m.sources?.mubasherRendered?.generatedAt||null,currentRunProof:true},
    externalValidation:{source:'MUBASHER',state:'VERIFIED_CURRENT_RUN'},executionEligible:true,
    pivot:num(first(m.pivot,m.pivotPoint)),
    levels:{
      support1:{value:num(m.support1),type:'SUPPORT_1',source,sessionDate,confidence:0.9,methodology:'EXTERNAL_REPORTED_SUPPORT_RESISTANCE',externalValidationState:'VERIFIED_CURRENT_RUN'},
      support2:{value:num(m.support2),type:'SUPPORT_2',source,sessionDate,confidence:0.9,methodology:'EXTERNAL_REPORTED_SUPPORT_RESISTANCE',externalValidationState:'VERIFIED_CURRENT_RUN'},
      resistance1:{value:num(m.resistance1),type:'RESISTANCE_1',source,sessionDate,confidence:0.9,methodology:'EXTERNAL_REPORTED_SUPPORT_RESISTANCE',externalValidationState:'VERIFIED_CURRENT_RUN'},
      resistance2:{value:num(m.resistance2),type:'RESISTANCE_2',source,sessionDate,confidence:0.9,methodology:'EXTERNAL_REPORTED_SUPPORT_RESISTANCE',externalValidationState:'VERIFIED_CURRENT_RUN'}
    }
  };
}

function main(){
  const marketObj=read(p('data/market.json'),{});
  const market=rowsOf(marketObj);
  const history50=read(p('data/history-50.json'),{});
  const sessionDate=latestHistorySession(history50);
  const rankingObj=read(p('data/final-opportunity-ranking.json'),{rows:[]});
  const ranking=rowsOf(rankingObj);
  const old=read(p('data/today-decision-center.json'),{});
  const marketMap=new Map(market.map(r=>[sym(r.symbol),r]));
  const opportunities=ranking
    .filter(r=>sym(r.symbol)&&num(r.price)>0)
    .map((r,i)=>{
      const symbol=sym(r.symbol);
      const m=marketMap.get(symbol)||{};
      const external=externalSr(m,sessionDate);
      const internal=external?null:deriveResearchSr(symbol,m,history50,sessionDate);
      const sr=external||internal;
      const srVerified=Boolean(external);
      const executionAllowed=Boolean(m.executionAllowed)&&srVerified&&!r.precisionRisk;
      const blocked=r.grade==='Blocked'||r.precisionRisk===true||num(r.price)<=0;
      const opportunityState=executionAllowed?'EXECUTABLE':blocked?'BLOCKED':'CONDITIONAL_WATCH';
      const confidence=Math.round(num(first(r.targetProbability,r.finalScore,r.finalConfidence,r.confidence))||0);
      return {
        rank:i+1,symbol,name:clean(first(r.name,m.name,m.name_ar,m.name_en,r.symbol)),
        grade:r.grade||'Watch',opportunityState,
        label:executionAllowed?'تنفيذ مشروط':blocked?'مستبعد':'مراقبة مشروطة',
        price:num(first(r.price,m.price,m.lastPrice)),
        entryFrom:num(first(r.entryFrom,r.entryLow,r.entry)),entryTo:num(first(r.entryTo,r.entryHigh,r.entry)),
        target1:num(r.target1),target2:num(r.target2),stopLoss:num(r.stopLoss),
        support1:num(sr?.levels?.support1?.value??r.support1),support2:num(sr?.levels?.support2?.value),
        resistance1:num(sr?.levels?.resistance1?.value??r.resistance1),resistance2:num(sr?.levels?.resistance2?.value),pivot:num(sr?.pivot),
        supportResistance:sr,
        srVerified,provisionalPlan:!srVerified,
        confidence,finalScore:num(r.finalScore),targetProbability:num(r.targetProbability),
        rr:num(first(r.rr,r.riskReward)),potentialProfitPct:num(r.potentialProfitPct),
        executionAllowed,monitorOnly:!executionAllowed,
        priceState:r.priceState||null,historySessions:num(r.historySessions)||0,
        why:r.why||r.executionBlockReason||m.exclusionReason||'فرصة مرتبة تحتاج تحققًا قبل التنفيذ.',
        reason:executionAllowed?'اجتازت بوابة التنفيذ الحالية.':srVerified?'الدعم والمقاومة موثقان خارجيًا في التشغيل الحالي، لكن بقية بوابات التنفيذ لم تكتمل.':internal?'تم اشتقاق دعم/مقاومة من OHLC الحقيقي للبحث فقط؛ لا تمنح أهلية تنفيذ.':'لا توجد مستويات دعم ومقاومة قابلة للتدقيق؛ تُعرض للمراقبة فقط.'
      };
    })
    .sort((a,b)=>(b.opportunityState==='EXECUTABLE')-(a.opportunityState==='EXECUTABLE')||gradeRank(b.grade)-gradeRank(a.grade)||b.confidence-a.confidence||(b.potentialProfitPct||0)-(a.potentialProfitPct||0))
    .map((r,i)=>({...r,rank:i+1}))
    .slice(0,80);

  const executable=opportunities.filter(r=>r.opportunityState==='EXECUTABLE');
  const watch=opportunities.filter(r=>r.opportunityState==='CONDITIONAL_WATCH');
  const blocked=opportunities.filter(r=>r.opportunityState==='BLOCKED');
  const verifiedCount=opportunities.filter(r=>r.srVerified===true).length;
  const researchFallbackCount=opportunities.filter(r=>r.supportResistance?.grade==='RESEARCH_ONLY').length;
  const researchSrCount=opportunities.filter(r=>r.supportResistance).length;
  const srPct=opportunities.length?Number((verifiedCount/opportunities.length*100).toFixed(2)):0;
  const researchSrPct=opportunities.length?Number((researchSrCount/opportunities.length*100).toFixed(2)):0;
  const mainDecision=executable.length?`توجد ${executable.length} فرصة تنفيذية مشروطة و${watch.length} فرصة متابعة`:opportunities.length?`توجد ${opportunities.length} فرصة مرتبة للمتابعة، ولا توجد توصية تنفيذية آمنة الآن`:'لم يتم توليد ترتيب فرص صالح';

  const decision={
    ok:true,engine:'goal_reconciled_ranked_opportunities_v17_research_sr',generatedAt:NOW,sessionDate,
    sessionTruth:{sessionDate,historySource:'data/history-50.json',historyGeneratedAt:history50.generatedAt||null,marketGeneratedAt:marketObj.generatedAt||marketObj.updatedAt||null,explicitSessionAttached:Boolean(sessionDate)},
    mainDecision,
    caution:'فرص المتابعة ليست أوامر شراء. مستويات OHLC الداخلية بحثية فقط ولا تمنح أهلية تنفيذ. التنفيذ يتطلب بوابات السعر والسيولة والجودة ومصدر دعم/مقاومة خارجي موثق من التشغيل الحالي.',
    summary:{
      rankedCount:opportunities.length,executionCount:executable.length,conditionalWatchCount:watch.length,blockedCount:blocked.length,
      marketRows:market.length,supportResistanceVerifiedCount:verifiedCount,supportResistanceCoveragePct:srPct,
      supportResistanceResearchFallbackCount:researchFallbackCount,supportResistanceResearchCoveragePct:researchSrPct
    },
    rankedOpportunities:opportunities,
    executableOpportunities:executable.slice(0,15),conditionalWatch:watch.slice(0,30),blockedPreview:blocked.slice(0,20),
    supportResistancePolicy:{externalRequiredForExecution:true,currentRunExternalProofRequired:true,partialExternalEvidenceResearchOnly:true,internalOhlcFallbackResearchOnly:true,automaticPromotion:false},
    legacyDecision:{engine:old.engine||null,generatedAt:old.generatedAt||null,sessionDate:old.sessionDate||null,mainDecision:old.mainDecision||null}
  };
  write(p('data/today-decision-center.json'),decision);
  console.log(sessionDate,mainDecision,decision.summary);
}
main();