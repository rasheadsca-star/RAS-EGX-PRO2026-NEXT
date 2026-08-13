#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.');
function read(p){try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'))}catch{return null}}
function write(p,v){const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});const t=f+'.tmp';fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n','utf8');JSON.parse(fs.readFileSync(t,'utf8'));fs.renameSync(t,f)}
function n(v){const x=Number(v);return Number.isFinite(x)?x:null}
function age(v){if(!v)return null;const t=new Date(v).getTime();return Number.isFinite(t)?Math.round((Date.now()-t)/6000)/10:null}
const health=read('data/source-health.json')||{}, fresh=read('data/price-freshness-report.json')||{}, audit=read('data/price-source-audit.json')||{}, market=read('data/market.json')||{}, cache=read('data/full-market-cache.json')||{};
const marketRows=Array.isArray(market.rows)?market.rows.length:Array.isArray(market.data)?market.data.length:0;
const cacheRows=Array.isArray(cache.rows)?cache.rows.length:0;
const availableRows=Math.max(marketRows,cacheRows);
const last=fresh.lastSourceUpdate||health.lastSuccessAt||health.generatedAt||market.updatedAt||cache.updatedAt||null;
const sourceAge=n(fresh.sourceAgeMinutes)??age(last);
const primary=process.env.MUBASHER_PRIMARY_OUTCOME||'unknown', sr=process.env.RENDERED_SR_OUTCOME||'unknown', merge=process.env.MERGE_SR_OUTCOME||'unknown';
const usable=availableRows>0, stale=sourceAge!==null&&sourceAge>2160;
let mode='NORMAL';const reasons=[];
if(primary!=='success'){mode='DEGRADED';reasons.push('MUBASHER_PRIMARY_UNAVAILABLE')}
if(sr!=='success'||merge!=='success'){if(mode==='NORMAL')mode='DEGRADED';reasons.push('SUPPORT_RESISTANCE_UNAVAILABLE_OR_UNVERIFIED')}
if(stale){mode='DEGRADED';reasons.push('SOURCE_DATA_STALE')}
if(!usable){mode='BLOCKED';reasons.push('NO_USABLE_MARKET_DATA')}
const out={schemaVersion:'17.0.0-resilient-session-gate',generatedAt:new Date().toISOString(),mode,reasons:[...new Set(reasons)],sourceState:{primary,renderedSupportResistance:sr,mergedSupportResistance:merge,availableRows,marketRows,cacheRows,lastSourceUpdate:last,sourceAgeMinutes:sourceAge,stale},confidencePolicy:{confidenceCap:mode==='NORMAL'?1:mode==='DEGRADED'?0.72:0,allowResearchRanking:usable,allowAutomaticPromotion:false,allowExecutionGradeClaim:mode==='NORMAL',requireExplicitDegradedLabel:mode!=='NORMAL'},sourceAuditSummary:audit.summary||null,invariant:'V16 champion and main branch are not modified or promoted by this V17 lab gate.'};
write('data/v17/resilient-session-status.json',out);console.log(JSON.stringify(out,null,2));if(mode==='BLOCKED')process.exitCode=2;
