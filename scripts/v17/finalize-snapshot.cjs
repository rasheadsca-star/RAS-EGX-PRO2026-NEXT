#!/usr/bin/env node
'use strict';

const fs=require('fs'),path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r);
function read(r,d={}){try{return JSON.parse(fs.readFileSync(P(r),'utf8'))}catch{return d}}
function write(r,v){const f=P(r);fs.mkdirSync(path.dirname(f),{recursive:true});const t=f+'.tmp';fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n');JSON.parse(fs.readFileSync(t,'utf8'));fs.renameSync(t,f)}
function finite(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f}
const current=read('data/v17/current.json',null);if(!current)throw new Error('Missing data/v17/current.json');
const truth=read('data/v17/market-session-truth.json',{}),repair=read('data/v17/session-history-repair.json',{}),internal=read('data/v17/internal-ohlc-support-resistance.json',{}),liquidity=read('data/v17/liquidity-gate.json',{}),resilient=read('data/v17/resilient-session-status.json',{});
const executionGrade=current?.systemHealth?.executionGrade===true||current?.readiness?.executionReady===true;
const verifiedSession=truth.executionSafe===true?truth.selectedSessionDate:null;
if(executionGrade&&(!verifiedSession||current.sessionDate!==verifiedSession||repair.applied!==true||internal.sourceSessionVerified!==true||liquidity.sourceSessionVerified!==true||resilient.executionGrade!==true))throw new Error('Execution-ready snapshot is not backed by the verified session chain');

let staleChampionRowsNeutralized=0;
if(current?.championReference?.currentForMarketSession===false&&Array.isArray(current.championReference.recommendations)){
  current.championReference.recommendations=current.championReference.recommendations.map(row=>{
    const historicalPortfolioWeightPct=finite(row.historicalPortfolioWeightPct,row.portfolioWeightPct);
    const historicalBasketWeightPct=finite(row.historicalBasketWeightPct,row.basketWeightPct);
    if(row.executionAllowed===true||row.monitorOnly===false||row.state==='PENDING_OPEN_CONFIRMATION'||finite(row.portfolioWeightPct)!==0||finite(row.basketWeightPct)!==0)staleChampionRowsNeutralized++;
    return {...row,historicalPortfolioWeightPct,historicalBasketWeightPct,portfolioWeightPct:0,basketWeightPct:0,executionAllowed:false,monitorOnly:true,state:'HISTORICAL_REFERENCE_ONLY',currentSessionWeightPct:0};
  });
  current.championReference.historicalPlannedAllocationPct=finite(current.championReference.historicalPlannedAllocationPct,current.championReference.plannedAllocationPct);
  current.championReference.plannedAllocationPct=0;
  current.championReference.executionAllowedForCurrentSession=false;
}
if(!executionGrade&&Array.isArray(current.recommendations)){
  current.recommendations=current.recommendations.map(row=>({...row,portfolioWeightPct:0,basketWeightPct:0,executionAllowed:false,monitorOnly:true}));
  current.portfolioPolicy={...(current.portfolioPolicy||{}),plannedAllocationPct:0,cashReservePct:100,researchWatchAllocationPct:0,automaticOrders:false};
}
current.sessionTruth={canonicalSource:'data/v17/market-session-truth.json',verifiedSessionDate:verifiedSession,priceSourceVerified:truth.priceSourceVerified===true,calendarValid:truth.calendarValid===true,executionSafe:truth.executionSafe===true,historyRepairApplied:repair.applied===true,historyRepairSource:'data/v17/session-history-repair.json',internalSrSession:internal.referenceSessionDate||null,liquiditySession:liquidity.referenceSessionDate||null,resilientSessionAligned:resilient.sessionAligned===true};
current.finalization={engine:'V17_SNAPSHOT_SAFETY_FINALIZER',generatedAt:new Date().toISOString(),staleChampionRowsNeutralized,staleChampionCurrentWeightsZeroed:true,immutableSignalHashTouched:false,ledgerTouched:false};
write('data/v17/current.json',current);
console.log(JSON.stringify({sessionDate:current.sessionDate,verifiedSession,executionGrade,staleChampionRowsNeutralized,plannedAllocationPct:current.portfolioPolicy?.plannedAllocationPct,championCurrentAllocationPct:current.championReference?.plannedAllocationPct},null,2));

// Build a read-only audit surface after the canonical snapshot is finalized.
// This file is intentionally separate from the immutable signal ledger: it may
// evaluate already-recorded signals, but must never rewrite signal hashes or
// count historical/backfilled rows as native V17 live evidence.
require('./build-recommendation-track-record.cjs');
// Null-safe normalization is deliberately separate so unresolved rows can never
// be misrepresented as 0% outcomes or inflate resolved/evaluated sample counts.
require('./normalize-recommendation-track-record.cjs');
// Preserve the current UI summary contract after normalization while keeping
// the normalized field names as the canonical analytical contract.
require('./track-record-ui-compat.cjs');
