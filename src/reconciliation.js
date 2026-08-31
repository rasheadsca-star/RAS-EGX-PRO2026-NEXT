import { sha256 } from './hash.js';

const DEFAULT_PRIORITY={OFFICIAL_EXCHANGE:100,LICENSED_EOD:95,PUBLIC_MARKET:70,REFERENCE_ONLY:20};
function valid(o){return o&&o.ticker&&o.session&&o.sourceId&&[o.open,o.high,o.low,o.close].every(v=>Number.isFinite(v)&&v>0)&&o.high>=o.open&&o.high>=o.close&&o.high>=o.low&&o.low<=o.open&&o.low<=o.close&&(o.volume==null||(Number.isFinite(o.volume)&&o.volume>=0))}
function pct(a,b){return a&&b?Math.abs(a/b-1)*100:Infinity}
export function reconcileObservations(observations,{maxCloseConflictPct=1,requireCrossCheck=true,priority=DEFAULT_PRIORITY}={}){
  if(!Array.isArray(observations)||observations.length===0)return{status:'SOURCE_UNAVAILABLE',reasons:['NO_OBSERVATIONS'],authoritative:null,sourceManifest:null};
  const bad=observations.filter(o=>!valid(o));if(bad.length)return{status:'BLOCKED',reasons:bad.map(o=>`INVALID_SOURCE_ROW:${o?.sourceId??'UNKNOWN'}`),authoritative:null,sourceManifest:null};
  const tickers=new Set(observations.map(o=>o.ticker)),sessions=new Set(observations.map(o=>o.session));
  if(tickers.size!==1||sessions.size!==1)return{status:'BLOCKED',reasons:['MIXED_TICKER_OR_SESSION'],authoritative:null,sourceManifest:null};
  const ordered=[...observations].sort((a,b)=>(priority[b.sourceClass]??0)-(priority[a.sourceClass]??0)||a.sourceId.localeCompare(b.sourceId));
  const primary=ordered[0]; const conflicts=ordered.slice(1).map(o=>({sourceId:o.sourceId,closeConflictPct:pct(o.close,primary.close),openConflictPct:pct(o.open,primary.open),highConflictPct:pct(o.high,primary.high),lowConflictPct:pct(o.low,primary.low)}));
  const material=conflicts.filter(c=>c.closeConflictPct>maxCloseConflictPct);
  const sourceManifest={ticker:primary.ticker,session:primary.session,primarySource:primary.sourceId,primaryClass:primary.sourceClass,sources:ordered.map(o=>({sourceId:o.sourceId,sourceClass:o.sourceClass,capturedAt:o.capturedAt??null,rowHash:sha256(o)})),conflicts};
  sourceManifest.manifestHash=sha256(sourceManifest);
  if(material.length)return{status:'DATA_CONFLICT',reasons:material.map(c=>`CLOSE_CONFLICT:${c.sourceId}:${c.closeConflictPct.toFixed(4)}%`),authoritative:null,sourceManifest};
  if(requireCrossCheck&&ordered.length<2)return{status:'SOURCE_UNAVAILABLE',reasons:['CROSS_CHECK_REQUIRED'],authoritative:null,sourceManifest};
  return{status:'READY',reasons:[],authoritative:{...primary},sourceManifest};
}
