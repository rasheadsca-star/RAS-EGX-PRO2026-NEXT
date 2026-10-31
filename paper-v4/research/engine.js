(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EGXResearch=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const STATES=Object.freeze({FROZEN:'FROZEN_PAPER_REFERENCE',WATCH:'RESEARCH_WATCH',INELIGIBLE:'NOT_ELIGIBLE'});
function classify(row,session){
 if(!row||!/^[A-Z0-9]{2,12}$/.test(row.ticker||''))return {state:STATES.INELIGIBLE,why:'BAD_SYMBOL'};
 if(row.frozenRecommendation===true)return {state:STATES.FROZEN,why:row.multiFactorPass===true?'FROZEN_AND_PASSED_RESEARCH_FILTER':'FROZEN_ARCHIVED_UNCHANGED'};
 if(row.historyEligible!==true)return {state:STATES.INELIGIBLE,why:'INSUFFICIENT_OR_STALE_HISTORY'};
 if(row.evidence!=='DIRECT_OFFICIAL_CLOSE')return {state:STATES.WATCH,why:'OFFICIAL_CLOSE_REVIEW_REQUIRED'};
 if(row.multiFactorPass===true&&row.volatilityPass===true)return {state:STATES.WATCH,why:'MULTIFACTOR_VOLATILITY_PASS_RESEARCH_ONLY'};
 if(row.volatilityPass===false)return {state:STATES.INELIGIBLE,why:'VOLATILITY_FILTER_FAILED'};
 return {state:STATES.WATCH,why:'NO_STRICT_MULTIFACTOR_SIGNAL'};
}
function rank(snapshot){
 if(snapshot?.mode!=='RESEARCH_ONLY'||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(snapshot.session||''))throw Error('Unverified research snapshot');
 const rows=(snapshot.rows||[]).map(r=>({...r,...classify(r,snapshot.session)}));
 if(new Set(rows.map(r=>r.ticker)).size!==rows.length)throw Error('Duplicate ticker');
 return rows.sort((a,b)=>{
  const priority={FROZEN_PAPER_REFERENCE:0,RESEARCH_WATCH:1,NOT_ELIGIBLE:2};
  return priority[a.state]-priority[b.state]||Number(b.multiFactorPass===true)-Number(a.multiFactorPass===true)||(Number(b.score)||0)-(Number(a.score)||0)||a.ticker.localeCompare(b.ticker);
 });
}
function normalizeCSV(text){
 const lines=String(text).replace(/^\uFEFF/,'').trim().split(/\r?\n/);
 const cols=lines.shift().split(',').map(s=>s.trim());const i=x=>cols.indexOf(x);
 const required=['ticker','last_session','last_close','last_close_evidence','history_rows','score','volatility20_pct','base_multifactor','volatility_pass','filtered_multifactor','frozen_seed_29oct'];
 if(required.some(c=>i(c)<0))throw Error('Missing required V4 research CSV columns');
 const rows=lines.filter(Boolean).map(line=>{
  // CSV exported by the read-only screening has unquoted numeric/symbol fields.
  const a=line.split(',');
  const b=x=>a[i(x)]||'';
  return {ticker:b('ticker'),session:b('last_session'),close:Number(b('last_close')),evidence:b('last_close_evidence'),score:b('score')===''?null:Number(b('score')),volatility20Pct:b('volatility20_pct')===''?null:Number(b('volatility20_pct')),historyEligible:b('score')!==''&&b('last_session')==='2026-10-29'&&Number(b('history_rows'))>=60,volatilityPass:b('volatility_pass')==='True',multiFactorPass:b('filtered_multifactor')==='True',frozenRecommendation:b('frozen_seed_29oct')==='True'};
 });
 return {schema:1,mode:'RESEARCH_ONLY',session:'2026-10-29',snapshotType:'USER_LOADED_FULL_UNIVERSE_RESEARCH',universeTotal:rows.length,rows};
}
function forwardGuard(signal, observation){
 if(!signal||!observation)throw Error('Missing future observation');
 if(signal.mode!=='RESEARCH_ONLY')throw Error('Only research signals');
 if(signal.ticker!==observation.ticker)throw Error('Ticker mismatch');
 if(!(observation.session>signal.session))throw Error('Future test requires later trading session');
 if(observation.evidence!=='DIRECT_OFFICIAL_CLOSE')throw Error('Future close must be directly officially verified');
 if(!Number.isFinite(Number(observation.close))||Number(observation.close)<=0)throw Error('Invalid future close');
 if(!Number.isFinite(Number(signal.referenceClose))||Number(signal.referenceClose)<=0)throw Error('Invalid signal reference close');
 return {ticker:signal.ticker,signalSession:signal.session,observedSession:observation.session,returnPct:Math.round((Number(observation.close)/Number(signal.referenceClose)-1)*10000)/100,evidence:observation.evidence,mode:'RESEARCH_ONLY',noOrders:true};
}
return {STATES,classify,rank,normalizeCSV,forwardGuard};
});