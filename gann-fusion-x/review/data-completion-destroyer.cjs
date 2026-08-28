#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const ROOT=path.resolve(__dirname,'../..');
const read=(p,d=null)=>{try{return JSON.parse(fs.readFileSync(p,'utf8'))}catch{return d}};
const AUDIT=path.join(ROOT,'gann-fusion-x/data/deep-data-completion-audit-v1.json');
const SHADOW=path.join(ROOT,'gann-fusion-x/data/forward-shadow-report.json');
const MARKET=path.join(ROOT,'data/quant/market-search-index-v13-17.json');
const SEPA=path.join(ROOT,'gann-fusion-x/data/sepa-x-snapshot.json');
const audit=read(AUDIT,{}), shadow=read(SHADOW,{}), market=read(MARKET,{}), sepa=read(SEPA,{});
const findings=[];
const add=(severity,code,message,evidence={})=>findings.push({severity,code,message,evidence});
const C=audit.counts||{};
if(!audit.generatedAt)add('critical','AUDIT_MISSING','تقرير اكتمال البيانات غير موجود أو غير صالح.');
if(!audit.latestMarketSession)add('critical','NO_MARKET_SESSION','لا توجد جلسة سوق مرجعية للتدقيق.');
if(sepa.bootstrapCompact===true)add('major','SEPA_COMPACT_MIRROR','مرآة SEPA ما زالت bootstrapCompact وليست المرآة الكاملة.');
if((C.historyFailed||0)>0)add('major','HISTORY_FAILED',`${C.historyFailed} سهمًا ما زال فشل بناء تاريخه.`,{count:C.historyFailed});
if((C.historyStaleFlag||0)>0)add('major','HISTORY_STALE',`${C.historyStaleFlag} سهمًا عليه staleData.`,{count:C.historyStaleFlag});
if((C.lagOver1CalendarDay||0)>0)add('major','HISTORY_LAG',`${C.lagOver1CalendarDay} سهمًا متأخر أكثر من يوم تقويمي عن جلسة السوق.`,{count:C.lagOver1CalendarDay});
if((C.missingHistoryFlag||0)>0)add('major','MARKET_HISTORY_MISSING',`${C.missingHistoryFlag} سهمًا في فهرس السوق بلا historyAvailable.`,{count:C.missingHistoryFlag});
if((C.missingPrice||0)>0)add('critical','PRICE_MISSING',`${C.missingPrice} سهمًا بلا سعر صالح.`,{count:C.missingPrice});
if((C.missingTurnover||0)>0)add('major','TURNOVER_MISSING',`${C.missingTurnover} سهمًا بلا turnover.`,{count:C.missingTurnover});
if((C.missingLiquidityPercentile||0)>0)add('major','LIQUIDITY_MISSING',`${C.missingLiquidityPercentile} سهمًا بلا liquidityPercentile.`,{recoverable:C.liquidityRecoverableFromOwnOHLCV||0});
if((C.liquidityRecoverableFromOwnOHLCV||0)>0)add('major','RECOVERABLE_LIQUIDITY_NOT_MATERIALIZED',`${C.liquidityRecoverableFromOwnOHLCV} قيمة سيولة يمكن اشتقاقها من OHLCV لكنها لم تُستفد بعد في الفهرس.`,{count:C.liquidityRecoverableFromOwnOHLCV});
if((C.missingRiskScore||0)>0)add('major','RISK_MISSING',`${C.missingRiskScore} سهمًا بلا riskScore.`,{count:C.missingRiskScore});
if((C.missingMomentum||0)>0)add('major','MOMENTUM_MISSING',`${C.missingMomentum} سهمًا بلا momentum/money-flow.`,{count:C.missingMomentum});
if((C.sepaVerifiedRecords||0)===0)add('major','SEPA_VERIFIED_EMPTY','SEPA verified records فارغة بعد sync؛ لا يمكن اعتبار Fundamental evidence مكتملًا.');
const gapRows=Array.isArray(audit.marketGapRows)?audit.marketGapRows:[];
for(const r of gapRows){
  if(r.priceMissing)add('critical','TICKER_PRICE_MISSING',`${r.ticker}: السعر مفقود.`,{ticker:r.ticker});
  if(!r.historyAvailable)add('major','TICKER_HISTORY_MISSING',`${r.ticker}: التاريخ غير متاح.`,{ticker:r.ticker});
  if(r.nameArMissing&&r.nameEnMissing)add('major','TICKER_IDENTITY_NAME_MISSING',`${r.ticker}: اسما الشركة العربي والإنجليزي مفقودان.`,{ticker:r.ticker});
}
const starta=Array.isArray(audit.startaDiagnostics)?audit.startaDiagnostics:[];
for(const r of starta){
  if(r.status==='FETCHED'&&!r.identityVerified)add('critical','FALLBACK_IDENTITY_UNVERIFIED',`${r.ticker}: مصدر fallback جلب بيانات بدون تحقق هوية كامل.`,{ticker:r.ticker});
  if(r.status==='FETCHED'&&r.latestReached===false)add('major','FALLBACK_NOT_CURRENT',`${r.ticker}: مصدر fallback لا يصل لآخر جلسة.`,{ticker:r.ticker,lastDate:r.lastDate});
}
// Decision-safety review of the published forward shadow snapshot when available.
for(const r of shadow?.currentCandidates?.GANN_FUSION_X_V1||[]){
  if(String(r.action||'').toUpperCase()==='ACTIONABLE'){
    if(r.meta?.liquidityKnown===false||r.meta?.liquidityPercentile==null)add('critical','ACTIONABLE_UNKNOWN_LIQUIDITY',`${r.ticker}: ACTIONABLE رغم أن السيولة Unknown.`,{ticker:r.ticker});
    if(r.meta?.fundamentalsVerified===false)add('critical','ACTIONABLE_UNVERIFIED_FUNDAMENTALS',`${r.ticker}: ACTIONABLE رغم أن Fundamentals غير موثقة.`,{ticker:r.ticker,fundamentalScore:r.meta?.fundamentalScore});
  }
}
// Basic market-index identity and uniqueness checks.
const stocks=Array.isArray(market.stocks)?market.stocks:[];
const seen=new Set();
for(const s of stocks){const t=String(s.ticker||'').toUpperCase();if(!t)add('critical','EMPTY_TICKER','فهرس السوق يحتوي صفًا بلا ticker.');else if(seen.has(t))add('critical','DUPLICATE_TICKER',`${t}: ticker مكرر في فهرس السوق.`,{ticker:t});else seen.add(t);}
const severityOrder={critical:0,major:1,minor:2};findings.sort((a,b)=>severityOrder[a.severity]-severityOrder[b.severity]||a.code.localeCompare(b.code));
const critical=findings.filter(x=>x.severity==='critical').length,major=findings.filter(x=>x.severity==='major').length,minor=findings.filter(x=>x.severity==='minor').length;
const out={schemaVersion:'data-completion-destroyer-v1',generatedAt:new Date().toISOString(),passed:critical===0&&major===0,critical,major,minor,findings,policy:{zeroCriticalRequired:true,zeroMajorRequired:true,unknownCriticalDataCannotBeUsedForActionable:true,missingDataMustNeverBecomeZero:true}};
const outPath=path.join(ROOT,'gann-fusion-x/data/data-completion-destroyer-v1.json');fs.writeFileSync(outPath,JSON.stringify(out,null,2)+'\n');
let md=`# Data Completion Destroyer V1\n\nStatus: **${out.passed?'PASS':'FAIL'}**\n\nCritical: **${critical}** — Major: **${major}** — Minor: **${minor}**\n\n`;
for(const f of findings)md+=`- **${f.severity.toUpperCase()} / ${f.code}** — ${f.message}\n`;
if(!findings.length)md+='No evidence-backed findings remain in the current destroyer rule set.\n';
fs.writeFileSync(path.join(ROOT,'gann-fusion-x/data/data-completion-destroyer-v1.md'),md);
console.log(JSON.stringify(out,null,2));
if(!out.passed)process.exitCode=1;
