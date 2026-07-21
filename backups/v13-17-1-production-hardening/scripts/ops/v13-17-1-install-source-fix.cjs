'use strict';

const fs = require('fs');
const path = require('path');

const TARGET = path.resolve('scripts/fetch-market-data.js');
const MARKER = 'V13_17_1_QUOTE_WINDOW_PATCH';

function fail(message) {
  console.error(`V13.17.1 SOURCE PATCH FAILURE: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(TARGET)) fail(`missing ${TARGET}`);
let source = fs.readFileSync(TARGET, 'utf8');

if (source.includes(MARKER)) {
  console.log('V13.17.1 source parser patch already installed.');
  process.exit(0);
}

const oldGetAfter = 'const getAfter=(label)=>{const mm=plain.match(new RegExp(label+"\\\\s+([0-9][0-9,.]*\\\\.?[0-9]*)","i"));return mm?num(mm[1]):null};';
const oldRow = 'const row=normalizeRow({symbol,name:m?m[1]:"",price,change:m?m[4]:null,changePct:m?m[5]:null,open:getAfter("Open"),previousClose:getAfter("Previous Close"),high:getAfter("High"),low:getAfter("Low"),volume:getAfter("Volume"),valueTraded:getAfter("Turnover"),updatedAt:RUN_AT},"mubasher_symbol_pages",url);';

if (!source.includes(oldGetAfter) || !source.includes(oldRow)) {
  fail('expected legacy global-label parser was not found; refusing an unsafe blind edit');
}

const newBlock = `/* ${MARKER}: metrics are parsed only from the quote window after Last update. */
const lastUpdateAt=plain.search(/Last update:/i);
const quoteWindow=lastUpdateAt>=0?plain.slice(lastUpdateAt,Math.min(plain.length,lastUpdateAt+6000)):plain.slice(0,6000);
const escapeLabel=(value)=>String(value).replace(/[.*+?^\${}()|[\\]\\\\]/g,'\\\\$&');
const getMetric=(labels)=>{for(const label of labels){const re=new RegExp('(?:^|\\\\s)'+escapeLabel(label)+'\\\\s*(?:[:\\\\-–—])?\\\\s*([0-9][0-9,.]*\\\\.?[0-9]*)','i');const mm=quoteWindow.match(re);if(mm){const value=num(mm[1]);if(Number.isFinite(value))return value}}return null};
let parsedOpen=getMetric(['Open','Opening Price','الافتتاح','سعر الفتح']);
let parsedPreviousClose=getMetric(['Previous Close','Prev. Close','الإغلاق السابق']);
let parsedHigh=getMetric(['High','Day High','الأعلى']);
let parsedLow=getMetric(['Low','Day Low','الأدنى']);
const parsedVolume=getMetric(['Volume','Traded Volume','الحجم','كمية التداول']);
const parsedTurnover=getMetric(['Turnover','Value Traded','القيمة','قيمة التداول']);
const eps=Math.max(Math.abs(price)*1e-6,1e-9);
const completeOhlc=[parsedOpen,parsedHigh,parsedLow].every(v=>Number.isFinite(v)&&v>0);
const ohlcValid=completeOhlc&&parsedHigh+eps>=Math.max(price,parsedOpen,parsedLow)&&parsedLow-eps<=Math.min(price,parsedOpen,parsedHigh);
let parserWarning=null;
if(!ohlcValid){parsedOpen=null;parsedHigh=null;parsedLow=null;parserWarning=completeOhlc?'invalid_ohlc_removed':'incomplete_ohlc'}
if(Number.isFinite(parsedPreviousClose)&&parsedPreviousClose>0){const ratio=parsedPreviousClose/price;if(ratio<0.2||ratio>5){parsedPreviousClose=null;parserWarning=parserWarning||'implausible_previous_close_removed'}}
const row=normalizeRow({symbol,name:m?m[1]:"",price,change:m?m[4]:null,changePct:m?m[5]:null,open:parsedOpen,previousClose:parsedPreviousClose,high:parsedHigh,low:parsedLow,volume:parsedVolume,valueTraded:parsedTurnover,updatedAt:RUN_AT,sourceMarketTime:m?m[2]:null,quoteParserVersion:'v13.17.1_anchored_after_last_update',ohlcParserWarning:parserWarning},"mubasher_symbol_pages",url);`;

source = source.replace(oldGetAfter, '');
source = source.replace(oldRow, () => newBlock);
source = source.replace(/EGX Pro Hub V9\.8\.6/g, 'EGX Pro Hub V9.8.8');

fs.writeFileSync(TARGET, source, 'utf8');
console.log('V13.17.1 permanent source parser patch installed.');
