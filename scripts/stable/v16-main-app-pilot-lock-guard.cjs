#!/usr/bin/env node
'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {execFileSync}=require('child_process');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
const P=r=>path.join(ROOT,r);
const ENGINE='V16_9_EQUAL_WEIGHT_BASKET';
const OUT=P('data/stable/v16-main-app-pilot-lock-status.json');
const LOCKED={
  'scripts/research/v16-v169-basket-engine.py':'27ed1970b0624b040b7539e598599219dcc8fc7c',
  'scripts/research/v16-two-stage-predictor.py':'542d88d2a82a18db849496f085a0bf9c53889e26',
  'scripts/stable/v16-publish-v169-basket.cjs':'563b14f7e15ec14bc2537b8ad04e595b052c266f',
  'data/stable/v16-v169-release-lock.json':'4d51f4bbfbb113cf4a7a52a4e920ef069c2d43ff'
};
function read(rel,f={}){try{return JSON.parse(fs.readFileSync(P(rel),'utf8'));}catch{return f;}}
function write(v){fs.mkdirSync(path.dirname(OUT),{recursive:true});const t=`${OUT}.tmp-${process.pid}-${Date.now()}`;fs.writeFileSync(t,JSON.stringify(v,null,2)+'\n');JSON.parse(fs.readFileSync(t,'utf8'));fs.renameSync(t,OUT);}
function gitBlob(rel){return execFileSync('git',['hash-object',rel],{cwd:ROOT,encoding:'utf8'}).trim();}
const release=read('data/stable/v16-v169-release-lock.json');
const current=read('data/stable/v16-main-app-current.json');
const files=Object.entries(LOCKED).map(([file,expected])=>{let actual=null,error=null;try{actual=gitBlob(file);}catch(e){error=String(e.message||e);}return{file,expectedBlobSha:expected,actualBlobSha:actual,match:actual===expected,error};});
const semanticChecks={engineReleaseLock:release.engine===ENGINE,engineCurrent:current?.governance?.activeEngine===ENGINE,statusFrozen:release.status==='FROZEN_PILOT_EVALUATION',costFrozen:Number(release?.pilotRules?.estimatedRoundTripCostPct)===0.6,holdingFrozen:Number(release?.pilotRules?.holdingSessions)===1,allocationFrozen:Number(release?.pilotRules?.maximumPortfolioAllocationPct)===50,unfilledPolicyFrozen:release?.pilotRules?.unfilledMemberPolicy==='KEEP_CASH',minimumResolvedSessions:Number(release?.promotionGate?.minimumResolvedSessions)===20};
const pass=files.every(x=>x.match)&&Object.values(semanticChecks).every(Boolean);
const out={schemaVersion:'16.9.2-pilot-methodology-lock-v1',generatedAt:new Date().toISOString(),engine:ENGINE,status:pass?'PASS':'FAIL',pilotFrozen:true,policy:'During the live pilot, V16.9 ranking/model features, basket engine, publication rules and release methodology are immutable. Any change requires a new challenger/version and independent ledger.',lockedFiles:files,semanticChecks,allowedChanges:['data-source reliability','session evidence','UI/UX','audit snapshots','drift monitoring','shadow challenger research','non-alpha bug fixes outside locked methodology files'],forbiddenWithoutNewVersion:['ranking/model feature changes','basket selection changes','entry/stop/target changes','cost/allocation changes','production use of challenger'],changesAlphaOrRanking:false};
out.lockHash=crypto.createHash('sha256').update(JSON.stringify({files,semanticChecks})).digest('hex');write(out);console.log(JSON.stringify(out,null,2));if(!pass)process.exit(2);