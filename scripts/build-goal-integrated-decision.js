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
const validSR=r=>num(r?.support1)>0&&num(r?.resistance1)>0&&num(r.support1)<num(r.resistance1);
const gradeRank=g=>({P1:5,P2:4,P3:3,Watch:2,Blocked:1}[g]||0);

function main(){
  const market=rowsOf(read(p('data/market.json'),[]));
  const rankingObj=read(p('data/final-opportunity-ranking.json'),{rows:[]});
  const ranking=rowsOf(rankingObj);
  const old=read(p('data/today-decision-center.json'),{});
  const marketMap=new Map(market.map(r=>[sym(r.symbol),r]));
  const opportunities=ranking
    .filter(r=>sym(r.symbol)&&num(r.price)>0)
    .map((r,i)=>{
      const m=marketMap.get(sym(r.symbol))||{};
      const srVerified=validSR(m)&&Boolean(
        m.supportResistanceSource||
        m.sources?.mubasherRendered?.currentRunOk||
        m.mubasherPrimaryFeed?.supportResistance?.parsed
      );
      const executionAllowed=Boolean(m.executionAllowed)&&srVerified&&!r.precisionRisk;
      const blocked=r.grade==='Blocked'||r.precisionRisk===true||num(r.price)<=0;
      const opportunityState=executionAllowed?'EXECUTABLE':blocked?'BLOCKED':'CONDITIONAL_WATCH';
      const confidence=Math.round(num(first(r.targetProbability,r.finalScore,r.finalConfidence,r.confidence))||0);
      return {
        rank:i+1,symbol:sym(r.symbol),name:clean(first(r.name,m.name,m.name_ar,m.name_en,r.symbol)),
        grade:r.grade||'Watch',opportunityState,
        label:executionAllowed?'تنفيذ مشروط':blocked?'مستبعد':'مراقبة مشروطة',
        price:num(first(r.price,m.price,m.lastPrice)),
        entryFrom:num(first(r.entryFrom,r.entryLow,r.entry)),
        entryTo:num(first(r.entryTo,r.entryHigh,r.entry)),
        target1:num(r.target1),target2:num(r.target2),stopLoss:num(r.stopLoss),
        support1:srVerified?num(m.support1):num(r.support1),
        resistance1:srVerified?num(m.resistance1):num(r.resistance1),
        srVerified,provisionalPlan:!srVerified,
        confidence,finalScore:num(r.finalScore),targetProbability:num(r.targetProbability),
        rr:num(first(r.rr,r.riskReward)),potentialProfitPct:num(r.potentialProfitPct),
        executionAllowed,monitorOnly:!executionAllowed,
        priceState:r.priceState||null,historySessions:num(r.historySessions)||0,
        why:r.why||r.executionBlockReason||m.exclusionReason||'فرصة مرتبة تحتاج تحققًا قبل التنفيذ.',
        reason:executionAllowed?'اجتازت بوابة التنفيذ الحالية.':srVerified?'لم تجتز بقية بوابات التنفيذ.':'الدعم والمقاومة غير موثقين؛ تُعرض للمراقبة فقط.'
      };
    })
    .sort((a,b)=>
      (b.opportunityState==='EXECUTABLE')-(a.opportunityState==='EXECUTABLE')||
      gradeRank(b.grade)-gradeRank(a.grade)||
      b.confidence-a.confidence||
      (b.potentialProfitPct||0)-(a.potentialProfitPct||0)
    )
    .map((r,i)=>({...r,rank:i+1}))
    .slice(0,80);

  const executable=opportunities.filter(r=>r.opportunityState==='EXECUTABLE');
  const watch=opportunities.filter(r=>r.opportunityState==='CONDITIONAL_WATCH');
  const blocked=opportunities.filter(r=>r.opportunityState==='BLOCKED');
  const srCount=market.filter(validSR).length;
  const srPct=market.length?Number((srCount/market.length*100).toFixed(2)):0;
  const mainDecision=executable.length
    ?`توجد ${executable.length} فرصة تنفيذية مشروطة و${watch.length} فرصة متابعة`
    :opportunities.length
      ?`توجد ${opportunities.length} فرصة مرتبة للمتابعة، ولا توجد توصية تنفيذية آمنة الآن`
      :'لم يتم توليد ترتيب فرص صالح';

  const decision={
    ok:true,engine:'goal_reconciled_ranked_opportunities_v15_2',generatedAt:NOW,
    mainDecision,
    caution:'فرص المتابعة ليست أوامر شراء. التنفيذ لا يُسمح به إلا عند اجتياز السعر والسيولة والدعم/المقاومة وبوابة الجودة.',
    summary:{
      rankedCount:opportunities.length,executionCount:executable.length,
      conditionalWatchCount:watch.length,blockedCount:blocked.length,
      marketRows:market.length,supportResistanceVerifiedCount:srCount,
      supportResistanceCoveragePct:srPct
    },
    rankedOpportunities:opportunities,
    executableOpportunities:executable.slice(0,15),
    conditionalWatch:watch.slice(0,30),
    blockedPreview:blocked.slice(0,20),
    legacyDecision:{engine:old.engine||null,generatedAt:old.generatedAt||null,mainDecision:old.mainDecision||null}
  };
  write(p('data/today-decision-center.json'),decision);
  console.log(mainDecision,decision.summary);
}
main();