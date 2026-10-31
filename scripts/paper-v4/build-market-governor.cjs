#!/usr/bin/env node
'use strict';
/* Research-only adaptive governor. Missing official index series => no executable allocation.
 * Components are independent and weighted as approved: trend .20, breadth .25,
 * liquidity .30, momentum .15, volatility/risk .10.
 */
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const median=a=>{const b=a.filter(Number.isFinite).sort((x,y)=>x-y);return b.length?(b[Math.floor((b.length-1)/2)]+b[Math.floor(b.length/2)])/2:null};
const clamp=x=>Math.max(0,Math.min(100,x));
const round=x=>x==null?null:+x.toFixed(2);
function run(){
 const ranking=read('data/paper-v4/ranking-latest.json'),latest=ranking.latestSession;
 const histories=fs.readdirSync(path.join(root,'data/history')).filter(n=>n.endsWith('.json')).flatMap(n=>{try{return [read('data/history/'+n)]}catch{return []}});
 const records=[];
 for(const h of histories){
  const s=(h.sessions||[]).filter(x=>x.date<=latest&&+x.close>0).sort((a,b)=>a.date.localeCompare(b.date));
  if(s.length<51||s.at(-1).date!==latest)continue;
  const c=s.at(-1),a20=avg(s.slice(-20).map(x=>+x.close)),a50=avg(s.slice(-50).map(x=>+x.close));
  const turnPrev=avg(s.slice(-21,-1).map(x=>+x.close*(+x.volume||0)));
  const turnNow=+c.close*(+c.volume||0),r20=100*(+c.close/+s.at(-21).close-1);
  const returns=s.slice(-21).map((x,i,a)=>i?100*(+x.close/+a[i-1].close-1):null).slice(1);
  const vol=Math.sqrt(avg(returns.map(x=>(x-avg(returns))**2)));
  records.push({ticker:h.ticker,close:+c.close,above20:+c.close>a20,above50:+c.close>a50,r20,turnNow,turnPrev,vol});
 }
 const pct=(p)=>records.length?100*records.filter(p).length/records.length:null;
 const breadthScore=records.length>=40?clamp((pct(x=>x.above20)+pct(x=>x.above50))/2):null;
 const medR=median(records.map(x=>x.r20));
 const momentumScore=medR==null?null:clamp(50+medR*2.5);
 const medVol=median(records.map(x=>x.vol));
 const riskScore=medVol==null?null:clamp(100-medVol*12);
 const validTurn=records.filter(x=>x.turnPrev>0&&x.turnNow>=0);
 const ratio=validTurn.length>=40?median(validTurn.map(x=>x.turnNow/x.turnPrev)):null;
 const liquidityScore=ratio==null?null:clamp(50+(ratio-1)*50);
 // Do not substitute a basket proxy for official EGX30/EGX70/EGX100 index trend.
 const components=[
  {id:'index_trend',labelAr:'اتجاه المؤشرات الرئيسية',weight:20,score:null,status:'MISSING_OFFICIAL_INDEX_HISTORY'},
  {id:'breadth',labelAr:'اتساع السوق',weight:25,score:round(breadthScore),status:breadthScore==null?'INSUFFICIENT_DATA':'PROXY'},
  {id:'liquidity',labelAr:'السيولة',weight:30,score:round(liquidityScore),status:liquidityScore==null?'INSUFFICIENT_DATA':'PROXY'},
  {id:'momentum',labelAr:'الزخم',weight:15,score:round(momentumScore),status:momentumScore==null?'INSUFFICIENT_DATA':'PROXY'},
  {id:'risk',labelAr:'التذبذب والمخاطر',weight:10,score:round(riskScore),status:riskScore==null?'INSUFFICIENT_DATA':'PROXY'}
 ];
 const coverage=components.reduce((s,x)=>s+(x.score==null?0:x.weight),0);
 const weightedKnown=components.reduce((s,x)=>s+(x.score==null?0:x.score*x.weight/100),0);
 const fullScore=coverage===100?round(weightedKnown):null;
 const scoreBounds={min:round(weightedKnown),max:round(weightedKnown+100-coverage)};
 const diagnosticRegime=scoreBounds.max<25?'SEVERE_WEAKNESS':scoreBounds.max<45?'WEAKNESS_IN_ALL_MISSING_FACTOR_SCENARIOS':scoreBounds.min>=75?'STRONG_IN_ALL_MISSING_FACTOR_SCENARIOS':'UNRESOLVED';
 const all=ranking.beforeFilters.map(x=>({...x,regimeResearchRank:null,portfolioDecision:x.rankEligible?'PENDING_REGIME_VALIDATION':'DATA_HOLD'}));
 const diagnostic=all.filter(x=>x.date===latest).sort((a,b)=>b.beforeScore-a.beforeScore);
 diagnostic.forEach((x,i)=>x.regimeResearchRank=i+1);
 const output={schemaVersion:'1.0',generatedAt:new Date().toISOString(),latestSession:latest,weights:{indexTrend:20,breadth:25,liquidity:30,momentum:15,risk:10},components,measuredTickers:records.length,componentCoveragePct:coverage,knownWeightedContribution:round(weightedKnown),compositeScore:fullScore,scoreBounds,diagnosticRegime,marketRegime:'UNVERIFIED',equityTargetPct:null,cashTargetPct:null,newEntriesAllowed:false,decisionAr:'النتيجة البحثية تشير إلى ضعف السوق حتى في أفضل فرضية للمكون الناقص، ولكن قرار توزيع المحفظة غير معتمد؛ تعليق الدخول الجديد حتى تسوية الأسعار والتحقق من المؤشرات، دون أمر بتصفية المراكز القائمة.',noteAr:'المؤشر المركب غير مكتمل. اتساع السوق والسيولة والزخم والمخاطر مؤشرات تقريبية مشتقة من الأسهم المخزنة. نسب المحفظة الاسترشادية لم يتم اعتمادها أو اختبارها خارج العينة.',counts:ranking.counts,topResearch:diagnostic.slice(0,30).map(x=>({ticker:x.ticker,score:x.beforeScore,rank:x.regimeResearchRank,stage:x.stage,reasons:x.reasons})),filtersAppliedToAll:all.length};
 fs.mkdirSync(path.join(root,'data/paper-v4'),{recursive:true});
 fs.writeFileSync(path.join(root,'data/paper-v4/market-governor-latest.json'),JSON.stringify(output,null,2)+'\n');
 console.log('Market governor:',output.latestSession,'coverage:',coverage,'composite:',fullScore,'universe:',all.length);
}
run();
