#!/usr/bin/env node
'use strict';

const fs=require('fs'),path=require('path'),crypto=require('crypto');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r),OUT='data/v17/destructive-critic.json';
const read=(r,d={})=>{try{return JSON.parse(fs.readFileSync(P(r),'utf8'))}catch{return d}},text=r=>{try{return fs.readFileSync(P(r),'utf8')}catch{return''}},exists=r=>fs.existsSync(P(r));
function write(r,v){const f=P(r);fs.mkdirSync(path.dirname(f),{recursive:true});const t=f+'.tmp';fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n','utf8');JSON.parse(fs.readFileSync(t,'utf8'));fs.renameSync(t,f)}
const n=(v,d=null)=>{if(v===null||v===undefined||v==='')return d;const x=Number(v);return Number.isFinite(x)?x:d};
const sym=v=>String(v||'').trim().toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9.]/g,'');
const validDate=d=>/^\d{4}-\d{2}-\d{2}$/.test(String(d||''));
const regular=d=>validDate(d)&&new Date(`${d}T12:00:00Z`).getUTCDay()<=4;
const near=(a,b,t=0.0002)=>n(a)!==null&&n(b)!==null&&Math.abs(n(a)-n(b))<=t*Math.max(1,Math.abs(n(a)),Math.abs(n(b)));
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const findings=[]; const add=(severity,code,message,location=null)=>findings.push({severity,code,message,location});
const pct=(a,b)=>b?Math.round(a/b*10000)/100:0;

const required=[
 'data/v17/current.json','data/v17/ledger.json','data/v17/challenger-status.json','data/v17/review.json','data/v17/regression.json',
 'data/v17/resilient-session-status.json','data/v17/internal-ohlc-support-resistance.json','data/v17/liquidity-gate.json','data/v17/market-session-truth.json',
 'data/v17/session-history-repair.json','data/today-decision-center.json','scripts/v17/resolve-ledger.cjs','scripts/v17/build-snapshot.cjs',
 'scripts/v17/build-internal-ohlc-sr.cjs','scripts/v17/build-liquidity-gate.cjs','scripts/v17/market-session-truth.cjs','scripts/v17/repair-session-history.cjs',
 'scripts/v17/finalize-snapshot.cjs','.github/workflows/update-market-data.yml'
];
for(const r of required) if(!exists(r)) add('CRITICAL','MISSING_REQUIRED_FILE',r,r);

const current=read('data/v17/current.json'),ledger=read('data/v17/ledger.json',{entries:[]}),challenger=read('data/v17/challenger-status.json'),review=read('data/v17/review.json'),regression=read('data/v17/regression.json'),resilient=read('data/v17/resilient-session-status.json'),internal=read('data/v17/internal-ohlc-support-resistance.json'),liquidity=read('data/v17/liquidity-gate.json'),decision=read('data/today-decision-center.json'),truth=read('data/v17/market-session-truth.json'),repair=read('data/v17/session-history-repair.json'),market=read('data/market.json',{rows:[]}),health=read('data/source-health.json'),history50=read('data/history-50.json',{symbols:{}}),history=read('data/history.json',{sessionsBySymbol:{}});
const workflow=text('.github/workflows/update-market-data.yml'),resolver=text('scripts/v17/resolve-ledger.cjs'),sessionTruthSource=text('scripts/v17/market-session-truth.cjs'),runtime=text('preview-v17/app/index.html')+'\n'+text('preview-v17/app/app.js')+'\n'+text('preview-v17/app/confidence-governance.js');

// A. Canonical session chain. Workflow clock is never market-session evidence.
if(truth.executionSafe===true){
 const s=truth.selectedSessionDate;
 if(!validDate(s)||!regular(s)) add('CRITICAL','INVALID_VERIFIED_SESSION',`verified=${s}`,'market-session-truth');
 if(truth.priceSourceVerified!==true) add('CRITICAL','SAFE_SESSION_WITHOUT_PRICE_EVIDENCE','executionSafe without priceSourceVerified','market-session-truth');
 for(const [label,value] of [['market',market.sessionDate],['health',health.sessionDate],['history',history.sessionDate],['internal',internal.referenceSessionDate],['liquidity',liquidity.referenceSessionDate],['decision',decision.sessionDate],['snapshot',current.sessionDate]]){
   if(value!==s) add('CRITICAL','SESSION_CHAIN_MISMATCH',`${label}=${value}; verified=${s}`,label);
 }
 if(repair.applied!==true||repair.verifiedSessionDate!==s) add('CRITICAL','HISTORY_REPAIR_NOT_APPLIED',`applied=${repair.applied}; date=${repair.verifiedSessionDate}`,'session-history-repair');
}else if(resilient.executionGrade===true||current?.systemHealth?.executionGrade===true||decision?.sessionTruth?.executionGrade===true){
 add('CRITICAL','EXECUTION_WITHOUT_VERIFIED_SESSION','execution leaked without verified source session','session-chain');
}
if(truth.directValidation?.role&&truth.directValidation.role!=='VALIDATION_ONLY_NOT_HARD_DEPENDENCY') add('MAJOR','VALIDATION_BECAME_HARD_DEPENDENCY',truth.directValidation.role,'market-session-truth');
if(truth.directValidation?.conflictBlocksPriceSessionTruth!==false||!sessionTruthSource.includes('conflictBlocksPriceSessionTruth:false')) add('MAJOR','VALIDATION_CAN_BLOCK_PRICE_TRUTH','S/R validation must not define the price session','market-session-truth');

const verified=truth.executionSafe===true?truth.selectedSessionDate:null;
function scanHistory(container,label){for(const [s,rows] of Object.entries(container||{})){for(const row of Array.isArray(rows)?rows:[]){const d=String(row?.date||'');if(!validDate(d))continue;if(!regular(d))add('MAJOR','WEEKEND_HISTORY_ROW',`${s}:${d}`,label);if(verified&&d>verified)add('CRITICAL','FUTURE_HISTORY_ROW',`${s}:${d} > ${verified}`,label);}}}
scanHistory(history50.symbols,'data/history-50.json'); scanHistory(history.sessionsBySymbol,'data/history.json');

// B. Recompute internal classic pivots and declared coverage independently.
const srRows=Array.isArray(internal.rows)?internal.rows:[],srMap=new Map(srRows.map(r=>[sym(r.symbol),r]));
for(const r of srRows){
 const o=n(r?.provenance?.open),h=n(r?.provenance?.high),l=n(r?.provenance?.low),c=n(r?.provenance?.close);
 if([o,h,l,c].some(v=>v===null)||!(h>l&&h>=Math.max(o,c)&&l<=Math.min(o,c))){add('CRITICAL','INVALID_SR_OHLC',r.symbol,`sr:${r.symbol}`);continue;}
 const p=(h+l+c)/3,s1=2*p-h,r1=2*p-l,s2=p-(h-l),r2=p+(h-l);
 for(const [k,v] of [['pivot',p],['support1',s1],['support2',s2],['resistance1',r1],['resistance2',r2]]) if(!near(r[k],v,0.0005)) add('CRITICAL','SR_FORMULA_DRIFT',`${r.symbol}:${k}=${r[k]} expected=${v}`,`sr:${r.symbol}`);
 if(!(r.support2<r.support1&&r.support1<r.resistance1&&r.resistance1<r.resistance2)) add('MAJOR','SR_ORDER_INVALID',r.symbol,`sr:${r.symbol}`);
 if(r.executionEligible===true&&(r.provenance?.trustedForExecution!==true||internal.sourceSessionVerified!==true||internal.sessionCompletionConfirmed!==true||r.sessionDate!==internal.referenceSessionDate)) add('CRITICAL','SR_EXECUTION_WITHOUT_TRUST_CHAIN',r.symbol,`sr:${r.symbol}`);
}
const candidates=Array.isArray(internal.candidateSymbols)?internal.candidateSymbols.map(sym).filter(Boolean):[];
const derived=candidates.filter(s=>srMap.has(s)),trusted=candidates.filter(s=>srMap.get(s)?.provenance?.trustedForExecution===true),freshTrusted=candidates.filter(s=>srMap.get(s)?.provenance?.trustedForExecution===true&&srMap.get(s)?.sessionDate===internal.levelSessionDate);
if(!near(internal.researchCoveragePct,pct(derived.length,candidates.length),0.0001)) add('MAJOR','SR_RESEARCH_COVERAGE_MISMATCH',`${internal.researchCoveragePct} vs ${pct(derived.length,candidates.length)}`,'internal');
if(!near(internal.coveragePct,pct(trusted.length,candidates.length),0.0001)) add('CRITICAL','SR_TRUSTED_COVERAGE_MISMATCH',`${internal.coveragePct} vs ${pct(trusted.length,candidates.length)}`,'internal');
if(!near(internal.freshnessPct,pct(freshTrusted.length,candidates.length),0.0001)) add('CRITICAL','SR_FRESHNESS_MISMATCH',`${internal.freshnessPct} vs ${pct(freshTrusted.length,candidates.length)}`,'internal');
if((internal.sourceConflicts||[]).length>0&&resilient.executionGrade===true) add('CRITICAL','EXECUTION_WITH_CRITICAL_SR_CONFLICTS',String(internal.sourceConflicts.length),'resilient');

// C. Recompute frozen V11.1 liquidity score and predicate.
function liqScore(cur,av20,trades=0){let s=0;s+=cur>=5e6?35:Math.min(35,cur/5e6*35);s+=av20>=2e6?35:Math.min(35,av20/2e6*35);if(cur>=1e7||av20>=5e6)s+=15;s+=trades>=100?15:Math.min(15,trades/100*15);return Math.round(Math.max(0,Math.min(100,s)))}
const lrows=Array.isArray(liquidity.rows)?liquidity.rows:[];
for(const r of lrows){const score=liqScore(n(r.currentTurnover,0),n(r.avg20Turnover,0),n(r.trades,0));if(n(r.liquidityScore)!==score)add('CRITICAL','LIQUIDITY_SCORE_DRIFT',`${r.symbol}:${r.liquidityScore} vs ${score}`,`liq:${r.symbol}`);const ok=n(r.currentTurnover,0)>=5e6&&n(r.avg20Turnover,0)>=2e6&&n(r.currentVolume,0)>0&&score>=65;if((r.executionLiquidityOk===true)!==ok)add('CRITICAL','LIQUIDITY_EXECUTION_PREDICATE_DRIFT',r.symbol,`liq:${r.symbol}`);if(n(r.historicalSessionsUsed,0)>20)add('MAJOR','LIQUIDITY_HISTORY_OVER_20',r.symbol,`liq:${r.symbol}`);}
const lc=lrows.filter(r=>r.candidate===true),le=lc.filter(r=>r.evidenceAvailable===true),lx=lc.filter(r=>r.executionLiquidityOk===true);
if(lc.length!==n(liquidity.candidateUniverseCount,-1))add('CRITICAL','LIQUIDITY_CANDIDATE_COUNT_MISMATCH',`${lc.length} vs ${liquidity.candidateUniverseCount}`,'liquidity');
if(!near(liquidity.candidateEvidenceCoveragePct,pct(le.length,lc.length),0.0001))add('CRITICAL','LIQUIDITY_COVERAGE_MISMATCH',`${liquidity.candidateEvidenceCoveragePct} vs ${pct(le.length,lc.length)}`,'liquidity');
if(lx.length!==n(liquidity.candidateExecutionOkCount,-1))add('CRITICAL','LIQUIDITY_EXECUTION_COUNT_MISMATCH',`${lx.length} vs ${liquidity.candidateExecutionOkCount}`,'liquidity');
if(liquidity.gatePassed===true&&(liquidity.sessionAligned!==true||liquidity.sourceSessionVerified!==true||n(liquidity.candidateEvidenceCoveragePct,0)<95||lx.length<1))add('CRITICAL','FALSE_LIQUIDITY_GATE_PASS','gatePassed without full predicate','liquidity');

// D. Execution leakage and portfolio truth.
const drows=Array.isArray(decision.rankedOpportunities)?decision.rankedOpportunities:[],dex=drows.filter(r=>r.executionAllowed===true||r.opportunityState==='EXECUTABLE');
if(n(decision?.summary?.rankedCount,-1)!==drows.length)add('MAJOR','DECISION_RANK_COUNT_MISMATCH',`${decision?.summary?.rankedCount} vs ${drows.length}`,'decision');
if(n(decision?.summary?.executionCount,-1)!==dex.length)add('CRITICAL','DECISION_EXECUTION_COUNT_MISMATCH',`${decision?.summary?.executionCount} vs ${dex.length}`,'decision');
if(dex.length&&resilient.executionGrade!==true)add('CRITICAL','DECISION_EXECUTION_LEAK','executable rows while resilient not execution grade','decision');
for(const r of dex){if(r?.supportResistance?.executionEligible!==true)add('CRITICAL','EXECUTABLE_WITHOUT_SR',r.symbol,'decision');if(r?.liquidity?.executionLiquidityOk!==true)add('CRITICAL','EXECUTABLE_WITHOUT_LIQUIDITY',r.symbol,'decision');}
const currentExecution=current?.systemHealth?.executionGrade===true||current?.readiness?.executionReady===true,crecs=Array.isArray(current.recommendations)?current.recommendations:[];
if(!currentExecution){if(n(current?.portfolioPolicy?.plannedAllocationPct,0)!==0||n(current?.portfolioPolicy?.cashReservePct,0)!==100)add('CRITICAL','RESEARCH_PORTFOLIO_NOT_ALL_CASH','non-execution snapshot has exposure','snapshot');for(const r of crecs)if(n(r.portfolioWeightPct,0)!==0||r.executionAllowed===true||r.monitorOnly!==true)add('CRITICAL','RESEARCH_RECOMMENDATION_EXECUTION_LEAK',r.ticker,'snapshot');}
if(current?.championReference?.currentForMarketSession===false){for(const r of current?.championReference?.recommendations||[])if(r.executionAllowed===true||r.monitorOnly===false||r.state==='PENDING_OPEN_CONFIRMATION')add('MAJOR','STALE_CHAMPION_EXECUTION_SEMANTICS',r.ticker,'championReference');if(current?.championReference?.executionAllowedForCurrentSession!==false)add('MINOR','STALE_CHAMPION_CURRENT_FLAG_MISSING','historical champion not explicitly disabled','championReference');}
if(current?.finalization?.immutableSignalHashTouched!==false||current?.finalization?.ledgerTouched!==false)add('CRITICAL','FINALIZER_TOUCHED_IMMUTABLE_STATE','finalizer immutable flags invalid','snapshot');

// E. Immutable ledger and conservative ambiguity.
const entries=Array.isArray(ledger.entries)?ledger.entries:[],ids=new Set();
for(const e of entries){if(ids.has(e.signalId))add('CRITICAL','DUPLICATE_SIGNAL_ID',e.signalId,'ledger');ids.add(e.signalId);const recs=Array.isArray(e.recommendations)?e.recommendations:[],payload={sessionDate:e.sessionDate,engineId:e.engineId,recommendations:recs.map(r=>({ticker:r.ticker,entryLow:r.entryLow,entryHigh:r.entryHigh,target:r.target,stop:r.stop,portfolioWeightPct:r.portfolioWeightPct}))};if(!e.signalHash||hash(payload)!==e.signalHash)add('CRITICAL','IMMUTABLE_SIGNAL_HASH_MISMATCH',e.signalId,'ledger');if(recs.reduce((s,r)=>s+n(r.portfolioWeightPct,0),0)>50.0001)add('CRITICAL','LEDGER_ALLOCATION_OVER_50',e.signalId,'ledger');}
if(!resolver.includes('targetTouched && stopTouched')||!resolver.includes('AMBIGUOUS_TREATED_AS_STOP')||!resolver.includes('conservativeAmbiguityPolicy'))add('CRITICAL','AMBIGUITY_POLICY_WEAKENED','same-candle ambiguity no longer conservative','resolve-ledger');

// F. Governance/runtime/workflow isolation.
if(challenger.activeEngine!=='V16_9_EQUAL_WEIGHT_BASKET')add('CRITICAL','CHAMPION_CHANGED',challenger.activeEngine,'challenger');
if(challenger.promotionAllowed!==false)add('CRITICAL','AUTO_PROMOTION_ENABLED','promotionAllowed must be false','challenger');
if(current?.engine?.id!=='V16_9_EQUAL_WEIGHT_BASKET')add('CRITICAL','SNAPSHOT_ENGINE_CHANGED',current?.engine?.id,'snapshot');
for(const token of ['v15-practical-decision.json','v15-update-status.json','decision-source.js','adaptive-daily-recommendations.json','v13-5-adaptive','adaptive-recommendations.html'])if(runtime.includes(token))add('CRITICAL','LEGACY_OR_ADAPTIVE_RUNTIME_REFERENCE',token,'preview-v17/app');
const dangerousPushLines=workflow.split('\n').map(line=>line.trim()).filter(line=>/git push/.test(line)&&!/^if\s+grep/.test(line)&&!/^pattern=/.test(line)&&!line.includes("grep -R")&&!line.includes("grep -E")&&( /git push[^\n]*origin\s+main/.test(line)||/git push[^\n]*HEAD:main/.test(line) ));
if(dangerousPushLines.length)add('CRITICAL','MAIN_PUSH_PATH_PRESENT',dangerousPushLines.join(' | '),'workflow');
if(!workflow.includes('destructive-critic-v2.cjs'))add('MAJOR','CRITIC_V2_NOT_IN_WORKFLOW','Critic V2 is not mandatory','workflow');
for(const token of ['market-session-truth.cjs','repair-session-history.cjs','finalize-snapshot.cjs'])if(!workflow.includes(token))add('MAJOR','SESSION_SAFETY_CHAIN_NOT_IN_WORKFLOW',token,'workflow');

// G. Existing independent gates must themselves be perfectly clean.
const rc=review.counts||{};
if(review.verdict!=='NO_COMMENTS'||n(rc.CRITICAL,0)!==0||n(rc.MAJOR,0)!==0||n(rc.MINOR,0)!==0||n(rc.INFO,0)!==0)add('CRITICAL','INDEPENDENT_REVIEW_NOT_NO_COMMENTS',`verdict=${review.verdict}; counts=${JSON.stringify(rc)}`,'review');
if(regression.ok!==true||n(regression.failedCount,0)!==0||n(regression.criticalFailedCount,0)!==0)add('CRITICAL','REGRESSION_NOT_CLEAN',`ok=${regression.ok}; failed=${regression.failedCount}; critical=${regression.criticalFailedCount}`,'regression');

const counts=findings.reduce((a,f)=>(a[f.severity]=(a[f.severity]||0)+1,a),{CRITICAL:0,MAJOR:0,MINOR:0,INFO:0});
const report={schemaVersion:'17.0.0-destructive-critic-2',generatedAt:new Date().toISOString(),critic:'V17_DESTRUCTIVE_ADVERSARIAL_REVIEWER_V2',verdict:findings.length===0?'NO_COMMENTS':'COMMENTS_FOUND',counts,totalFindings:findings.length,findings,coverage:{sessionTruth:true,historyTemporalIntegrity:true,internalSrFormula:true,internalSrCoverageRecompute:true,liquidityIndependentRecompute:true,decisionExecutionLeak:true,snapshotHistoricalChampionLeak:true,immutableLedger:true,ambiguityPolicy:true,championChallenger:true,runtimeIsolation:true,workflowIsolation:true,independentReviewZeroTolerance:true},rule:'NO_COMMENTS requires zero findings of every severity. Critic guard-line false positives are explicitly excluded.'};
write(OUT,report);console.log(JSON.stringify(report,null,2));if(findings.length)process.exitCode=2;
