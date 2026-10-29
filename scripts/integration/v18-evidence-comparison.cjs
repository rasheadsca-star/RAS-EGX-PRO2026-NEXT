'use strict';
/** Research-only provenance comparator; never upgrades evidence to a trade signal. */
function validDate(x){if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x))return false;const d=new Date(x+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===x}
function normalizeTicker(x){return typeof x==='string'&&/^[A-Z0-9.]{1,16}$/.test(x.trim().toUpperCase())?x.trim().toUpperCase():null}
function compare(legacy,quant){
if(!Array.isArray(legacy?.entries)||!validDate(quant?.sessionId))throw Error('Invalid evidence input');
const latest=new Map(),invalid=[];
for(const [index,x] of legacy.entries.entries()){
const p=x?.issued,t=normalizeTicker(p?.ticker);
if(!t||!validDate(p?.sessionId)||p.sessionId>quant.sessionId){invalid.push(index);continue}
const old=latest.get(t);
if(!old||p.sessionId>old.sessionId)latest.set(t,{ticker:t,sessionId:p.sessionId,families:Array.isArray(p.strategyFamilies)?p.strategyFamilies:[],evaluation:x?.evaluation?.status||null,forward:x?.futurePerformance?.status||null});
}
const candidates=[...(Array.isArray(quant.paperCandidates)?quant.paperCandidates:[]),...(Array.isArray(quant.watchCandidates)?quant.watchCandidates:[])];
const joined=candidates.map(q=>({ticker:normalizeTicker(q?.ticker),quantDate:q?.signalDate,v:latest.get(normalizeTicker(q?.ticker))})).filter(z=>z.ticker&&z.v).map(z=>({...z, sameSession:z.quantDate===z.v.sessionId}));
const newest=[...latest.values()].reduce((a,v)=>v.sessionId>a?v.sessionId:a,'');
return {archivedCount:legacy.entries.length,validSymbols:latest.size,invalidCount:invalid.length,newest,quantDate:quant.sessionId,joined,allSameDate:joined.length>0&&joined.every(z=>z.sameSession),historicalOnly:true};
}
module.exports={validDate,normalizeTicker,compare};
