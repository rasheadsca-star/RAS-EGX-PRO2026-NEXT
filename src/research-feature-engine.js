import { sha256 } from './hash.js';
import { validateFeatureBundle } from './feature-bundle-gate.js';

const TECHNICAL_VERSION='research-technical-v1';
const LIQUIDITY_VERSION='research-liquidity-v1';
const CORPORATE_ACTION_VERSION='research-ca-jump-guard-v1';

function finite(v){return Number.isFinite(Number(v))?Number(v):null}
function validBar(b){const o=finite(b?.open),h=finite(b?.high),l=finite(b?.low),c=finite(b?.close),v=finite(b?.volume);return Boolean(b&&/^\d{4}-\d{2}-\d{2}$/.test(String(b.session??''))&&o!==null&&h!==null&&l!==null&&c!==null&&v!==null&&o>0&&h>0&&l>0&&c>0&&v>=0&&h>=Math.max(o,c)&&l<=Math.min(o,c)&&h>=l)}
function round(v,d=4){return Number.isFinite(v)?Number(v.toFixed(d)):null}
function avg(a){return a.length?a.reduce((s,x)=>s+x,0)/a.length:null}
function median(a){if(!a.length)return null;const s=[...a].sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2}
function sma(values,n){return values.length>=n?avg(values.slice(-n)):null}
function stdev(values){if(values.length<2)return null;const m=avg(values),v=avg(values.map(x=>(x-m)**2));return Math.sqrt(v)}
function rsi(closes,n=14){if(closes.length<n+1)return null;let g=0,l=0;for(let i=closes.length-n;i<closes.length;i++){const d=closes[i]-closes[i-1];if(d>0)g+=d;else l-=d}g/=n;l/=n;if(l===0)return g===0?50:100;return 100-(100/(1+g/l))}
function atr(bars,n=14){if(bars.length<n+1)return null;const tr=[];for(let i=bars.length-n;i<bars.length;i++){const b=bars[i],p=bars[i-1];tr.push(Math.max(b.high-b.low,Math.abs(b.high-p.close),Math.abs(b.low-p.close)))}return avg(tr)}
function pct(a,b){return Number.isFinite(a)&&Number.isFinite(b)&&b!==0?(a/b-1)*100:null}

export function buildResearchFeatureRecord({ticker,history,currentRecord,signalSession,decisionCutoff,minPriorSessions=60,corporateActionJumpPct=20.5}={}){
  const id=String(ticker??'').trim().toUpperCase();
  if(!id||!/^\d{4}-\d{2}-\d{2}$/.test(String(signalSession??''))||!decisionCutoff)throw new Error('RESEARCH_FEATURE_CONTEXT_REQUIRED');
  if(currentRecord?.state!=='READY_RESEARCH'||currentRecord?.authoritativeResearch?.session!==signalSession)return Object.freeze({ticker:id,state:'SOURCE_UNAVAILABLE',featureReady:false,reasons:['CURRENT_RESEARCH_SESSION_NOT_READY'],signalSession,productionAuthority:false,researchOnly:true});
  const current={...currentRecord.authoritativeResearch,session:signalSession};
  if(!validBar(current))return Object.freeze({ticker:id,state:'BLOCKED',featureReady:false,reasons:['CURRENT_BAR_INVALID'],signalSession,productionAuthority:false,researchOnly:true});
  const priorMap=new Map();
  for(const row of history?.sessions??[]){if(row?.researchState!=='READY_RESEARCH'||String(row.session)>=signalSession||!validBar(row))continue;priorMap.set(String(row.session),{session:String(row.session),open:Number(row.open),high:Number(row.high),low:Number(row.low),close:Number(row.close),volume:Number(row.volume)})}
  const prior=[...priorMap.values()].sort((a,b)=>a.session.localeCompare(b.session));
  if(prior.length<minPriorSessions)return Object.freeze({ticker:id,state:'INSUFFICIENT_HISTORY',featureReady:false,reasons:[`PRIOR_SESSIONS:${prior.length}<${minPriorSessions}`],signalSession,priorSessions:prior.length,productionAuthority:false,researchOnly:true});
  const bars=[...prior,current].sort((a,b)=>a.session.localeCompare(b.session));
  const closes=bars.map(b=>Number(b.close));
  const prev=prior.at(-1),prior20=prior.slice(-20),returns20=[];
  const recent=bars.slice(-21);for(let i=1;i<recent.length;i++)returns20.push(recent[i].close/recent[i-1].close-1);
  const a14=atr(bars,14),priorHigh20=prior20.length?Math.max(...prior20.map(b=>b.high)):null;
  const technical={close:round(current.close),sma20:round(sma(closes,20)),sma50:round(sma(closes,50)),rsi14:round(rsi(closes,14)),atr14:round(a14),atrPct:round(a14/current.close*100),momentum20Pct:round(pct(current.close,bars.at(-21)?.close)),momentum60Pct:round(pct(current.close,bars.at(-61)?.close)),closeVsSma20Pct:round(pct(current.close,sma(closes,20))),closeVsSma50Pct:round(pct(current.close,sma(closes,50))),distanceToPrior20dHighPct:round(pct(current.close,priorHigh20)),breakoutAbovePrior20dHigh:Boolean(priorHigh20!==null&&current.close>priorHigh20),realizedVol20Pct:round(stdev(returns20)*Math.sqrt(252)*100)};
  const priorVolumes=prior20.map(b=>b.volume),priorValues=prior20.map(b=>b.close*b.volume),avgVolume20=avg(priorVolumes);
  const liquidity={volume:current.volume,avgVolume20:round(avgVolume20,2),relativeVolume20:round(avgVolume20>0?current.volume/avgVolume20:null),medianTradedValue20:round(median(priorValues),2),avgTradedValue20:round(avg(priorValues),2),currentTradedValue:round(current.close*current.volume,2)};
  const jumpPct=pct(current.close,prev.close),caReview=Math.abs(jumpPct??0)>corporateActionJumpPct;
  const corporateActions={previousSession:prev.session,previousClose:round(prev.close),currentClose:round(current.close),closeJumpPct:round(jumpPct),reviewThresholdPct:corporateActionJumpPct,reviewRequired:caReview};
  const historyVersion=history?.metadata?.datasetHash??history?.provenance?.sourceFileHash??sha256(prior);
  const currentVersion=current.rowHash??sha256(current),availableAt=String(decisionCutoff),sourceVersion=sha256({historyVersion,currentVersion});
  const groups=[
    {name:'TECHNICAL',state:'READY',asOfSession:signalSession,availableAt,sourceVersion,featureVersion:TECHNICAL_VERSION,payloadHash:sha256(technical),payload:technical},
    {name:'LIQUIDITY',state:'READY',asOfSession:signalSession,availableAt,sourceVersion,featureVersion:LIQUIDITY_VERSION,payloadHash:sha256(liquidity),payload:liquidity},
    {name:'CORPORATE_ACTIONS',state:caReview?'CORPORATE_ACTION_REVIEW':'READY',asOfSession:signalSession,availableAt,sourceVersion:sha256({previousSession:prev.session,currentVersion}),featureVersion:CORPORATE_ACTION_VERSION,payloadHash:sha256(corporateActions),payload:corporateActions}
  ];
  const gate=validateFeatureBundle({groups},{signalSession,decisionCutoff});
  const payload={ticker:id,signalSession,priorSessions:prior.length,groups,gate:{state:gate.state,ready:gate.ready,reasons:gate.reasons,manifestHash:gate.manifestHash}};
  return Object.freeze({...payload,state:gate.state==='READY'?'FEATURE_READY':gate.state,featureReady:gate.ready,reasons:gate.reasons,featureHash:sha256(payload),authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,strategyAuthorized:false,recommendationAuthorized:false});
}

export function buildDescriptiveLeaderboards(records,{limit=10}={}){
  const ready=(records??[]).filter(r=>r?.featureReady===true);
  const value=(r,g,k)=>r.groups.find(x=>x.name===g)?.payload?.[k];
  const top=(g,k,dir='desc')=>ready.filter(r=>Number.isFinite(value(r,g,k))).sort((a,b)=>(dir==='asc'?1:-1)*(value(a,g,k)-value(b,g,k))||a.ticker.localeCompare(b.ticker)).slice(0,limit).map(r=>({ticker:r.ticker,value:value(r,g,k),metric:k}));
  return Object.freeze({combinedOpportunityScore:null,rankingAuthority:'DESCRIPTIVE_ONLY_NOT_STRATEGY',momentum20:top('TECHNICAL','momentum20Pct'),relativeVolume20:top('LIQUIDITY','relativeVolume20'),liquidity20:top('LIQUIDITY','medianTradedValue20'),lowestAtrPct:top('TECHNICAL','atrPct','asc')});
}
