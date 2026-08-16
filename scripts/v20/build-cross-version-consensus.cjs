#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const inputDir = process.env.V20_CONSENSUS_INPUT_DIR || path.join(ROOT, '.consensus-input');
const mainPath = process.env.V20_CONSENSUS_MAIN_APP_PATH || path.join(inputDir, 'main-app-v169.json');
const v16AuditPath = process.env.V20_CONSENSUS_V16_AUDIT_PATH || path.join(inputDir, 'v169-target-hit-audit.json');
const v19Path = process.env.V20_CONSENSUS_V19_PATH || path.join(inputDir, 'v19-native-challenger-v6.json');
const nativePath = process.env.V20_CONSENSUS_NATIVE_PATH || path.join(ROOT, 'data/v20/native-current.json');
const outPath = process.env.V20_CONSENSUS_OUT_PATH || path.join(ROOT, 'data/v20/cross-version-consensus.json');

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function round(value, dp = 3) { const n=Number(value); if(!Number.isFinite(n)) return null; const m=10**dp; return Math.round(n*m)/m; }
function pct(num, den) { return den ? round((num/den)*100,2) : 0; }
function uniq(values) { return [...new Set((values||[]).map(v=>String(v||'').trim().toUpperCase()).filter(Boolean))]; }
function avg(values) { const xs=values.filter(v=>Number.isFinite(Number(v))).map(Number); return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0; }
function median(values) { const xs=values.filter(v=>Number.isFinite(Number(v))).map(Number).sort((a,b)=>a-b); if(!xs.length)return 0; const mid=Math.floor(xs.length/2); return xs.length%2?xs[mid]:(xs[mid-1]+xs[mid])/2; }
function summarize(rows) {
  const executable=rows.filter(r=>r.executableByOpenRule===true);
  return {
    selections:rows.length, uniqueTickers:new Set(rows.map(r=>r.ticker)).size,
    rawMarketTargetReached:rows.filter(r=>r.rawMarketTargetReached).length,
    rawMarketTargetRatePct:pct(rows.filter(r=>r.rawMarketTargetReached).length,rows.length),
    executableByOpenRule:executable.length,
    strategyTargetTouched:executable.filter(r=>r.strategyTargetTouched).length,
    strategyTargetTouchRateOfExecutablePct:pct(executable.filter(r=>r.strategyTargetTouched).length,executable.length),
    conservativeTargetHits:executable.filter(r=>r.conservativeTargetHit).length,
    conservativeTargetHitRateOfExecutablePct:pct(executable.filter(r=>r.conservativeTargetHit).length,executable.length),
    positiveNextClose:rows.filter(r=>Number(r.nextCloseReturnGrossPct)>0).length,
    positiveNextCloseRatePct:pct(rows.filter(r=>Number(r.nextCloseReturnGrossPct)>0).length,rows.length),
    avgNextCloseGrossPct:round(avg(rows.map(r=>r.nextCloseReturnGrossPct))),
    medianNextCloseGrossPct:round(median(rows.map(r=>r.nextCloseReturnGrossPct))),
    avgEstimatedNextCloseNetPct:round(avg(rows.map(r=>r.estimatedNextCloseReturnNetPct))),
    avgMaxUpsideFromEntryHighPct:round(avg(rows.map(r=>r.maxUpsideFromEntryHighPct))),
    medianMaxUpsideFromEntryHighPct:round(median(rows.map(r=>r.maxUpsideFromEntryHighPct)))
  };
}

const main=readJson(mainPath), audit=readJson(v16AuditPath), v19=readJson(v19Path);
const native=fs.existsSync(nativePath)?readJson(nativePath):null;
if(main?.methodology?.ranking!=='Existing out-of-sample top-gainer probability model.') throw new Error('Unexpected MAIN APP methodology');
if(v19?.engineId!=='V19_CHAT_GPT_NATIVE_CHALLENGER_V6') throw new Error('Unexpected V19 engine');
if(v19?.methodology?.automaticPromotion!==false||v19?.current?.executionAllowed!==false) throw new Error('V19 governance drift');

const auditSessions=Array.isArray(audit.sessions)?audit.sessions:[];
const v19Sessions=Array.isArray(v19.holdoutBenchmark?.results)?v19.holdoutBenchmark.results:[];
const v19ByDate=new Map(v19Sessions.map(s=>[String(s.signalDate),new Set(uniq(s.tickers))]));
const v16Rows=[], consensusRows=[];
for(const session of auditSessions){
  const v19Set=v19ByDate.get(String(session.signalDate))||new Set();
  for(const member of session.members||[]){
    const ticker=String(member.ticker||'').toUpperCase(); if(!ticker)continue;
    const entryHigh=Number(member.entryHigh), nextHigh=Number(member.nextHigh), target1=Number(member.target1);
    const row={
      signalDate:session.signalDate,outcomeDate:session.outcomeDate,ticker,sharedV16V19:v19Set.has(ticker),
      entryLow:member.entryLow,entryHigh:member.entryHigh,target1:member.target1,stopLoss:member.stopLoss,nextOpen:member.nextOpen,nextHigh:member.nextHigh,nextLow:member.nextLow,
      executableByOpenRule:member.executableByOpenRule===true,strategyTargetTouched:member.targetTouched===true,conservativeTargetHit:member.conservativeTargetHit===true,stopTouched:member.stopTouched===true,ambiguousSameDay:member.ambiguousSameDay===true,
      rawMarketTargetReached:Number.isFinite(nextHigh)&&Number.isFinite(target1)&&nextHigh>=target1,
      nextCloseReturnGrossPct:round(member.nextCloseReturnPct,4),estimatedNextCloseReturnNetPct:round(Number(member.nextCloseReturnPct||0)-0.6,4),
      maxUpsideFromEntryHighPct:Number.isFinite(nextHigh)&&Number.isFinite(entryHigh)&&entryHigh>0?round(((nextHigh/entryHigh)-1)*100,3):null
    };
    v16Rows.push(row); if(row.sharedV16V19)consensusRows.push(row);
  }
}
const nonConsensusRows=v16Rows.filter(r=>!r.sharedV16V19), historyByTicker=new Map();
for(const row of consensusRows){const list=historyByTicker.get(row.ticker)||[];list.push(row);historyByTicker.set(row.ticker,list);}
const historicalTickerEvidence=[...historyByTicker.entries()].map(([ticker,rows])=>({ticker,occurrences:rows.length,...summarize(rows),dates:rows.map(r=>r.signalDate)})).sort((a,b)=>b.occurrences-a.occurrences||b.avgNextCloseGrossPct-a.avgNextCloseGrossPct||a.ticker.localeCompare(b.ticker));

const mainSession=String(main.currentSignalDate||''), v19Session=String(v19.current?.signalDate||''), sessionAligned=Boolean(mainSession&&v19Session&&mainSession===v19Session);
const mainBasket=uniq((main.currentBasket||[]).map(x=>x.ticker)), v19Selected=uniq(v19.current?.selectedTickers||[]);
const mainMap=new Map((main.currentBasket||[]).map(x=>[String(x.ticker||'').toUpperCase(),x])), v19Map=new Map((v19.current?.candidates||[]).map(x=>[String(x.ticker||'').toUpperCase(),x]));
const nativeSet=new Set(uniq((native?.publishedCandidates||[]).map(x=>x.ticker||x.symbol))), tickerEvidenceMap=new Map(historicalTickerEvidence.map(x=>[x.ticker,x]));
const currentRows=uniq([...mainBasket,...v19Selected]).map(ticker=>{
  const mainVote=sessionAligned&&mainBasket.includes(ticker), v19Vote=sessionAligned&&v19Selected.includes(ticker), independentVotes=Number(mainVote)+Number(v19Vote), consensusScore=sessionAligned?independentVotes*50:0;
  const hist=tickerEvidenceMap.get(ticker)||null, mainRec=mainMap.get(ticker)||null, v19Rec=v19Map.get(ticker)||null;
  return {ticker,sessionDate:sessionAligned?mainSession:null,independentVotes,independentModelCount:2,consensusScore,consensusState:consensusScore===100?'CONSENSUS_2_OF_2':consensusScore===50?'SINGLE_ENGINE_ONLY':'NO_CURRENT_CONSENSUS',mainAppSelected:mainVote,v19Selected:v19Vote,v20NativeDiscovered:nativeSet.has(ticker),mainAppRank:mainRec?.rank??null,v19Rank:v19Rec?.rank??null,
    mainAppPlan:mainRec?{entryLow:mainRec.entryLow,entryHigh:mainRec.entryHigh,stopLoss:mainRec.stopLoss,target1:mainRec.target1,probabilityTop10Pct:mainRec.probabilityTop10Pct}:null,
    v19Plan:v19Rec?.executionPlan?{entryLow:v19Rec.executionPlan.entryLow,entryHigh:v19Rec.executionPlan.entryHigh,stop:v19Rec.executionPlan.stop,target:v19Rec.executionPlan.target,executionEligible:v19Rec.executionPlan.executionEligible}:null,
    historicalConsensusEvidence:hist?{occurrences:hist.occurrences,rawMarketTargetRatePct:hist.rawMarketTargetRatePct,conservativeTargetHitRateOfExecutablePct:hist.conservativeTargetHitRateOfExecutablePct,positiveNextCloseRatePct:hist.positiveNextCloseRatePct,avgNextCloseGrossPct:hist.avgNextCloseGrossPct,avgEstimatedNextCloseNetPct:hist.avgEstimatedNextCloseNetPct,avgMaxUpsideFromEntryHighPct:hist.avgMaxUpsideFromEntryHighPct}:null};
}).sort((a,b)=>b.consensusScore-a.consensusScore||(a.mainAppRank??999)-(b.mainAppRank??999)||(a.v19Rank??999)-(b.v19Rank??999)||a.ticker.localeCompare(b.ticker));

const sharedCurrent=currentRows.filter(r=>r.consensusScore===100).map(r=>r.ticker), v16Summary=summarize(v16Rows), pairSummary=summarize(consensusRows), v16OnlySummary=summarize(nonConsensusRows);
const report={schemaVersion:'20.0.0-cross-version-consensus-1',generatedAt:new Date().toISOString(),sessionDate:sessionAligned?mainSession:null,status:sessionAligned?'CURRENT_SESSION_ALIGNED':'SESSION_MISMATCH_FAIL_CLOSED',
  scoreDefinition:{name:'INDEPENDENT_ENGINE_VOTE_SCORE_V1',independentModels:['V16_9_EQUAL_WEIGHT_BASKET','V19_CHAT_GPT_NATIVE_CHALLENGER_V6'],independentModelCount:2,formula:'independentVotes / 2 * 100',values:{'0':0,'1':50,'2':100},historicalPerformanceUsedInScore:false,note:'Historical performance is evidence only and never changes the consensus score.'},
  current:{mainAppSessionDate:mainSession||null,v19SessionDate:v19Session||null,sessionAligned,mainAppBasket:mainBasket,v19Selected,sharedTickers:sharedCurrent,sharedCount:sharedCurrent.length,mainAppBasketSize:mainBasket.length,v19SelectedCount:v19Selected.length,mainAppAgreementRatePct:pct(sharedCurrent.length,mainBasket.length),fullMainAppBasketAgreement:sessionAligned&&mainBasket.length>0&&sharedCurrent.length===mainBasket.length,rows:currentRows},
  historicalEvidence:{window:{fromSignalDate:audit.auditWindow?.fromSignalDate||auditSessions[0]?.signalDate||null,toSignalDate:audit.auditWindow?.toSignalDate||auditSessions.at(-1)?.signalDate||null,lastOutcomeDate:audit.auditWindow?.lastOutcomeDate||auditSessions.at(-1)?.outcomeDate||null,sessions:auditSessions.length},matchingRule:'same ticker + same signalDate',v16Audit:v16Summary,v16V19Consensus:pairSummary,v16OnlyNonConsensus:v16OnlySummary,consensusShareOfV16SelectionsPct:pct(consensusRows.length,v16Rows.length),deltaConsensusVsV16Only:{conservativeTargetRateOfExecutablePp:round(pairSummary.conservativeTargetHitRateOfExecutablePct-v16OnlySummary.conservativeTargetHitRateOfExecutablePct,2),avgCloseGrossPp:round(pairSummary.avgNextCloseGrossPct-v16OnlySummary.avgNextCloseGrossPct,3),avgMaxUpsidePp:round(pairSummary.avgMaxUpsideFromEntryHighPct-v16OnlySummary.avgMaxUpsideFromEntryHighPct,3)},recurringConsensusTickers:historicalTickerEvidence},
  governance:{displayPriorityOnly:true,changesFinalDecision:false,changesExecutionPermission:false,changesMainAppMethodology:false,changesV19Methodology:false,changesV20NativeRanking:false,v17RemainsProductionAuthority:true,v17CountedAsIndependentVote:false,v17Reason:'V17 recorded production ranking is governed by the V16.9 champion and would duplicate the same vote.',v20NativeCountedAsIndependentVote:false,v20NativeReason:'V20 Native remains discovery-only and lacks enough resolved independent forward outcomes for this consensus score version.'},
  provenance:{mainAppSourceCommit:process.env.V20_CONSENSUS_MAIN_APP_SHA||null,v19SourceCommit:process.env.V20_CONSENSUS_V19_SHA||null,v20NativeRankingDigest:native?.rankingDigest||null}};
fs.mkdirSync(path.dirname(outPath),{recursive:true}); fs.writeFileSync(outPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({ok:true,sessionDate:report.sessionDate,status:report.status,sharedCurrent,fullMainAppBasketAgreement:report.current.fullMainAppBasketAgreement,consensusSelections:pairSummary.selections,avgConsensusCloseGrossPct:pairSummary.avgNextCloseGrossPct,consensusConservativeTargetRatePct:pairSummary.conservativeTargetHitRateOfExecutablePct},null,2));
