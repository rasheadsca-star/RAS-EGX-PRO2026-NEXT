'use strict';
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const {POLICY,detect}=require('./trend-divergence.cjs');
const status=JSON.parse(fs.readFileSync('data/fetch-status.json','utf8'));
const session=status.expectedSession;
if(!/^\d{4}-\d{2}-\d{2}$/.test(session||''))throw Error('Canonical expected session missing');
const rows=[];
for(const f of fs.readdirSync('data/history').filter(f=>f.endsWith('.json'))) {
  const d=JSON.parse(fs.readFileSync(path.join('data/history',f),'utf8'));
  if(d.ticker&&Array.isArray(d.sessions))rows.push(detect(d,session));
}
const summary=Object.fromEntries(['SIGNAL','WATCH','NO_SIGNAL','BLOCKED'].map(k=>[k,rows.filter(x=>x.status===k).length]));
const result={schemaVersion:'egx-trend-divergence/v1',session,generatedAt:new Date().toISOString(),
  sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
  mode:'RESEARCH_ONLY',executionAllowed:false,priceBasis:'UNADJUSTED_CLOSE',policy:POLICY,summary,rows};
fs.mkdirSync('data/research',{recursive:true});
fs.writeFileSync('data/research/trend-divergence.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({session,summary}));
