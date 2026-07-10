#!/usr/bin/env node
'use strict';
const fs=require('fs'); const path=require('path'); const ROOT=process.cwd();
function fail(msg){console.error(`V13.7 ACCEPTANCE FAILURE: ${msg}`);process.exit(1);}
const indexPath=path.join(ROOT,'data/quant/stock-intelligence-index.json');
const stockPage=path.join(ROOT,'preview-v13/app/stock-analysis.html');
const portfolioPage=path.join(ROOT,'preview-v13/app/portfolio.html');
const workspace=path.join(ROOT,'preview-v13/app/index.html');
for(const p of [indexPath,stockPage,portfolioPage,workspace])if(!fs.existsSync(p))fail(`missing ${path.relative(ROOT,p)}`);
const doc=JSON.parse(fs.readFileSync(indexPath,'utf8'));
if(doc.schemaVersion!=='13.7.0')fail(`unexpected schema ${doc.schemaVersion}`);
if(doc.liveExecutionEnabled!==false)fail('live execution must remain disabled');
if(!Array.isArray(doc.stocks)||!doc.stocks.length)fail('stock index is empty');
for(const stock of doc.stocks.slice(0,10)){
  if(!stock.ticker||!Number.isFinite(Number(stock.price)))fail(`invalid stock summary ${stock.ticker}`);
  const p=path.join(ROOT,'data/quant/stocks',`${stock.ticker}.json`); if(!fs.existsSync(p))fail(`missing detail ${stock.ticker}`);
  const detail=JSON.parse(fs.readFileSync(p,'utf8'));
  if(!Array.isArray(detail.chart?.close)||detail.chart.close.length<20)fail(`insufficient chart ${stock.ticker}`);
}
const htmls=[stockPage,portfolioPage,workspace].map(p=>fs.readFileSync(p,'utf8'));
if(!htmls[0].includes('stock-intelligence-index.json'))fail('stock page not connected to index');
if(!htmls[1].includes('localStorage'))fail('portfolio is not browser-local');
if(!htmls[2].includes('stock-analysis.html')||!htmls[2].includes('portfolio.html'))fail('workspace not connected to native pages');
for(const html of htmls){if(/navigator\.serviceWorker\.register/.test(html))fail('must not replace stable service worker');}
console.log(`V13.7 acceptance passed for ${doc.stocks.length} stocks.`);
