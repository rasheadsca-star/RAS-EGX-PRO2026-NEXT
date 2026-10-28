#!/usr/bin/env node
'use strict';
// Diagnostic-only independent dated source. Never writes canonical data or recommendations.
const fs=require('node:fs'),path=require('node:path');
const symbols=(process.env.EGX_DIAGNOSTIC_SYMBOLS||'COMI,OCDI,EFID,ISMQ,TMGH').split(',').map(x=>x.trim().toUpperCase()).filter(x=>/^[A-Z0-9]{2,8}$/.test(x));
const expected=process.env.EGX_EXPECTED_SESSION||'';
const format=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'});
function dateFromLabel(label){
  const d=new Date(label.trim()+' 12:00:00 GMT');
  return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);
}
function parse(html,ticker){
  const table=html.match(/<table\b[^>]*>[\s\S]*?<\/table>/i);
  if(!table)return {ticker,status:'NO_HISTORY_TABLE'};
  const rows=[...table[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const parsed=[];
  for(const tr of rows){
    const cells=[...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map(x=>x[1].replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim());
    if(cells.length<8)continue;
    const session=dateFromLabel(cells[0]);
    if(!session)continue;
    const nums=[1,2,3,4,7].map(i=>Number(cells[i].replace(/,/g,'')));
    if(nums.some(v=>!Number.isFinite(v)))continue;
    const [open,high,low,close,volume]=nums;
    const structuralValid=open>0&&close>0&&high>=Math.max(open,close)&&low<=Math.min(open,close)&&low>0&&volume>=0;
    parsed.push({date:session,open,high,low,close,volume,structuralValid});
  }
  const entry=parsed.find(x=>x.date===expected);
  return {ticker,status:!entry?'SESSION_MISSING':entry.structuralValid?'DATED_OHLCV_CANDIDATE':'INVALID_OHLCV',row:entry||null,observedRows:parsed.length,
    source:'https://stockanalysis.com/quote/egx/'+ticker+'/history/'};
}
async function main(){
  const out=[];
  for(const ticker of [...new Set(symbols)]){
    try{
      const url='https://stockanalysis.com/quote/egx/'+ticker+'/history/';
      const ctrl=new AbortController();const timeout=setTimeout(()=>ctrl.abort(),12000);
      let response;
      try {response=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 EGXPRO research diagnostic','accept':'text/html'},signal:ctrl.signal});}
      finally{clearTimeout(timeout);}
      out.push(response.ok?parse(await response.text(),ticker):{ticker,status:'HTTP_'+response.status});
    }catch(e){out.push({ticker,status:'FETCH_ERROR',error:String(e.message).slice(0,160)})}
  }
  const report={schema:'egx-dated-source-diagnostic-v1',generatedAt:new Date().toISOString(),expectedSession:expected,
    publicationAllowed:false,source:'Stock Analysis / S&P attributed public display; permission for systematic ingestion NOT established',
    disclaimer:'Diagnostic only; not eligible for automated live publication or trading',
    counts:Object.fromEntries([...new Set(out.map(x=>x.status))].map(x=>[x,out.filter(r=>r.status===x).length])),results:out};
  const output=path.resolve('data/research/dated-source-diagnostic.json');fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({expectedSession:expected,counts:report.counts,publicationAllowed:false}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
