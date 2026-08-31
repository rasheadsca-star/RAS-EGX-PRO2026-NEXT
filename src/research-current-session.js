import { sha256 } from './hash.js';
import { assertResearchOnly,stampResearchRecord } from './research-source-policy.js';

function pct(a,b){return Number(a)>0&&Number(b)>0?Math.abs(Number(a)/Number(b)-1)*100:null}
function uniq(values){return [...new Set(values.filter(Boolean))].sort()}
function sourcePriority(sourceId){return {MUBASHER_RESEARCH:300,LEGACY_MARKET_IMPORT:250,YAHOO_RESEARCH:200,LEGACY_IMPORT:100}[sourceId]??0}

export function resolveResearchCurrentSession({ticker,expectedSession,observations=[],maxCloseConflictPct=1,maxVolumeConflictPct=20}={}){
  const reasons=[];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(expectedSession??'')))return{state:'BLOCKED',reasons:['EXPECTED_SESSION_REQUIRED'],ticker,expectedSession,authoritativeResearch:null,evidence:null};
  const valid=[];
  for(const row of observations.filter(Boolean)){
    try{assertResearchOnly(row);valid.push(row)}catch{reasons.push(`AUTHORITY_BOUNDARY_REJECTED:${row?.sourceId??'UNKNOWN'}`)}
  }
  const expected=valid.filter(x=>x.session===expectedSession);
  if(!expected.length){
    const seen=uniq(valid.map(x=>x.session));
    return{state:'STALE_RESEARCH',reasons:uniq([...reasons,`EXPECTED_SESSION_MISSING:${expectedSession}`,seen.length?`AVAILABLE_SESSIONS:${seen.join(',')}`:'NO_VALID_RESEARCH_OBSERVATIONS']),ticker,expectedSession,authoritativeResearch:null,evidence:{observations:valid}};
  }

  const byProvider=new Map();
  for(const row of [...expected].sort((a,b)=>sourcePriority(b.sourceId)-sourcePriority(a.sourceId))){if(!byProvider.has(row.providerGroup))byProvider.set(row.providerGroup,row)}
  const independent=[...byProvider.values()];
  const comparisons=[];
  for(let i=0;i<independent.length;i++)for(let j=i+1;j<independent.length;j++){
    const a=independent[i],b=independent[j],closeConflictPct=pct(a.close,b.close),volumeConflictPct=pct(a.volume,b.volume);
    comparisons.push({a:a.sourceId,b:b.sourceId,aProvider:a.providerGroup,bProvider:b.providerGroup,closeConflictPct,volumeConflictPct});
    if(closeConflictPct!=null&&closeConflictPct>maxCloseConflictPct)reasons.push(`CLOSE_CONFLICT:${a.sourceId}:${b.sourceId}:${closeConflictPct.toFixed(4)}%`);
    if(volumeConflictPct!=null&&volumeConflictPct>maxVolumeConflictPct)reasons.push(`VOLUME_CONFLICT:${a.sourceId}:${b.sourceId}:${volumeConflictPct.toFixed(4)}%`);
  }
  const materialConflict=reasons.some(x=>x.startsWith('CLOSE_CONFLICT:')||x.startsWith('VOLUME_CONFLICT:'));
  const selected=[...expected].sort((a,b)=>sourcePriority(b.sourceId)-sourcePriority(a.sourceId)||String(a.sourceId).localeCompare(String(b.sourceId)))[0];
  const verificationState=independent.length>=2?'INDEPENDENT_RESEARCH_CROSSCHECK':selected.sourceId==='LEGACY_MARKET_IMPORT'?'CURRENT_SESSION_LEGACY_MUBASHER_IMPORT':`CURRENT_SESSION_${selected.sourceId}_ONLY`;
  const base={...selected,ticker:String(ticker??selected.ticker??'').toUpperCase(),session:expectedSession,researchState:materialConflict?'QUARANTINED_RESEARCH':'READY_RESEARCH',verificationState,quarantineReasons:materialConflict?uniq(reasons):[],currentSessionEvidence:{expectedSession,observationCount:expected.length,independentProviderCount:independent.length,sources:uniq(expected.map(x=>x.sourceId)),providers:uniq(expected.map(x=>x.providerGroup)),comparisons,reasons:uniq(reasons)}};
  delete base.rowHash;
  const authoritativeResearch=stampResearchRecord({...base,rowHash:sha256(base)},{sourceId:selected.sourceId});
  return{state:materialConflict?'DATA_CONFLICT':'READY_RESEARCH',reasons:uniq(reasons),ticker:authoritativeResearch.ticker,expectedSession,authoritativeResearch,evidence:{observations:valid,expectedObservations:expected,independent,comparisons}};
}

export function evaluateResearchDataReadiness({expectedSession,universeSize,records,minCoveragePct=70,maxConflictPct=10}={}){
  const rows=Array.isArray(records)?records:[],reasons=[];
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(expectedSession??'')))reasons.push('EXPECTED_SESSION_REQUIRED');
  const size=Number(universeSize)||0;if(size<=0)reasons.push('UNIVERSE_EMPTY');
  const current=rows.filter(x=>x?.authoritativeResearch?.session===expectedSession),ready=current.filter(x=>x.state==='READY_RESEARCH'&&x.authoritativeResearch?.researchState==='READY_RESEARCH'),conflicts=current.filter(x=>x.state==='DATA_CONFLICT');
  const coveragePct=size?ready.length/size*100:0,conflictPct=size?conflicts.length/size*100:0;
  if(coveragePct<minCoveragePct)reasons.push(`EXPECTED_SESSION_COVERAGE_BELOW_${minCoveragePct}:${coveragePct.toFixed(2)}%`);
  if(conflictPct>maxConflictPct)reasons.push(`EXPECTED_SESSION_CONFLICTS_ABOVE_${maxConflictPct}:${conflictPct.toFixed(2)}%`);
  const providers={};for(const r of ready){for(const p of r.authoritativeResearch?.currentSessionEvidence?.providers??[])providers[p]=(providers[p]??0)+1}
  return{state:reasons.length?'FAIL':'PASS',reasons,expectedSession,counts:{universe:size,currentRows:current.length,ready:ready.length,conflicts:conflicts.length,coveragePct:Number(coveragePct.toFixed(2)),conflictPct:Number(conflictPct.toFixed(2)),providers}};
}
