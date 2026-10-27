#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
function census(truth,archive){
 if(!Array.isArray(truth?.missingHistoryFiles)||!archive?.symbols)throw Error('EVIDENCE_MISSING');
 const rows=truth.missingHistoryFiles.map(ticker=>{
  const history=archive.symbols[ticker]||[];
  const valid=history.filter(r=>{const p=['open','high','low','close','volume'].map(k=>Number(r[k]));return /^\d{4}-\d{2}-\d{2}$/.test(r.date||'')&&p.every(Number.isFinite)&&p.slice(0,4).every(x=>x>0)&&p[4]>=0&&p[1]>=Math.max(p[0],p[3])&&p[2]<=Math.min(p[0],p[3])&&p[1]>=p[2]});
  return {ticker,rawRows:history.length,validCandidateRows:valid.length,invalidRows:history.length-valid.length,dates:valid.map(x=>x.date),
   provenance: [...new Set(history.map(x=>x.source||'UNDECLARED'))],status:'REVIEW_ONLY_NO_IDENTITY_OR_CORPORATE_ACTION_CERTIFICATION',automaticallyPromoted:false};
 });
 return {schemaVersion:'egx-archive-50-candidate-census-1',marketSession:truth.expectedSession,archiveGeneratedAt:archive.generatedAt,
  stocks:rows.length,rawRows:rows.reduce((x,r)=>x+r.rawRows,0),validCandidateRows:rows.reduce((x,r)=>x+r.validCandidateRows,0),
  executionGradeRows:0,productionPromotion:false,records:rows};
}
if(require.main===module){try{const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd()),load=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8')),result=census(load('data/stable/v15-price-truth.json'),load('data/history-50.json')),out=path.join(root,'artifacts/history-recovery');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'legacy-row-census.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({stocks:result.stocks,rawRows:result.rawRows,validCandidateRows:result.validCandidateRows,executionGradeRows:result.executionGradeRows}));}catch(e){console.error(e);process.exitCode=2}}
module.exports={census};
