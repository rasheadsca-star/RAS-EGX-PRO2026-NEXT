(function(global){
'use strict';

const CONTRACT=Object.freeze({
  module:'TECHNICAL_CHART_V2_1_SESSION_ALIGNMENT',
  authorityMode:'RESEARCH',
  scoringImpact:'NONE',
  recommendationMutationAllowed:false,
  executionAllowed:false,
  automaticOrders:false,
  currentBarPolicy:'READY_RESEARCH_EXACT_SESSION_ONLY'
});
const alignmentCache=new Map();

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null}
function sessionOf(r){return String(r?.session??r?.date??r?.marketSessionDate??r?.sourceSessionDate??'').slice(0,10)}
function normalizedBar(r){
  if(!r)return null;
  const open=finite(r.open),high=finite(r.high),low=finite(r.low),close=finite(r.close),volume=finite(r.volume),session=sessionOf(r);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(session))return null;
  if(!(open>0&&high>0&&low>0&&close>0&&volume>=0))return null;
  if(high<Math.max(open,close,low)||low>Math.min(open,close,high))return null;
  return {session,open,high,low,close,volume,researchState:r.researchState??null,sourceId:r.sourceId??null,providerGroup:r.providerGroup??null,verificationState:r.verificationState??null,currentSessionEvidence:r.currentSessionEvidence??null,raw:r};
}
function almostEqual(a,b,eps=1e-8){const x=finite(a),y=finite(b);return x!=null&&y!=null&&Math.abs(x-y)<=Math.max(eps,Math.max(Math.abs(x),Math.abs(y))*eps)}
function sameBar(a,b){return !!(a&&b&&a.session===b.session&&almostEqual(a.open,b.open)&&almostEqual(a.high,b.high)&&almostEqual(a.low,b.low)&&almostEqual(a.close,b.close)&&almostEqual(a.volume,b.volume,1e-6))}

function resolveCurrentBar(live,ticker,expectedSession){
  const expected=String(expectedSession||live?.expectedSession||'').slice(0,10),t=String(ticker||'').toUpperCase();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(expected))return {state:'BLOCKED',reason:'EXPECTED_SESSION_MISSING',expectedSession:expected||null,bar:null};
  if(live?.authorityMode!=='RESEARCH'||live?.researchOnly!==true||live?.productionAuthority!==false)return {state:'BLOCKED',reason:'LIVE_AUTHORITY_BOUNDARY_INVALID',expectedSession:expected,bar:null};
  if(live?.expectedSession!==expected||live?.targetSession!==expected)return {state:'BLOCKED',reason:'LIVE_SESSION_BINDING_INVALID',expectedSession:expected,bar:null};
  const rec=(live?.records||[]).find(x=>String(x?.ticker||'').toUpperCase()===t);
  if(!rec)return {state:'STALE',reason:'SYMBOL_CURRENT_RECORD_MISSING',expectedSession:expected,bar:null};
  if(rec.state!=='READY_RESEARCH'||rec.authoritativeResearch?.researchState!=='READY_RESEARCH')return {state:'STALE',reason:`CURRENT_RECORD_NOT_READY:${rec.state||'UNKNOWN'}`,expectedSession:expected,bar:null,record:rec};
  const ar=rec.authoritativeResearch;
  if(ar.session!==expected)return {state:'BLOCKED',reason:`CURRENT_SESSION_MISMATCH:${ar.session||'MISSING'}:${expected}`,expectedSession:expected,bar:null,record:rec};
  const bar=normalizedBar(ar);
  if(!bar)return {state:'BLOCKED',reason:'CURRENT_READY_RESEARCH_OHLCV_INVALID',expectedSession:expected,bar:null,record:rec};
  return {state:'READY_RESEARCH',reason:null,expectedSession:expected,bar,record:rec,sourceId:ar.sourceId??null,providerGroup:ar.providerGroup??null,verificationState:ar.verificationState??null,evidenceReasons:ar.currentSessionEvidence?.reasons??[]};
}

function mergeCurrentBar(history,live,ticker,expectedSession){
  const current=resolveCurrentBar(live,ticker,expectedSession),sessions=Array.isArray(history?.sessions)?history.sessions.slice():[];
  const historyBars=sessions.map(normalizedBar).filter(Boolean),last=historyBars.at(-1)||null;
  if(current.state!=='READY_RESEARCH'){
    return {payload:history,alignment:{ticker:String(ticker||'').toUpperCase(),state:current.state==='BLOCKED'?'BLOCKED':'HISTORICAL_ONLY',reason:current.reason,expectedSession:current.expectedSession,lastHistorySession:last?.session??null,currentBar:null,sourceId:null,verificationState:null,bars:historyBars}};
  }
  const bar=current.bar;
  const sameSessionIndex=historyBars.findIndex(x=>x.session===bar.session);
  if(sameSessionIndex>=0){
    const existing=historyBars[sameSessionIndex];
    if(!sameBar(existing,bar))return {payload:{...history,sessions:[]},alignment:{ticker:String(ticker||'').toUpperCase(),state:'BLOCKED',reason:'CURRENT_HISTORY_BAR_CONFLICT',expectedSession:bar.session,lastHistorySession:last?.session??null,currentBar:bar,sourceId:current.sourceId,verificationState:current.verificationState,bars:[]}};
    return {payload:history,alignment:{ticker:String(ticker||'').toUpperCase(),state:'ALIGNED_EXISTING',reason:null,expectedSession:bar.session,lastHistorySession:last?.session??null,currentBar:bar,sourceId:current.sourceId,verificationState:current.verificationState,evidenceReasons:current.evidenceReasons,bars:historyBars}};
  }
  if(last?.session&&last.session>bar.session)return {payload:{...history,sessions:[]},alignment:{ticker:String(ticker||'').toUpperCase(),state:'BLOCKED',reason:`HISTORY_AHEAD_OF_RESEARCH:${last.session}:${bar.session}`,expectedSession:bar.session,lastHistorySession:last.session,currentBar:bar,sourceId:current.sourceId,verificationState:current.verificationState,bars:[]}};
  const appended={session:bar.session,open:bar.open,high:bar.high,low:bar.low,close:bar.close,volume:bar.volume,researchState:'READY_RESEARCH',sourceId:bar.sourceId,providerGroup:bar.providerGroup,verificationState:bar.verificationState,currentSessionEvidence:bar.currentSessionEvidence};
  const mergedSessions=[...sessions,appended].sort((a,b)=>sessionOf(a).localeCompare(sessionOf(b)));
  const mergedBars=mergedSessions.map(normalizedBar).filter(Boolean);
  return {payload:{...history,sessions:mergedSessions,chartAlignment:{state:'ALIGNED_APPENDED',expectedSession:bar.session,sourceId:current.sourceId,verificationState:current.verificationState}},alignment:{ticker:String(ticker||'').toUpperCase(),state:'ALIGNED_APPENDED',reason:null,expectedSession:bar.session,lastHistorySession:last?.session??null,currentBar:bar,sourceId:current.sourceId,verificationState:current.verificationState,evidenceReasons:current.evidenceReasons,bars:mergedBars}};
}

function atr14Pct(rows){
  const bars=(rows||[]).map(normalizedBar).filter(Boolean);if(bars.length<15)return null;
  const tr=[];for(let i=1;i<bars.length;i++){const b=bars[i],prev=bars[i-1].close;tr.push(Math.max(b.high-b.low,Math.abs(b.high-prev),Math.abs(b.low-prev)))}
  const x=tr.slice(-14);if(x.length<14)return null;const atr=x.reduce((a,b)=>a+b,0)/x.length,last=bars.at(-1).close;return last>0?atr/last*100:null;
}
function relativeVolume20(rows){
  const bars=(rows||[]).map(normalizedBar).filter(Boolean);if(bars.length<21)return null;
  const current=bars.at(-1).volume,prior=bars.slice(-21,-1).map(x=>x.volume).filter(Number.isFinite);if(prior.length<20)return null;const avg=prior.reduce((a,b)=>a+b,0)/prior.length;return avg>0?current/avg:null;
}
function fmt(v,d=2){return Number.isFinite(Number(v))?Number(v).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}):'—'}
function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function updateMetric(label,value){
  if(typeof document==='undefined')return;for(const mini of document.querySelectorAll('#symbolArea .metrics .mini')){const span=mini.querySelector('span');if(span?.textContent.trim()===label){const b=mini.querySelector('b');if(b)b.textContent=value;break}}
}
function decorate(ticker){
  if(typeof document==='undefined')return;const a=alignmentCache.get(String(ticker||'').toUpperCase());if(!a)return;const area=document.getElementById('symbolArea');if(!area)return;
  area.dataset.chartAlignment=a.state;area.dataset.chartSession=a.expectedSession||'';
  const old=document.getElementById('techV21AlignmentNotice');if(old)old.remove();
  const notice=document.createElement('div');notice.id='techV21AlignmentNotice';
  const aligned=a.state==='ALIGNED_APPENDED'||a.state==='ALIGNED_EXISTING';
  notice.className=`notice ${aligned?'goodline':'badline'}`;notice.style.margin='9px 0';
  if(aligned){
    notice.innerHTML=`<b>CHART V2.1 · SESSION ALIGNED</b> — ${escapeHtml(a.expectedSession)} · READY_RESEARCH · ${escapeHtml(a.sourceId||'UNKNOWN_SOURCE')} · ${escapeHtml(a.verificationState||'NO_VERIFICATION_LABEL')}. المؤشرات الفنية محسوبة بعد ربط شمعة الجلسة الحالية الموثقة.`;
    updateMetric('CLOSE',fmt(a.currentBar?.close,4));
    updateMetric('ATR %',`${fmt(atr14Pct(a.bars),2)}%`);
    updateMetric('RELATIVE VOLUME',`${fmt(relativeVolume20(a.bars),2)}x`);
  }else{
    notice.innerHTML=`<b>CHART V2.1 · NOT CURRENT-SESSION ALIGNED</b> — ${escapeHtml(a.reason||a.state)}. الرسم المتاح تاريخي فقط ولا يُعامل كمؤشر جلسة ${escapeHtml(a.expectedSession||'الحالية')}.`;
  }
  const authority=area.querySelector('.techv2-authority');if(authority)authority.insertAdjacentElement('afterend',notice);else area.prepend(notice);
}

function installRuntimePatch(){
  if(typeof document==='undefined'||typeof global.load!=='function'||typeof global.renderSymbol!=='function')return false;
  if(global.__egxTechV21Installed)return true;global.__egxTechV21Installed=true;
  const originalLoad=global.load.bind(global),originalRender=global.renderSymbol.bind(global);
  global.load=async function(rel,optional=false){
    const payload=await originalLoad(rel,optional),m=/^data\/research\/history\/([A-Z0-9._-]+)\.json$/i.exec(String(rel||''));if(!m||!payload)return payload;
    const ticker=m[1].toUpperCase(),live=await originalLoad('data/research/live/latest.json',true),expected=live?.expectedSession||live?.targetSession||null;
    const merged=mergeCurrentBar(payload,live,ticker,expected);alignmentCache.set(ticker,merged.alignment);return merged.payload;
  };
  global.renderSymbol=async function(query){const out=await originalRender(query);const ticker=document.querySelector('#symbolArea .ticker')?.textContent?.trim()?.toUpperCase()||String(query||'').trim().toUpperCase();decorate(ticker);return out};
  if(global.EGXOneTechnicalV2){global.EGXOneTechnicalV2.sessionAlignmentContract=CONTRACT;global.EGXOneTechnicalV2.alignmentCache=alignmentCache;global.EGXOneTechnicalV2.renderSymbolV21=global.renderSymbol;}
  return true;
}

const API={CONTRACT,normalizedBar,sameBar,resolveCurrentBar,mergeCurrentBar,atr14Pct,relativeVolume20,alignmentCache,decorate,installRuntimePatch};
global.EGXOneTechnicalV21=API;
if(typeof document!=='undefined'){
  const start=()=>{if(!installRuntimePatch())setTimeout(start,50)};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
}
})(typeof window!=='undefined'?window:globalThis);
