#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
function read(rel, fallback) { try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; } }
function write(rel, value) { const file=P(rel); fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,`${JSON.stringify(value,null,2)}\n`,'utf8'); }
function arr(v){return Array.isArray(v)?v:[]}
function num(v,fallback=null){if(v===null||v===undefined||v==='')return fallback;const n=Number(v);return Number.isFinite(n)?n:fallback}
function clamp(v,lo=0,hi=100){return Math.max(lo,Math.min(hi,num(v,lo)))}
function sym(row){return String(row?.symbol||row?.ticker||row?.code||'').trim().toUpperCase()}
function mapBySymbol(rows){const map=new Map();for(const row of arr(rows)){const s=sym(row);if(s)map.set(s,row)}return map}
function cleanName(v){const text=String(v||'').replace(/<[^>]+>/g,' ').replace(/-->/g,' ').replace(/\s+/g,' ').trim();return /End AdSlot|^[\[\]0-9,]{5,}/i.test(text)?'':text}
function regularEgxDate(value){const s=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;const d=new Date(`${s}T12:00:00Z`);if(Number.isNaN(d.getTime()))return false;return d.getUTCDay()>=0&&d.getUTCDay()<=4}
function deriveDataQuality(marketRow,srRow){const checks=[num(marketRow?.price??marketRow?.last)!==null,num(marketRow?.open)!==null,num(marketRow?.high)!==null,num(marketRow?.low)!==null,num(marketRow?.volume)!==null,num(marketRow?.valueTraded??marketRow?.turnover)!==null,Boolean(srRow&&num(srRow.support1)!==null&&num(srRow.resistance1)!==null)];return Math.round(checks.filter(Boolean).length/checks.length*100)}

const market=read('data/market.json',{});
const technical=read('data/technical-50-report.json',{});
const history=read('data/history-50.json',{symbols:{}});
const sr=read('data/v17/internal-ohlc-support-resistance.json',{});
const truth=read('data/v17/market-session-truth.json',{});
const old=read('data/recommendations.json',{});
const sessionDate=truth.selectedSessionDate||sr.referenceSessionDate||null;
if(!sessionDate||!regularEgxDate(sessionDate))throw new Error(`Cannot rebuild current recommendation base without valid EGX sessionDate: ${sessionDate}`);
if(sr.referenceSessionDate&&sr.referenceSessionDate!==sessionDate)throw new Error(`S/R session ${sr.referenceSessionDate} != verified session ${sessionDate}`);
if(technical.referenceSessionDate&&technical.referenceSessionDate!==sessionDate)throw new Error(`Technical session ${technical.referenceSessionDate} != verified session ${sessionDate}`);
if(history.referenceSessionDate&&history.referenceSessionDate!==sessionDate)throw new Error(`History session ${history.referenceSessionDate} != verified session ${sessionDate}`);

const invalidHistory=[];
for(const [symbol,points] of Object.entries(history.symbols||{}))for(const point of arr(points)){const d=String(point?.date||'');if(!regularEgxDate(d)||d>sessionDate)invalidHistory.push(`${symbol}:${d}`)}
if(invalidHistory.length)throw new Error(`Non-trading/future history leaked into recommendation base: ${invalidHistory.slice(0,12).join(', ')}`);
const invalidTechnical=arr(technical.symbols).filter(t=>!regularEgxDate(t.lastDate)||t.lastDate>sessionDate);
if(invalidTechnical.length)throw new Error(`Technical report contains non-trading/future session rows: ${invalidTechnical.slice(0,12).map(t=>`${t.symbol}:${t.lastDate}`).join(', ')}`);

const technicalMap=mapBySymbol(technical.symbols),srMap=mapBySymbol(sr.rows),oldMap=mapBySymbol(old.all),rows=[];
for(const m of arr(market.rows)){
  const symbol=sym(m),price=num(m.price??m.last),t=technicalMap.get(symbol);if(!symbol||!price||!t)continue;
  const s=srMap.get(symbol)||{},meta=oldMap.get(symbol)||{};
  const finalConfidence=Math.round(clamp(t.confidence));
  const support1=num(s.support1,num(t.support)),support2=num(s.support2),resistance1=num(s.resistance1,num(t.resistance)),resistance2=num(s.resistance2);
  const dataQualityScore=deriveDataQuality(m,s),signal=String(t.signal||'مراقبة'),riskScore=clamp(t.riskScore,50);
  rows.push({symbol,name_ar:cleanName(m.name_ar)||cleanName(meta.name_ar)||cleanName(meta.name)||symbol,name_en:cleanName(m.name_en)||cleanName(meta.name_en)||symbol,sector:m.sector||m.sector_ar||meta.sector||meta.sector_ar||'غير مصنف',price,last:price,open:num(m.open),high:num(m.high),low:num(m.low),previousClose:num(m.previousClose),changePct:num(m.changePct),volume:num(m.volume,0),valueTraded:num(m.valueTraded??m.turnover,0),turnover:num(m.valueTraded??m.turnover,0),support1,support2,resistance1,resistance2,pivot:num(s.pivot),finalConfidence,confidence:finalConfidence,dataQualityScore,liquidityScore:clamp(t.liquidityScore,0),trendScore:clamp(t.trendScore,50),riskScore,technicalScore:clamp(t.trendScore,50),signal,recommendation:signal,historySessions:num(t.points,0),sma20:num(t.sma20),sma50:num(t.sma50),volatilityPct:num(t.volatilityPct),avgVolume20:num(t.avgVolume20,0),avgTurnover20:num(t.avgTurnover20,0),sessionDate,updatedAt:m.updatedAt||market.updatedAt||market.generatedAt||null,sourceUrl:m.sourceUrl||null,recommendationBase:{engine:'V17_CURRENT_SESSION_TECHNICAL_BASE_1',scoreSource:'data/technical-50-report.json#confidence',priceSource:'data/market.json',supportResistanceSource:s.source?'data/v17/internal-ohlc-support-resistance.json':'data/technical-50-report.json',metadataFallbackOnly:oldMap.has(symbol)?'data/recommendations.json':null,legacyScoreUsed:false,legacyEntryTargetStopUsed:false,sessionDate}})
}
rows.sort((a,b)=>b.finalConfidence-a.finalConfidence||b.liquidityScore-a.liquidityScore||a.symbol.localeCompare(b.symbol));
const generatedAt=new Date().toISOString(),topBuyCandidates=rows.filter(r=>!/risk|بيع|خروج|مخاطر|مرتفع التذبذب/i.test(String(r.signal))).slice(0,30);
const out={ok:rows.length>=80,engine:'V17_CURRENT_SESSION_TECHNICAL_BASE_1',generatedAt,sessionDate,source:'current_session_rebuild_from_existing_technical_50_methodology',sourceProvenance:{confidence:'data/technical-50-report.json',price:'data/market.json',supportResistance:'data/v17/internal-ohlc-support-resistance.json with technical fallback',sessionTruth:'data/v17/market-session-truth.json',legacyRecommendationsRole:'metadata fallback only; legacy scores and price plans are forbidden'},policy:{newTradingFormulaIntroduced:false,technical50MethodologyReused:true,verifiedTradingSessionHistoryRequired:true,fridaySaturdayHistoryForbidden:true,staleLegacyConfidenceForbidden:true,staleLegacyPricePlanForbidden:true,immutableChampionSignalUntouched:true},total:rows.length,all:rows,topBuyCandidates};
if(!out.ok)throw new Error(`Current recommendation base coverage too low: ${rows.length}`);
if(rows.some(r=>r.recommendationBase?.legacyScoreUsed!==false||r.recommendationBase?.legacyEntryTargetStopUsed!==false))throw new Error('Legacy analytical fields leaked into current recommendation base');
write('data/recommendations.json',out);
write('data/v17/current-recommendation-base-status.json',{schemaVersion:'17.0.0-current-recommendation-base-1',generatedAt,sessionDate,ok:true,engine:out.engine,total:rows.length,topSymbols:rows.slice(0,10).map(r=>({symbol:r.symbol,confidence:r.finalConfidence,technicalSignal:r.signal,historySessions:r.historySessions})),staleLegacyConfidenceUsed:false,staleLegacyPricePlanUsed:false,invalidHistoryPoints:invalidHistory.length,invalidTechnicalRows:invalidTechnical.length,scoreMethodology:'EXISTING_TECHNICAL_50_CONFIDENCE_REUSED_WITHOUT_NEW_STRATEGY_FORMULA'});
console.log(JSON.stringify({engine:out.engine,generatedAt,sessionDate,total:rows.length,top:rows.slice(0,10).map(r=>`${r.symbol}:${r.finalConfidence}`)},null,2));
