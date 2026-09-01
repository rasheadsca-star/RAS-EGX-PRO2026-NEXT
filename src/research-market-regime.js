import { sha256 } from './hash.js';

const POLICY=Object.freeze({
  BULLISH_BROAD:Object.freeze({maxRecommendationsPerSession:12,minQualityScore:69,minConfidenceIndex:58,confidenceBias:8}),
  BALANCED:Object.freeze({maxRecommendationsPerSession:8,minQualityScore:75,minConfidenceIndex:62,confidenceBias:3}),
  CAUTION:Object.freeze({maxRecommendationsPerSession:4,minQualityScore:82,minConfidenceIndex:68,confidenceBias:-6}),
  RISK_OFF:Object.freeze({maxRecommendationsPerSession:2,minQualityScore:90,minConfidenceIndex:78,confidenceBias:-15}),
  UNKNOWN:Object.freeze({maxRecommendationsPerSession:3,minQualityScore:85,minConfidenceIndex:72,confidenceBias:-10})
});

function finite(v){const n=Number(v);return Number.isFinite(n)?n:null}
function round(v,d=2){return Number.isFinite(Number(v))?Number(Number(v).toFixed(d)):null}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function median(values){const a=values.map(Number).filter(Number.isFinite).sort((x,y)=>x-y);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2}
function pct(n,d){return d?round(n/d*100,2):0}
function group(record,name){return record?.groups?.find(x=>x.name===name)?.payload??null}

export function regimeMetricsFromFeatureRecord(record){
  if(record?.featureReady!==true)return null;const t=group(record,'TECHNICAL'),l=group(record,'LIQUIDITY');if(!t||!l)return null;
  const close=finite(t.close),sma20=finite(t.sma20),sma50=finite(t.sma50),momentum20Pct=finite(t.momentum20Pct),rsi14=finite(t.rsi14),relativeVolume20=finite(l.relativeVolume20),atrPct=finite(t.atrPct);
  if([close,sma20,sma50,momentum20Pct,rsi14,relativeVolume20,atrPct].some(x=>x===null))return null;
  return {ticker:String(record.ticker??'').toUpperCase(),close,sma20,sma50,momentum20Pct,rsi14,relativeVolume20,atrPct,aboveSma20:close>sma20,aboveSma50:close>sma50,trendAligned:close>sma20&&sma20>sma50,positiveMomentum:momentum20Pct>0};
}

export function regimeMetricsFromUiSymbol(symbol){
  if(symbol?.featureReady!==true)return null;const m=symbol.metrics??{},close=finite(m.close),vs20=finite(m.closeVsSma20Pct),vs50=finite(m.closeVsSma50Pct),momentum20Pct=finite(m.momentum20Pct),rsi14=finite(m.rsi14),relativeVolume20=finite(m.relativeVolume20),atrPct=finite(m.atrPct);if([close,vs20,vs50,momentum20Pct,rsi14,relativeVolume20,atrPct].some(x=>x===null))return null;
  const sma20=close/(1+vs20/100),sma50=close/(1+vs50/100);return {ticker:String(symbol.ticker??'').toUpperCase(),close,sma20,sma50,momentum20Pct,rsi14,relativeVolume20,atrPct,aboveSma20:vs20>0,aboveSma50:vs50>0,trendAligned:vs20>0&&sma20>sma50,positiveMomentum:momentum20Pct>0};
}

export function classifyResearchMarketRegime({session,metricsRows=[]}={}){
  const rows=(metricsRows??[]).filter(x=>x&&x.ticker&&Number.isFinite(Number(x.momentum20Pct))&&Number.isFinite(Number(x.rsi14))&&Number.isFinite(Number(x.relativeVolume20)));
  const n=rows.length,trendAligned=rows.filter(x=>x.trendAligned).length,above20=rows.filter(x=>x.aboveSma20).length,above50=rows.filter(x=>x.aboveSma50).length,positive=rows.filter(x=>x.positiveMomentum).length,strongVolume=rows.filter(x=>Number(x.relativeVolume20)>=1).length;
  const breadth={trendAlignedPct:pct(trendAligned,n),aboveSma20Pct:pct(above20,n),aboveSma50Pct:pct(above50,n),positiveMomentum20Pct:pct(positive,n),relativeVolumeAbove1Pct:pct(strongVolume,n),medianMomentum20Pct:round(median(rows.map(x=>x.momentum20Pct)),2),medianRsi14:round(median(rows.map(x=>x.rsi14)),2),medianAtrPct:round(median(rows.map(x=>x.atrPct)),2)};
  let regime='UNKNOWN';
  if(n>=30){if(breadth.trendAlignedPct>=45&&breadth.aboveSma20Pct>=55&&breadth.positiveMomentum20Pct>=60&&breadth.medianMomentum20Pct>=2)regime='BULLISH_BROAD';else if(breadth.trendAlignedPct>=32&&breadth.aboveSma20Pct>=45&&breadth.positiveMomentum20Pct>=50&&breadth.medianMomentum20Pct>=0)regime='BALANCED';else if(breadth.positiveMomentum20Pct>=40&&breadth.medianMomentum20Pct>=-3)regime='CAUTION';else regime='RISK_OFF'}
  const p=POLICY[regime],stable={schemaVersion:'egx-one-research-market-regime-1',authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,automaticOrders:false,session:String(session??''),regime,coverage:n,classificationPolicy:'FIXED_EX_ANTE_BREADTH_POLICY_V1_NOT_OUTCOME_TUNED',breadth,policy:{maxRecommendationsPerSession:p.maxRecommendationsPerSession,minQualityScore:p.minQualityScore,minConfidenceIndex:p.minConfidenceIndex}};
  return Object.freeze({...stable,regimeHash:sha256(stable)});
}

export function classifyRegimeFromFeatureRecords(featureRecords,{session=null}={}){const rows=(featureRecords??[]).map(regimeMetricsFromFeatureRecord).filter(Boolean);return classifyResearchMarketRegime({session:session??featureRecords?.[0]?.signalSession??'',metricsRows:rows})}
export function classifyRegimeFromUiSymbols(symbols,{session=null}={}){const rows=(symbols??[]).map(regimeMetricsFromUiSymbol).filter(Boolean);return classifyResearchMarketRegime({session,metricsRows:rows})}

export function scoreDynamicResearchConfidence(plan,regime){
  if(plan?.executableResearchPlan!==true)return Object.freeze({confidenceIndex:null,acceptedByRegimeGuard:false,label:'NOT_EXECUTABLE'});const p=POLICY[regime?.regime]??POLICY.UNKNOWN,q=finite(plan.qualityScore)??0,rr=finite(plan.netRiskReward)??0,rv=finite(plan?.diagnostics?.relativeVolume20)??0;
  const rrBonus=clamp((rr-1)*12,0,12),volumeBonus=clamp((rv-.6)*7,0,10),confidence=round(clamp(q*.72+rrBonus+volumeBonus+p.confidenceBias,0,100),1),accepted=q>=p.minQualityScore&&confidence>=p.minConfidenceIndex;
  return Object.freeze({confidenceIndex:confidence,confidenceMeaning:'RESEARCH_RELATIVE_CONFIDENCE_INDEX_NOT_SUCCESS_PROBABILITY',acceptedByRegimeGuard:accepted,minQualityScore:p.minQualityScore,minConfidenceIndex:p.minConfidenceIndex,regime:String(regime?.regime??'UNKNOWN')});
}
