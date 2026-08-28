#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const OUT=path.join(ROOT,'gann-fusion-x/data/current.json');
const LEDGER=path.join(ROOT,'gann-fusion-x/data/ledger.json');
const REVIEW=path.join(ROOT,'gann-fusion-x/data/review.json');
const INDEX=path.join(ROOT,'data/quant/market-search-index-v13-17.json');
const LEGACY=path.join(ROOT,'data/stable/v16-main-app-current.json');
const HIST=path.join(ROOT,'data/history');
const SEPA=path.join(ROOT,'gann-fusion-x/data/sepa-x-snapshot.json');
const Fusion=require('../engine/fusion.js');
const Planner=require('../engine/planner.js');
const Sepa=require('../engine/sepa-adapter.js');
const Acceptance=require('../review/acceptance.js');
const DQ=require('../engine/data-quality.js');
const read=(f,d={})=>{try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}};
const write=(f,v)=>{fs.mkdirSync(path.dirname(f),{recursive:true});const tmp=f+'.tmp-'+process.pid;fs.writeFileSync(tmp,JSON.stringify(v,null,2)+'\n');JSON.parse(fs.readFileSync(tmp,'utf8'));fs.renameSync(tmp,f)};
function bars(doc,cutoff){return(doc.sessions||[]).filter(x=>!cutoff||String(x.date)<=cutoff).map(x=>{const factor=x.close?Number(x.adjustedClose??x.close)/Number(x.close):1;return{date:x.date,open:Number(x.open)*factor,high:Number(x.high)*factor,low:Number(x.low)*factor,close:Number(x.adjustedClose??x.close),volume:Number(x.volume||0)}}).filter(x=>x.close>0&&x.high>0&&x.low>0)}
function benchmark(rows,cutoff){const dates=new Map();for(const r of rows){if(r.bars.length<20||r.bars.at(-1)?.date!==cutoff)continue;const base=r.bars[0].close;if(!base)continue;for(const b of r.bars){if(!dates.has(b.date))dates.set(b.date,[]);dates.get(b.date).push(b.close/base*100)}}return[...dates.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([date,v])=>{const c=v.reduce((a,b)=>a+b,0)/v.length;return{date,open:c,high:c,low:c,close:c,volume:1}})}
function compactPlan(p){return{score:p.score,horizonScore:p.horizonScore,executionQuality:p.executionQuality,rankScore:p.rankScore,executionTier:p.executionTier,executionTierAr:p.executionTierAr,triggerDistancePct:p.triggerDistancePct,executionComponents:p.executionComponents,eligible:p.eligible,decision:p.decision,reasonCode:p.reasonCode,reasonAr:p.reasonAr,actionAr:p.actionAr,nextSession:p.nextSession,levels:p.levels,size:{riskBudgetPct:p.size?.riskBudgetPct,stopPct:p.size?.stopPct,allocationPct:p.size?.allocationPct,effectiveMaxAllocationPct:p.size?.effectiveMaxAllocationPct,adjustmentsAr:p.size?.adjustmentsAr||[]}}}
function byFunnel(analyses,horizon,code,limit){return analyses.filter(x=>x.decisionFunnel?.[horizon]?.decision?.code===code).sort((a,b)=>{const pa=a.decisionFunnel?.[horizon]||{},pb=b.decisionFunnel?.[horizon]||{};return Number(pb.rankScore??pb.score??0)-Number(pa.rankScore??pa.score??0)}).slice(0,limit)}
function main(){
  const index=read(INDEX,{stocks:[]}),legacy=read(LEGACY,{}),sepa=fs.existsSync(SEPA)?Sepa.normalize(read(SEPA,{})):null;
  const decisionDate=index.marketDate||index.analysisSession||legacy.sessionDate||null;
  const rows=[];
  for(const stock of index.stocks||[]){
    if(!stock.historyAvailable)continue;
    const doc=read(path.join(HIST,stock.ticker+'.json'),{}),bs=bars(doc,decisionDate);
    if(bs.length<20)continue;
    rows.push({stock,doc,bars:bs});
  }
  const marketBars=benchmark(rows,decisionDate),analyses=[];
  for(const r of rows){
    const last=r.bars[r.bars.length-1],se=sepa?.byTicker?.[r.stock.ticker],fund=se?{score:se.qualityScore,verified:Boolean(se.fundamentals?.verified)}:{score:50,verified:false};
    const a=Fusion.analyze({ticker:r.stock.ticker,nameAr:r.stock.companyNameAr,bars:r.bars,marketBars,fundamentals:fund,dataQuality:{fresh:last.date===decisionDate,conflict:false}});
    if(!a.valid)continue;
    const lp=DQ.optionalNumber(r.stock.liquidityPercentile);
    a.marketMeta={technicalRank:r.stock.technicalRank,liquidityPercentile:lp,riskScore:r.stock.riskScore,riskLabelAr:r.stock.riskLabelAr,moneyFlowQualityScore:r.stock.momentumMoneyFlow?.moneyFlowQualityScore};
    a.historyMeta={lastSession:r.doc.lastSession,availableSessions:r.doc.availableSessions,historyStatus:r.doc.historyStatus,averageConfidence:r.doc.averageConfidence,warnings:r.doc.warnings||[]};
    a.sepaEvidence=se?{strategyScore:se.strategyScore,qualityScore:se.qualityScore,status:se.status,action:se.action,fundamentals:se.fundamentals}:null;
    const opts={portfolioValue:100000,verifiedFundamentals:Boolean(se?.fundamentals?.verified)};
    a.decisionFunnel={speculative:compactPlan(Planner.buildPlan(a,'speculative',{...opts,riskPct:.5})),medium:compactPlan(Planner.buildPlan(a,'medium',{...opts,riskPct:.65})),long:compactPlan(Planner.buildPlan(a,'long',{...opts,riskPct:.75}))};
    analyses.push(a);
  }
  analyses.sort((a,b)=>b.score-a.score);
  const daily=byFunnel(analyses,'speculative','ACTIONABLE',5),weekly=byFunnel(analyses,'medium','ACTIONABLE',5),watch=byFunnel(analyses,'speculative','WATCH',20),rejected=byFunnel(analyses,'speculative','REJECTED',20),gann=analyses.filter(x=>x.parts.gannTime.active).slice(0,20),breakout=analyses.filter(x=>x.parts.breakout.confirmed||x.parts.breakout.near).slice(0,20),acc=analyses.filter(x=>x.classification.code==='ACCUMULATION_WATCH').slice(0,20),avoid=analyses.filter(x=>['COOL_OFF','AVOID'].includes(x.classification.code)).slice(0,20);
  const freshCount=analyses.filter(x=>x.sessionDate===decisionDate).length,freshCoverage=analyses.length?freshCount/analyses.length:0,top=daily[0]||watch[0]||null,counts=h=>({actionable:analyses.filter(x=>x.decisionFunnel?.[h]?.decision?.code==='ACTIONABLE').length,watch:analyses.filter(x=>x.decisionFunnel?.[h]?.decision?.code==='WATCH').length,rejected:analyses.filter(x=>x.decisionFunnel?.[h]?.decision?.code==='REJECTED').length});
  const topF=top?.decisionFunnel?.speculative;
  const snapshot={
    schemaVersion:'gann-fusion-x-v1.2-execution-ranking',
    generatedAt:new Date().toISOString(),sessionDate:decisionDate,status:'RESEARCH_READY',statusAr:'محرك Gann Fusion X جاهز للقراءة البحثية بعد فحص السوق وبوابة قرار موحدة وترتيب جودة التنفيذ.',
    market:{regime:analyses[0]?.parts.marketRegime.regime||'UNKNOWN',regimeAr:analyses[0]?.parts.marketRegime.regimeAr||'غير محدد',fresh:freshCoverage>=.60,freshCount,freshCoveragePct:Number((freshCoverage*100).toFixed(1)),sourceSession:decisionDate,decisionSession:decisionDate,universe:index.summary?.stocks||index.stocks?.length||0,analyzed:analyses.length},
    funnelSummary:{speculative:counts('speculative'),medium:counts('medium'),long:counts('long')},
    summary:{decision:topF?.decision?.code||'WATCH',decisionAr:topF?.decision?.ar||'مراقبة',confidence:topF?.rankScore??topF?.score??0,reasonAr:topF?.reasonAr||'لا توجد إشارة مرتفعة الثقة.'},
    dailyTop:daily,weeklyTop:weekly,watchRadar:watch,rejectedRadar:rejected,gannCalendar:gann,breakoutRadar:breakout,accumulationRadar:acc,avoidExitRadar:avoid,recommendations:daily,all:analyses,
    sourceStatus:{egxPro:{mode:'READ_ONLY',sessionDate:legacy.sessionDate||null,sessionMatch:legacy.sessionDate===decisionDate},sepaX:{mode:'READ_ONLY',connected:Boolean(sepa),sessionDate:sepa?.sessionDate||null},history:{mode:'READ_ONLY',path:'data/history',rows:rows.length,freshRows:freshCount}},
    guardrails:{readOnlyLegacySources:true,automaticOrders:false,currentSessionRequired:true,sourceConflictRejected:true,futureLeakageForbidden:true,criticalReviewBlocksPublication:true,missingNumericValuesRemainUnknown:true,unifiedDecisionFunnel:true,executionQualityRanking:true,maxPreTriggerDistancePct:4}
  };
  const review=Acceptance.review(snapshot);
  snapshot.review={passed:review.passed,critical:review.critical,major:review.major};
  write(OUT,snapshot);
  write(REVIEW,{schemaVersion:'gann-fusion-x-review-v1',...review});
  const ledger=read(LEDGER,{schemaVersion:'gann-fusion-x-ledger-v1',signals:[]});
  if(review.passed&&decisionDate&&!ledger.signals.some(x=>x.sessionDate===decisionDate)){
    for(const x of daily){const p=x.decisionFunnel.speculative;ledger.signals.push({sessionDate:decisionDate,ticker:x.ticker,nameAr:x.nameAr,score:p.rankScore??p.score,horizonScore:p.horizonScore,executionQuality:p.executionQuality,executionTier:p.executionTier,classification:x.classification,decision:p.decision,executionPlan:p,issuedAt:snapshot.generatedAt});}
    write(LEDGER,ledger);
  }
  console.log(JSON.stringify({sessionDate:decisionDate,universe:snapshot.market.universe,analyzed:analyses.length,freshCount,freshCoveragePct:snapshot.market.freshCoveragePct,daily:daily.map(x=>({ticker:x.ticker,rankScore:x.decisionFunnel.speculative.rankScore,executionQuality:x.decisionFunnel.speculative.executionQuality,tier:x.decisionFunnel.speculative.executionTier})),weekly:weekly.map(x=>x.ticker),funnel:snapshot.funnelSummary,gannWindows:gann.length,review:snapshot.review},null,2));
}
main();
