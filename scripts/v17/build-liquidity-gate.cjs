#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const OUT = 'data/v17/liquidity-gate.json';

function read(rel, fallback = {}) { try { return JSON.parse(fs.readFileSync(P(rel), 'utf8')); } catch { return fallback; } }
function write(rel, value) { const file=P(rel); fs.mkdirSync(path.dirname(file),{recursive:true}); const tmp=`${file}.tmp`; fs.writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`,'utf8'); JSON.parse(fs.readFileSync(tmp,'utf8')); fs.renameSync(tmp,file); }
function rowsOf(value){ if(Array.isArray(value))return value; for(const key of ['rows','items','data'])if(Array.isArray(value?.[key]))return value[key]; return []; }
function sym(value){ return String(value||'').trim().toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9.]/g,''); }
function n(value){ if(value===null||value===undefined||value==='')return null; const number=Number(String(value).replace(/[,%٬،]/g,'').replace(/[^0-9.+\-eE]/g,'')); return Number.isFinite(number)?number:null; }
function round(value,digits=2){ const number=n(value); if(number===null)return null; const factor=10**digits; return Math.round(number*factor)/factor; }
function avg(values){ const clean=values.filter(value=>Number.isFinite(value)&&value>0); return clean.length?clean.reduce((sum,value)=>sum+value,0)/clean.length:0; }
function validDate(date){ return /^\d{4}-\d{2}-\d{2}$/.test(String(date||'')); }
function isRegularTradingWeekday(date){ if(!validDate(date))return false; const day=new Date(`${date}T12:00:00Z`).getUTCDay(); return day>=0&&day<=4; }

// Exact V11.1 scoring contract. Do not tune these thresholds in V17 without a
// separate versioned research/challenger process.
function scoreFromTurnover(current,avg20,trades=0){ let score=0; if(current>=5_000_000)score+=35;else score+=Math.min(35,current/5_000_000*35); if(avg20>=2_000_000)score+=35;else score+=Math.min(35,avg20/2_000_000*35); if(current>=10_000_000||avg20>=5_000_000)score+=15; if(trades>=100)score+=15;else score+=Math.min(15,trades/100*15); return Math.round(Math.max(0,Math.min(100,score))); }
const THRESHOLDS=Object.freeze({intradayMinCurrentTurnover:5_000_000,intradayMinAvg20Turnover:2_000_000,shortTermMinTurnover:1_000_000,executionMinLiquidityScore:65,conditionalMinLiquidityScore:45,minimumCandidateEvidenceCoveragePct:95});

const market=read('data/market.json',{rows:[]});
const history=read('data/history.json',{sessionsBySymbol:{}});
const ranking=read('data/final-opportunity-ranking.json',{rows:[]});
const sessionTruth=read('data/v17/market-session-truth.json',{});
const marketRows=rowsOf(market),rankingRows=rowsOf(ranking);
const truthSession=validDate(sessionTruth.selectedSessionDate)&&isRegularTradingWeekday(sessionTruth.selectedSessionDate)?sessionTruth.selectedSessionDate:null;
const historySession=validDate(history.sessionDate)&&isRegularTradingWeekday(history.sessionDate)?history.sessionDate:null;
// Research calculations must stay anchored to the canonical selected V17 session even when
// execution verification is intentionally fail-closed. Execution eligibility below still
// requires sessionTruth.executionSafe === true, so this does not relax any execution gate.
const referenceSessionDate=truthSession||historySession;
const marketMap=new Map(marketRows.map(row=>[sym(row.symbol||row.ticker||row.code),row]).filter(([symbol])=>symbol));
const rankedSymbols=[...new Set(rankingRows.map(row=>sym(row.symbol||row.ticker||row.code)).filter(Boolean))].slice(0,80);
const candidateSymbols=rankedSymbols.length?rankedSymbols:[...marketMap.keys()];
const candidateSet=new Set(candidateSymbols);

function completedHistory(symbol){ const sessions=Array.isArray(history?.sessionsBySymbol?.[symbol])?history.sessionsBySymbol[symbol]:[]; return sessions.filter(row=>validDate(row?.date)&&isRegularTradingWeekday(row.date)).filter(row=>!referenceSessionDate||String(row.date)<referenceSessionDate).sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(-20); }

const universe=[...new Set([...marketMap.keys(),...candidateSymbols])].sort();
const rows=universe.map(symbol=>{
  const m=marketMap.get(symbol)||{},sessions=completedHistory(symbol);
  const currentTurnoverRaw=n(m.valueTraded??m.turnover),currentVolumeRaw=n(m.volume),tradesRaw=n(m.trades??m.numberOfTrades);
  const turnoverHistory=sessions.map(row=>n(row.valueTraded??row.turnover)).filter(Number.isFinite),volumeHistory=sessions.map(row=>n(row.volume)).filter(Number.isFinite);
  const currentTurnover=currentTurnoverRaw??0,currentVolume=currentVolumeRaw??0,avg20Turnover=avg(turnoverHistory),avg20Volume=avg(volumeHistory),trades=tradesRaw??0,liquidityScore=scoreFromTurnover(currentTurnover,avg20Turnover,trades);
  const executionLiquidityOk=Boolean(currentTurnover>=THRESHOLDS.intradayMinCurrentTurnover&&avg20Turnover>=THRESHOLDS.intradayMinAvg20Turnover&&currentVolume>0&&liquidityScore>=THRESHOLDS.executionMinLiquidityScore);
  const conditionalLiquidityOk=Boolean((currentTurnover>=THRESHOLDS.shortTermMinTurnover||avg20Turnover>=THRESHOLDS.shortTermMinTurnover)&&currentVolume>0&&liquidityScore>=THRESHOLDS.conditionalMinLiquidityScore);
  const evidenceAvailable=currentTurnoverRaw!==null&&currentVolumeRaw!==null&&turnoverHistory.length>0;
  let liquidityDecision='BLOCKED_ILLIQUID',reason='سيولة ضعيفة أو غير كافية للخروج الآمن';
  if(executionLiquidityOk){liquidityDecision='EXECUTION_OK';reason='السيولة الحالية ومتوسط الجلسات التاريخية المكتملة يسمحان بمراجعة تنفيذية';}
  else if(conditionalLiquidityOk){liquidityDecision='CONDITIONAL_OK';reason='السيولة تسمح بالمراقبة/التنفيذ المشروط وليس مضاربة فورية';}
  else if(currentTurnover>0||avg20Turnover>0){liquidityDecision='WATCH_ONLY';reason='توجد سيولة لكن أقل من حد التنفيذ الآمن';}
  return {symbol,candidate:candidateSet.has(symbol),name:m.name_ar||m.name_en||m.name||'',liquidityDecision,liquidityScore,currentTurnover:round(currentTurnover,0),avg20Turnover:round(avg20Turnover,0),currentVolume:round(currentVolume,0),avg20Volume:round(avg20Volume,0),trades,historicalSessionsUsed:sessions.length,historicalTurnoverSessions:turnoverHistory.length,evidenceAvailable,executionLiquidityOk,conditionalLiquidityOk,reason,provenance:{current:'data/market.json',historical:'data/history.json',sessionTruth:'data/v17/market-session-truth.json',historicalPolicy:'LAST_UP_TO_20_REGULAR_SESSIONS_STRICTLY_BEFORE_SELECTED_REFERENCE_SESSION'}};
});

const candidateRows=rows.filter(row=>row.candidate),candidateEvidenceRows=candidateRows.filter(row=>row.evidenceAvailable),candidateExecutionRows=candidateRows.filter(row=>row.executionLiquidityOk),candidateConditionalRows=candidateRows.filter(row=>row.conditionalLiquidityOk&&!row.executionLiquidityOk);
const candidateEvidenceCoveragePct=candidateSymbols.length?round(candidateEvidenceRows.length/candidateSymbols.length*100,2):0,candidateExecutionOkPct=candidateSymbols.length?round(candidateExecutionRows.length/candidateSymbols.length*100,2):0;
const sourceSessionVerified=Boolean(sessionTruth.executionSafe===true&&truthSession&&isRegularTradingWeekday(truthSession));
const sessionAligned=Boolean(sourceSessionVerified&&referenceSessionDate&&history.sessionDate===referenceSessionDate&&market.sessionDate===referenceSessionDate);
const gatePassed=Boolean(sessionAligned&&candidateEvidenceCoveragePct>=THRESHOLDS.minimumCandidateEvidenceCoveragePct&&candidateExecutionRows.length>0);

const output={schemaVersion:'17.0.0-liquidity-gate-3',generatedAt:new Date().toISOString(),ok:true,engine:'v17_wrapper_of_v11_1_liquidity_gate',referenceSessionDate,sourceSessionVerified,sessionAligned,gatePassed,candidateUniverseCount:candidateSymbols.length,candidateSymbols,candidateEvidenceCount:candidateEvidenceRows.length,candidateEvidenceCoveragePct,candidateExecutionOkCount:candidateExecutionRows.length,candidateExecutionOkPct,candidateConditionalOkCount:candidateConditionalRows.length,executionEligibleSymbols:candidateExecutionRows.map(row=>row.symbol),thresholds:THRESHOLDS,sourceLineage:{rulesSource:'scripts/build-v111-liquidity-gate.js',scoringContract:'V11_1_EXACT_THRESHOLDS_AND_SCORE',currentSource:'data/market.json',historySource:'data/history.json',sessionTruthSource:'data/v17/market-session-truth.json',stalePriceTruthLayerExcluded:'data/price-truth-layer.json'},policy:{currentTurnoverRequired:true,historicalAverageUsesCompletedSessionsOnly:true,currentSessionExcludedFromHistoricalAverage:true,selectedResearchSessionAnchorsCalculations:true,verifiedSourceSessionRequiredForGate:true,weekendHistoryExcluded:true,perSymbolExecutionLiquidityRequired:true,noThresholdRetuningInV17:true,staleOrMissingEvidenceBlocksExecutionNotResearch:true},rows};
write(OUT,output);console.log(JSON.stringify({referenceSessionDate,sourceSessionVerified,sessionAligned,candidateUniverse:candidateSymbols.length,candidateEvidence:candidateEvidenceRows.length,candidateEvidenceCoveragePct,candidateExecutionOk:candidateExecutionRows.length,candidateExecutionOkPct,gatePassed},null,2));
