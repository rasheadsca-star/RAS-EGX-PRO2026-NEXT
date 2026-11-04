#!/usr/bin/env node
'use strict';
/** Verifies Vercel production is serving precisely the reviewed GitHub main UI+data.
 * Read only. Never attempts to deploy using an unauthorized Vercel token.
 */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=path.resolve(__dirname,'../..');
const site=process.env.EGX_SITE_ORIGIN||'https://egx-pro-decision-room.vercel.app';
const files=['paper-v4/decision.html','paper-v4/decision-dashboard.js','paper-v4/latest-ranking.json','paper-v4/official-session-latest.json','paper-v4/official-quotes-dashboard.js','paper-v4/official-import.js'];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const contract=(filepath,bytes)=>{
 if(filepath.endsWith('official-session-latest.json')){
  const data=JSON.parse(bytes.toString('utf8'));
  if(data.session!=='2026-11-04'||data.quotes?.length<10||data.tradingApproved!==false)throw Error('Invalid official-date research quote preview');
 }else if(filepath.endsWith('official-quotes-dashboard.js')){
  const js=bytes.toString('utf8');
  if(!js.includes('egx-v4-official-import-v1')||!js.includes('official-session-latest.json'))throw Error('Missing local/cloud official quote bridge');
 }else if(filepath.endsWith('official-import.js')){
  const js=bytes.toString('utf8');
  if(!js.includes('CLOSE_ONLY_REVIEW')||!js.includes('LOCAL_RESEARCH_ONLY'))throw Error('Missing quarantined PDF import');
 }else if(filepath.endsWith('latest-ranking.json')){
  const data=JSON.parse(bytes.toString('utf8'));
  if(data.schemaVersion!=='2.4'||!data.rows?.length||data.qualifiedTradeCount!==0||!data.mode?.includes('RESEARCH'))throw Error('Unapproved or outdated research ranking schema');
 }else if(filepath.endsWith('decision-dashboard.js')){
  const text=bytes.toString('utf8');
  for(const key of ['plans.hidden=!last||mismatch||stale','loadLatestRanking','sc.target1','sc.stop']){
   if(!text.includes(key))throw Error('Dashboard fails safety contract: '+key);
  }
 }
};
const ref=Object.fromEntries(files.map(file=>{
 const bytes=fs.readFileSync(path.join(base,file));contract(file,bytes);
 return [file,{sha256:sha(bytes),size:bytes.length}];
}));
const attempts=Math.max(1,Math.min(30,Number(process.env.EGX_VERIFY_ATTEMPTS||12)));
const interval=Math.max(1,Math.min(60,Number(process.env.EGX_VERIFY_INTERVAL_SECS||20)))*1000;
async function check(){
 const result={expected:ref,site,checkedAt:new Date().toISOString(),files:{},success:false};
 for(const file of files){
  const url=site+'/'+file+'?egx_verify='+Date.now();
  try{
   const r=await fetch(url,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(25000),redirect:'follow'});
   if(!r.ok)throw Error('HTTP '+r.status);
   const bytes=Buffer.from(await r.arrayBuffer());
   contract(file,bytes);
   const expected=ref[file].sha256,actual=sha(bytes);
   result.files[file]={expectedSha256:expected,servedSha256:actual,match:expected===actual,bytes:bytes.length};
  }catch(e){result.files[file]={match:false,error:String(e.message||e)}}
 }
 result.success=Object.values(result.files).every(x=>x.match);
 return result;
}
(async()=>{
 let result;
 for(let i=1;i<=attempts;i++){
  result=await check();
  console.log(JSON.stringify({attempt:i,site,success:result.success,files:result.files}));
  if(result.success)break;
  if(i<attempts)await sleep(interval);
 }
 const output=process.env.EGX_VERIFY_OUTPUT||path.join(base,'paper-v4/production-sync-audit.json');
 fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
 if(!result.success){console.error('PRODUCTION_NOT_SYNCED: Git main and Vercel served files differ');process.exitCode=2}
 else console.log('PRODUCTION_SYNC_VERIFIED: all source files match SHA256');
})().catch(e=>{console.error(e);process.exitCode=2});
