#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);
const OUT = 'data/v17/session-history-repair.json';

function read(rel,fallback={}){try{return JSON.parse(fs.readFileSync(P(rel),'utf8'))}catch{return fallback}}
function write(rel,value){const file=P(rel);fs.mkdirSync(path.dirname(file),{recursive:true});const tmp=`${file}.tmp`;fs.writeFileSync(tmp,`${JSON.stringify(value,null,2)}\n`,'utf8');JSON.parse(fs.readFileSync(tmp,'utf8'));fs.renameSync(tmp,file)}
function n(value){if(value===null||value===undefined||value==='')return null;const x=Number(String(value).replace(/[,%٬،]/g,'').replace(/[^0-9.+\-eE]/g,''));return Number.isFinite(x)?x:null}
function sym(value){return String(value||'').trim().toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9.]/g,'')}
function rowsOf(value){if(Array.isArray(value))return value;for(const key of ['rows','items','data'])if(Array.isArray(value?.[key]))return value[key];return[]}
function validDate(date){return /^\d{4}-\d{2}-\d{2}$/.test(String(date||''))}
function isRegularTradingWeekday(date){if(!validDate(date))return false;const day=new Date(`${date}T12:00:00Z`).getUTCDay();return day>=0&&day<=4}
function validRange(row){const o=n(row?.open),h=n(row?.high),l=n(row?.low),c=n(row?.close??row?.price??row?.last);return[o,h,l,c].every(value=>value!==null&&value>0)&&h>l&&h>=Math.max(o,c)&&l<=Math.min(o,c)}
function sanitize(rows,sessionDate){const kept=[],removed=[];for(const row of Array.isArray(rows)?rows:[]){const date=String(row?.date||'');const impossible=validDate(date)&&(!isRegularTradingWeekday(date)||(sessionDate&&date>sessionDate));if(impossible)removed.push(row);else kept.push(row)}return{kept,removed}}
function mergeByDate(rows,point,maxPoints){const map=new Map();for(const row of Array.isArray(rows)?rows:[]){if(!validDate(row?.date)||!isRegularTradingWeekday(row.date))continue;if(point?.date&&String(row.date)>String(point.date))continue;map.set(String(row.date),row)}if(point&&validDate(point.date)&&isRegularTradingWeekday(point.date))map.set(point.date,point);return[...map.values()].sort((a,b)=>String(a.date).localeCompare(String(b.date))).slice(-maxPoints)}

const truth=read('data/v17/market-session-truth.json',{}),market=read('data/market.json',{rows:[]}),history50=read('data/history-50.json',{symbols:{}}),history=read('data/history.json',{sessionsBySymbol:{}});
const sessionDate=truth.executionSafe===true&&validDate(truth.selectedSessionDate)&&isRegularTradingWeekday(truth.selectedSessionDate)?truth.selectedSessionDate:null;
let removedHistory50=0,removedLegacyHistory=0,mergedVerifiedOhlc=0,verifiedMarketRowsWithRange=0;const repairedSymbols=[];
history50.symbols=history50.symbols&&typeof history50.symbols==='object'?history50.symbols:{};
for(const [symbol,rows] of Object.entries(history50.symbols)){const cleaned=sanitize(rows,sessionDate);removedHistory50+=cleaned.removed.length;history50.symbols[symbol]=cleaned.kept}
history.sessionsBySymbol=history.sessionsBySymbol&&typeof history.sessionsBySymbol==='object'?history.sessionsBySymbol:{};
for(const [symbol,rows] of Object.entries(history.sessionsBySymbol)){const cleaned=sanitize(rows,sessionDate);removedLegacyHistory+=cleaned.removed.length;history.sessionsBySymbol[symbol]=cleaned.kept}

if(sessionDate){
  for(const row of rowsOf(market)){
    const symbol=sym(row?.symbol||row?.ticker||row?.code);if(!symbol||!validRange(row))continue;verifiedMarketRowsWithRange+=1;
    const point={date:sessionDate,open:n(row.open),high:n(row.high),low:n(row.low),close:n(row.close??row.price??row.last),volume:n(row.volume??row.tradedVolume)??0,turnover:n(row.valueTraded??row.turnover??row.tradedValue),source:'workflow-market-snapshot',sourceQuality:'workflow-market-snapshot',sourceSessionVerified:true,sessionTruthSource:'data/v17/market-session-truth.json',marketSource:market.source||null,sourceUrl:row.sourceUrl||null};
    history50.symbols[symbol]=mergeByDate(history50.symbols[symbol]||[],point,Number(history50.maxSessions||50));mergedVerifiedOhlc+=1;repairedSymbols.push(symbol);
  }
  history50.generatedAt=new Date().toISOString();history50.status={...(history50.status||{}),v17SessionRepair:'VERIFIED_PRICE_SOURCE_SESSION_APPLIED',verifiedSessionDate:sessionDate,impossibleWeekendOrFutureRowsRemoved:removedHistory50};history50.summary={...(history50.summary||{}),latestSessionDate:sessionDate,verifiedSessionDate:sessionDate,verifiedMarketOhlcRowsMerged:mergedVerifiedOhlc};
  history.sessionDate=sessionDate;history.generatedAt=new Date().toISOString();history.v17SessionTruth={source:'data/v17/market-session-truth.json',verifiedSessionDate:sessionDate,impossibleWeekendOrFutureRowsRemoved:removedLegacyHistory};
}
write('data/history-50.json',history50);write('data/history.json',history);
const output={schemaVersion:'17.0.0-session-history-repair-2',generatedAt:new Date().toISOString(),applied:Boolean(sessionDate),verifiedSessionDate:sessionDate,sourceSessionExecutionSafe:truth.executionSafe===true,removedHistory50WeekendOrFutureRows:removedHistory50,removedLegacyWeekendOrFutureRows:removedLegacyHistory,verifiedMarketRowsWithRealOhlcRange:verifiedMarketRowsWithRange,verifiedMarketOhlcRowsMergedIntoHistory50:mergedVerifiedOhlc,repairedSymbols:[...new Set(repairedSymbols)].sort(),policy:{noFabricatedOhlc:true,noCloseOnlyOhlcSynthesis:true,onlyVerifiedPriceSourceSessionMayBeMerged:true,allFridaySaturdayHistoryRowsRemoved:true,allHistoryRowsAfterVerifiedSourceSessionRemoved:true,immutableSignalHashUntouched:true},blockingReason:sessionDate?null:truth.blockingReason||'VERIFIED_SOURCE_SESSION_UNAVAILABLE'};
write(OUT,output);console.log(JSON.stringify({applied:output.applied,verifiedSessionDate:sessionDate,removedHistory50,removedLegacyHistory,verifiedMarketRowsWithRange,mergedVerifiedOhlc},null,2));
