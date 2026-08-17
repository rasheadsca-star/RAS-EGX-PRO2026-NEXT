#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const P=r=>path.join(ROOT,r);
const ENGINE='V16_9_EQUAL_WEIGHT_BASKET';
const OUT=P('data/stable/v16-main-app-challenger-shadow.json');
const LEDGER=P('data/stable/v16-main-app-challenger-ledger.json');
function read(rel,f={}){try{return JSON.parse(fs.readFileSync(P(rel),'utf8'));}catch{return f;}}
function readPath(file,f={}){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return f;}}
function write(file,v){fs.mkdirSync(path.dirname(file),{recursive:true});const t=`${file}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n');JSON.parse(fs.readFileSync(t,'utf8'));fs.renameSync(t,file);}
function n(v,d=null){const x=Number(v);return Number.isFinite(x)?x:d;}
function clamp(v,min=0,max=100){return Math.max(min,Math.min(max,v));}
function round(v,d=1){if(!Number.isFinite(Number(v)))return null;const f=10**d;return Math.round(Number(v)*f)/f;}
function sha(v){return crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');}
const current=read('data/stable/v16-main-app-current.json');
const primary=read('data/stable/v16-v169-primary-decision.json');
const intel=read('data/stable/v16-main-app-intelligence-snapshot.json');
if(current?.governance?.activeEngine!==ENGINE)throw new Error('MAIN APP engine mismatch');
if(intel.engine!==ENGINE)throw new Error('Intelligence snapshot engine mismatch');
if((primary.sessionDate||current.sessionDate)!==intel.sessionDate)throw new Error('Intelligence snapshot session mismatch');
const intelByTicker=new Map((intel.recommendations||[]).map(r=>[String(r.ticker||'').toUpperCase(),r]));
function scoreRow(base){
  const ticker=String(base.ticker||'').toUpperCase();
  const i=intelByTicker.get(ticker)||{}; const t=i?.intelligence?.technical||{}; const f=i?.intelligence?.financial||{}; const news=i?.intelligence?.news||{}; const c=i?.consensus||{};
  let weighted=0,available=0; const parts=[];
  if(t.status==='SUCCESS'){
    const trend=clamp(50+n(t.trendScore,0)*12.5); const rsiVal=n(t.rsi14); const rsiScore=rsiVal===null?50:(rsiVal>=50&&rsiVal<=72?75:rsiVal>80?25:rsiVal<40?30:55); const price=n(t.price),ema20=n(t.ema20); const structure=price!==null&&ema20!==null?(price>=ema20?75:30):50; const s=trend*.5+rsiScore*.25+structure*.25; weighted+=s*40;available+=40;parts.push({id:'TECHNICAL',available:true,weight:40,score:round(s,1)});
  } else parts.push({id:'TECHNICAL',available:false,weight:40,score:null});
  if(f.status==='SUCCESS'){
    const raw=n(f?.score?.score,0); const s=clamp(50+raw*20); weighted+=s*20;available+=20;parts.push({id:'FUNDAMENTAL',available:true,weight:20,score:round(s,1)});
  } else parts.push({id:'FUNDAMENTAL',available:false,weight:20,score:null});
  if(news.status==='SUCCESS'){
    const raw=n(news?.summary?.score,0); const s=clamp(50+raw*12.5); weighted+=s*15;available+=15;parts.push({id:'NEWS',available:true,weight:15,score:round(s,1),newsItems:(news.items||[]).length});
  } else parts.push({id:'NEWS',available:false,weight:15,score:null});
  const aligned=(c.engineComparisons||[]).filter(x=>x.sessionAligned===true&&!x.blocked&&x.selected!==null);
  if(aligned.length){const agree=aligned.filter(x=>x.selected===true).length;const s=agree/aligned.length*100;weighted+=s*25;available+=25;parts.push({id:'INDEPENDENT_CONSENSUS',available:true,weight:25,score:round(s,1),alignedEngines:aligned.length,agreementCount:agree});}
  else parts.push({id:'INDEPENDENT_CONSENSUS',available:false,weight:25,score:null,alignedEngines:0});
  const coverage=available; const normalized=available>0?weighted/available:null;
  let label='INSUFFICIENT_EVIDENCE'; if(coverage>=40&&normalized!==null) label=normalized>=70?'SUPPORT':normalized<45?'CAUTION':'NEUTRAL';
  return{ticker,mainAppRank:base.rank??null,shadowConfirmationScore:round(normalized,1),evidenceCoveragePct:coverage,shadowLabel:label,components:parts,productionEffect:'NONE'};
}
const baseline=Array.isArray(primary.recommendations)?primary.recommendations:(current.recommendations||[]);
const rows=baseline.map(scoreRow);
const out={schemaVersion:'16.9.2-confirmation-challenger-shadow-v1',generatedAt:new Date().toISOString(),engine:ENGINE,sessionDate:primary.sessionDate||current.sessionDate||null,mode:'SHADOW_RESEARCH_ONLY',baselinePolicy:'MAIN APP V16.9 remains the production champion unchanged.',immutableMethodology:{changesMainAppRanking:false,changesAlpha:false,changesEntryStopTargetAllocation:false,changesExecutionGrant:false,mayPromoteToProduction:false},researchQuestion:'Does independent technical/fundamental/news/consensus confirmation improve forward outcomes versus the frozen V16.9 baseline without using future information?',rows,evaluationPlan:{primaryMetrics:['averageNetReturnPct','profitFactor','winningSessionPct','maximumDrawdownPct','coveragePct'],promotionRule:'No production use until a separate out-of-sample/live comparison demonstrates material improvement with acceptable coverage and no methodology leakage.',minimumLiveComparativeSessions:20,noRetroactiveLookahead:true}};
out.shadowHash=sha({engine:out.engine,sessionDate:out.sessionDate,rows:out.rows,immutableMethodology:out.immutableMethodology});
write(OUT,out);
const ledger=readPath(LEDGER,{schemaVersion:'16.9.2-confirmation-challenger-ledger-v1',engine:ENGINE,sessions:[]});if(!Array.isArray(ledger.sessions))ledger.sessions=[];if(!ledger.sessions.some(s=>s.sessionDate===out.sessionDate))ledger.sessions.push({sessionDate:out.sessionDate,firstCapturedAt:out.generatedAt,shadowHash:out.shadowHash,rows:out.rows});ledger.updatedAt=new Date().toISOString();write(LEDGER,ledger);
console.log(JSON.stringify({output:path.relative(ROOT,OUT),sessionDate:out.sessionDate,rows:rows.map(r=>({ticker:r.ticker,score:r.shadowConfirmationScore,coverage:r.evidenceCoveragePct,label:r.shadowLabel})),changesMainAppRanking:false,changesExecutionGrant:false},null,2));