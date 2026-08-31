#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from '../src/hash.js';
import { importLegacyHistoryFile,verifyResearchHistoryDataset } from '../src/research-history-import.js';

const inputDir=path.resolve(process.argv[2]||process.env.LEGACY_HISTORY_DIR||'/tmp/egx-legacy-history');
const outputRoot=path.resolve(process.argv[3]||process.env.RESEARCH_HISTORY_OUTPUT||'data/research');
const historyOut=path.join(outputRoot,'history');
const legacyCommit=String(process.env.LEGACY_HISTORY_COMMIT||'').trim();
const migrationRunAt=process.env.LEGACY_IMPORT_AT||null;

if(!/^[0-9a-f]{40}$/i.test(legacyCommit)) throw new Error('LEGACY_HISTORY_COMMIT must be an exact 40-char commit SHA');
if(!fs.existsSync(inputDir)) throw new Error(`Legacy history directory does not exist: ${inputDir}`);

fs.rmSync(historyOut,{recursive:true,force:true});
fs.mkdirSync(historyOut,{recursive:true});
fs.mkdirSync(outputRoot,{recursive:true});

const files=fs.readdirSync(inputDir).filter(x=>x.toLowerCase().endsWith('.json')).sort();
const records=[];const errors=[];
let totalSessions=0,readyResearchSessions=0,quarantinedResearchSessions=0;

for(const file of files){
  const full=path.join(inputDir,file);const raw=fs.readFileSync(full);let legacy;
  try{legacy=JSON.parse(raw.toString('utf8'))}catch(error){errors.push({file,error:`JSON_PARSE_FAILED:${error.message}`});continue}
  const sourcePath=`data/history/${file}`;
  const result=importLegacyHistoryFile(legacy,{legacyCommit,sourcePath,sourceFileHash:sha256(raw),importedAt:migrationRunAt??legacy?.generatedAt??null});
  if(result.state!=='IMPORTED_RESEARCH'||!result.dataset){errors.push({file,state:result.state,reasons:result.reasons});continue}
  const verification=verifyResearchHistoryDataset(result.dataset);
  if(verification.state!=='READY'){errors.push({file,state:'VERIFY_FAILED',reasons:verification.reasons});continue}
  const dataset=result.dataset;
  const outFile=path.join(historyOut,`${dataset.ticker}.json`);
  fs.writeFileSync(outFile,`${JSON.stringify(dataset,null,2)}\n`,'utf8');
  const ready=dataset.metadata.readyResearchSessions,quarantined=dataset.metadata.quarantinedResearchSessions;
  totalSessions+=dataset.metadata.availableSessions;readyResearchSessions+=ready;quarantinedResearchSessions+=quarantined;
  records.push({ticker:dataset.ticker,file:`history/${dataset.ticker}.json`,datasetHash:dataset.datasetHash,availableSessions:dataset.metadata.availableSessions,readyResearchSessions:ready,quarantinedResearchSessions:quarantined,firstSession:dataset.metadata.firstSession,lastSession:dataset.metadata.lastSession,legacyHistoryStatus:dataset.metadata.legacyHistoryStatus,warnings:dataset.metadata.warnings});
}

records.sort((a,b)=>a.ticker.localeCompare(b.ticker));
const stableIndex={schemaVersion:'egx-one-research-history-index-1',authorityMode:'RESEARCH',researchOnly:true,productionAuthority:false,source:{sourceId:'LEGACY_IMPORT',legacyCommit:legacyCommit.toLowerCase(),sourceDirectory:'data/history'},counts:{sourceFiles:files.length,importedTickers:records.length,failedFiles:errors.length,totalSessions,readyResearchSessions,quarantinedResearchSessions},records};
const index={...stableIndex,indexHash:sha256(stableIndex),migrationRunAt};
fs.writeFileSync(path.join(outputRoot,'history-index.json'),`${JSON.stringify(index,null,2)}\n`,'utf8');
fs.writeFileSync(path.join(outputRoot,'migration-errors.json'),`${JSON.stringify({schemaVersion:'egx-one-research-history-migration-errors-1',legacyCommit:legacyCommit.toLowerCase(),errors},null,2)}\n`,'utf8');

console.log(JSON.stringify({state:errors.length?'IMPORTED_WITH_QUARANTINE':'IMPORTED',...index.counts,indexHash:index.indexHash,outputRoot},null,2));
if(!records.length) process.exitCode=2;
