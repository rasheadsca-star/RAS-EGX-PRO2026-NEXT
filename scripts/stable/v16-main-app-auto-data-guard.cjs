#!/usr/bin/env node
'use strict';
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const ROOT=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());const P=r=>path.join(ROOT,r);const OUT=P('data/stable/v16-main-app-auto-data-guard.json');
const wf=fs.readFileSync(P('.github/workflows/v16-daily-recommendation-scan.yml'),'utf8');
const fetchPos=wf.indexOf('node scripts/fetch-market-data.js');
const truthPos=wf.indexOf('node scripts/stable/v15-live-price-truth.cjs');
const enginePos=wf.indexOf('python scripts/research/v16-v169-basket-engine.py');
const checks={scheduledMorning:/(10:15 Cairo|15 7,8 \* \* 0-4)/.test(wf),scheduled1415:/(14:15 Cairo|15 11,12 \* \* 0-4)/.test(wf),scheduledPostClose:/Post-close hourly/.test(wf),fetchMarketData:fetchPos>=0,sessionQuorum:wf.includes('v16-source-session-quorum.cjs'),priceTruth:truthPos>=0,executionGradeRequired:wf.includes('p.executionGrade === true'),minimumRowsRequired:wf.includes('Number(p.acceptedRows || 0) >= minimum'),sourceCoverageRequired:wf.includes('sourceSessionEvidenceCoveragePct')&&wf.includes('>= 80'),fetchBeforeTruth:fetchPos>=0&&truthPos>fetchPos,truthBeforeEngine:truthPos>=0&&enginePos>truthPos,noEngineSubstitution:wf.includes('noEngineSubstitution:true')||wf.includes('Do not substitute')};
const pass=Object.values(checks).every(Boolean);const out={schemaVersion:'16.9.2-auto-data-update-guard-v1',generatedAt:new Date().toISOString(),status:pass?'PASS':'FAIL',checks,policy:{automaticMarketRefreshRequired:true,sourceSessionEvidenceRequired:true,executionGradeRequiredBeforeEngine:true,failClosedWhenUnavailable:true,changesAlphaOrRanking:false},workflow:'.github/workflows/v16-daily-recommendation-scan.yml'};out.guardHash=crypto.createHash('sha256').update(JSON.stringify({checks,policy:out.policy})).digest('hex');fs.mkdirSync(path.dirname(OUT),{recursive:true});fs.writeFileSync(OUT,JSON.stringify(out,null,2)+'\n');console.log(JSON.stringify(out,null,2));if(!pass)process.exit(2);
