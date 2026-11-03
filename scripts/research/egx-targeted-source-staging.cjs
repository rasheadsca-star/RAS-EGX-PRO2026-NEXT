#!/usr/bin/env node
'use strict';
// Auditable queue runner. Sources are staged only; no canonical writes or eligibility changes.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const doc=JSON.parse(fs.readFileSync(path.join(root,'data/stable/v15-price-truth.json'),'utf8'));
if(!/^\d{4}-\d{2}-\d{2}$/.test(doc.expectedSession||''))throw Error('missing pinned exchange session');
const list=doc.missingHistoryFiles;
if(!Array.isArray(list)||!list.length)throw Error('no explicit missing symbol queue');
const symbols=list.map(s=>String(s||'').toUpperCase());
if(symbols.some(s=>!/^[A-Z0-9._-]{2,15}$/.test(s))||new Set(symbols).size!==symbols.length)throw Error('invalid or duplicate ticker');
const base=path.join(root,'artifacts/history-recovery/targeted-21'), batches=[];
for(let i=0;i<symbols.length;i+=6){
 const tickers=symbols.slice(i,i+6),out=path.join(base,'batch-'+String(i/6+1).padStart(2,'0'));
 fs.mkdirSync(out,{recursive:true});
 const p=cp.spawnSync(process.execPath,[path.join(root,'scripts/research/egx-independent-source-probes.cjs')],{
  cwd:root,encoding:'utf8',timeout:240000,env:{...process.env,EGX_RECOVERY_SYMBOLS:tickers.join(','),EGX_RECOVERY_OUT:out}});
 batches.push({tickers,exitStatus:p.status,signal:p.signal||null,error:p.error?.message||null,evidenceFile:path.relative(root,path.join(out,'source-probes.json'))});
 if(p.status!==0){console.error(p.stderr||p.stdout);break}
}
const report={schemaVersion:'egx-targeted-gap-source-staging-1',session:doc.expectedSession,requested:symbols.length,batched: batches.flatMap(b=>b.tickers).length,batches,readOnly:true,productionPromotion:false,generatedAt:new Date().toISOString()};
fs.mkdirSync(base,{recursive:true});fs.writeFileSync(path.join(base,'manifest.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(batches.flatMap(b=>b.tickers).length!==symbols.length||batches.some(b=>b.exitStatus!==0))process.exitCode=2;
