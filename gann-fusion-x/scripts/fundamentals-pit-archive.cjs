#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const PIT = path.join(ROOT,'gann-fusion-x','data','fundamentals-pit');
const MANIFEST = path.join(PIT,'manifest.json');
const RAW = path.join(ROOT,'data','fundamentals','v16-fundamental-raw.json');
const ANALYSIS = path.join(ROOT,'data','stable','v16-fundamental-analysis.json');
const READINESS = path.join(ROOT,'gann-fusion-x','data','data-readiness-current-v1.json');
const MARKET = path.join(ROOT,'data','quant','market-search-index-v13-17.json');

function read(f,d=null){try{return JSON.parse(fs.readFileSync(f,'utf8'))}catch{return d}}
function write(f,v){fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,JSON.stringify(v,null,2)+'\n')}
function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value}
function hash(v){return crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex')}
const dateOnly=v=>(String(v||'').match(/^(\d{4}-\d{2}-\d{2})/)||[])[1]||null;
function analysisRows(doc){
  for(const key of ['records','marketAnalysis','allCompanies','companies']) if(Array.isArray(doc?.[key])) return doc[key];
  return Array.isArray(doc?.recommendationAnalysis)?doc.recommendationAnalysis:[];
}
function compactRaw(r){return {ticker:r.ticker,companyNameAr:r.companyNameAr||null,currency:r.currency||null,sourceAsOf:r.sourceAsOf||null,fetchedAt:r.fetchedAt||null,source:r.source||null,classification:r.classification||null,latest:r.latest||null,annual:r.annual||null,calculated:r.calculated||null,parseDiagnostics:r.parseDiagnostics||null}}
function compactAnalysis(r){if(!r)return null;return {ticker:r.ticker,currentPrice:r.currentPrice??null,financialPeriodEnd:r.financialPeriodEnd??null,statementAgeDays:r.statementAgeDays??null,score:r.score??null,grade:r.grade??null,verdict:r.verdict??null,breakdown:r.breakdown||null,dataQuality:r.dataQuality||null,peerComparison:r.peerComparison||null,relativeFairValue:r.relativeFairValue||null,redFlags:r.redFlags||[]}}
function compactDecision(x){
  const s=x?.decisionFunnel?.speculative||{}; return {ticker:x.ticker||null,score:x.score??null,dataReadiness:x.dataReadiness||null,speculative:{decision:s.decision||null,reasonCode:s.reasonCode||null,rankScore:s.rankScore??s.score??null,levels:s.levels||null,size:s.size||null}};
}
function main(){
  const market=read(MARKET,{}), raw=read(RAW,null), analysis=read(ANALYSIS,{}), readiness=read(READINESS,null);
  if(!raw||!readiness) throw new Error('PIT_SOURCE_MISSING');
  const marketSession=dateOnly(market.marketDate||market.analysisSession||readiness?.dataReadinessSummary?.decisionDate||readiness?.sessionDate);
  const decisionDate=dateOnly(readiness?.dataReadinessSummary?.decisionDate||readiness?.sessionDate);
  if(!marketSession||decisionDate!==marketSession) throw new Error(`PIT_SESSION_NOT_ALIGNED market=${marketSession} readiness=${decisionDate}`);
  if(readiness?.guardrails?.dataReadinessGate!==true) throw new Error('PIT_READINESS_GATE_NOT_ACTIVE');
  fs.mkdirSync(PIT,{recursive:true});
  const file=path.join(PIT,`${marketSession}.json`);
  const manifest=read(MANIFEST,{schemaVersion:'fundamentals-pit-manifest-v1',createdAt:new Date().toISOString(),policy:{immutablePerMarketSession:true,missingValuesRemainNull:true,overwriteForbidden:true,source:'what-was-known-at-decision-time'},snapshots:[]});
  manifest.snapshots=Array.isArray(manifest.snapshots)?manifest.snapshots:[];
  if(fs.existsSync(file)){
    const old=read(file,null); if(!old?.payload||old?.integrity?.payloadSha256!==hash(old.payload)) throw new Error(`PIT_EXISTING_SNAPSHOT_CORRUPT ${marketSession}`);
    if(!manifest.snapshots.some(x=>x.marketSession===marketSession)) throw new Error(`PIT_MANIFEST_MISSING_EXISTING_SNAPSHOT ${marketSession}`);
    console.log(JSON.stringify({status:'ALREADY_SEALED',marketSession,payloadSha256:old.integrity.payloadSha256},null,2)); return;
  }
  if(manifest.snapshots.some(x=>x.marketSession===marketSession)) throw new Error(`PIT_MANIFEST_POINTS_TO_MISSING_FILE ${marketSession}`);
  const amap=new Map(analysisRows(analysis).filter(x=>x?.ticker).map(x=>[String(x.ticker).toUpperCase(),x]));
  const records={};
  for(const [ticker,r] of Object.entries(raw.records||{}).sort(([a],[b])=>a.localeCompare(b))){const key=String(ticker).toUpperCase();records[key]={raw:compactRaw({...r,ticker:key}),analysis:compactAnalysis(amap.get(key))};}
  const payload={
    marketSession,
    sourceMetadata:{
      marketIndex:{generatedAt:market.generatedAt||null,marketDate:market.marketDate||market.analysisSession||null},
      rawFundamentals:{schemaVersion:raw.schemaVersion||null,generatedAt:raw.generatedAt||null,parserVersion:raw.parserVersion||null,provider:raw.provider||null,coverageCount:raw.coverageCount??null},
      analysis:{schemaVersion:analysis.schemaVersion||null,generatedAt:analysis.generatedAt||null,methodology:analysis.methodology||null,summary:analysis.summary||null},
      readiness:{schemaVersion:readiness.schemaVersion||null,generatedAt:readiness.generatedAt||null,summary:readiness.dataReadinessSummary||null,guardrails:readiness.guardrails||null}
    },
    records,
    decisionSnapshot:(readiness.dailyTop||[]).map(compactDecision),
  };
  const payloadSha256=hash(payload), capturedAt=new Date().toISOString();
  const snapshot={schemaVersion:'fundamentals-point-in-time-v1',capturedAt,marketSession,integrity:{algorithm:'sha256-canonical-json',payloadSha256,immutable:true},payload};
  write(file,snapshot);
  manifest.snapshots.push({marketSession,path:`gann-fusion-x/data/fundamentals-pit/${marketSession}.json`,capturedAt,payloadSha256,rawGeneratedAt:raw.generatedAt||null,analysisGeneratedAt:analysis.generatedAt||null,readinessGeneratedAt:readiness.generatedAt||null,recordCount:Object.keys(records).length});
  manifest.snapshots.sort((a,b)=>a.marketSession.localeCompare(b.marketSession)); manifest.updatedAt=capturedAt; manifest.latestMarketSession=marketSession;
  write(MANIFEST,manifest);
  console.log(JSON.stringify({status:'SEALED',marketSession,recordCount:Object.keys(records).length,payloadSha256},null,2));
}
main();
