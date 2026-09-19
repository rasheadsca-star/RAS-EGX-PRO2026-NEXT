'use strict';
const {finite,round,diagnostic}=require('./g09-shared.cjs');

function marketStates(context,selectedTickers,modelCandidates,diagnostics){
  const selected=new Set(selectedTickers),candidateSet=new Set(modelCandidates.map(x=>x.ticker)),current=new Map((context.modelCurrentRows||[]).map(r=>[String(r.ticker||''),r]));
  return context.canonicalSnapshot.rows.map(row=>{
    const t=String(row.ticker);let state='STRATEGY_REJECTED',reasons=[];
    if(selected.has(t)){state='ELIGIBLE_OPPORTUNITY';reasons=['RANKED_AND_RISK_VALID']}
    else if(candidateSet.has(t)){state='NOT_SELECTED';reasons=['LOWER_RANKING_OR_RISK_REJECTED']}
    else if(!current.has(t)){state='INSUFFICIENT_DATA';reasons=['NO_CURRENT_MODEL_ROW']}
    else if(finite(current.get(t).turnover20,0)<1e6){state='LIQUIDITY_REJECTED';reasons=['LOW_TURNOVER']}
    else{state='STRATEGY_REJECTED';reasons=['NOT_SELECTED_BY_ACTIVE_V16_9_SOURCE_MODEL']}
    return{ticker:t,securityId:row.securityId||t,state,reasons,canonicalSnapshotRef:row.snapshotId||context.canonicalSnapshot.snapshotId,diagnosticRefs:diagnostics.filter(d=>d.context?.ticker===t).map(d=>d.code)};
  }).sort((a,b)=>a.ticker.localeCompare(b.ticker));
}

function failedRun(context,code,details,started){return{ok:false,status:'PIPELINE_FAILED',decisionSnapshot:null,diagnostics:[diagnostic(code,'ERROR',{details:Array.isArray(details)?details:[details]})],sessionDate:context?.sessionDate||null,legacyNetworkCalls:0,quantEdgeLiveInfluence:0,productionCutover:false,durationMs:round(Number(process.hrtime.bigint()-started)/1e6,3)}}

module.exports={marketStates,failedRun};
