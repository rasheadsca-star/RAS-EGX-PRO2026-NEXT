'use strict';
// Read-only live gap inventory. A missing ticker file is never backfilled from
// today's accepted price: no historical sessions can be inferred.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sum=x=>crypto.createHash('sha256').update(x).digest('hex');
function audit({root,reportPath=path.join(root,'data/stable/v15-price-truth.json'),minimumRows=200}){
 const bytes=fs.readFileSync(reportPath);
 const report=JSON.parse(bytes);
 const accepted=report.acceptedRows,rejected=report.rejectedRows,dropped=report.droppedRows,input=report.source?.inputRows;
 if(![accepted,rejected,dropped,input].every(Number.isInteger)||accepted+rejected+dropped!==input)
  throw new Error('COVERAGE_ROW_CONSERVATION_FAILED');
 const missing=report.missingHistoryFiles;
 if(!Array.isArray(missing)||missing.some(t=>typeof t!=='string'||!/^[A-Z0-9._-]+$/.test(t)||t==='.'||t==='..')||new Set(missing).size!==missing.length)
  throw new Error('COVERAGE_INVALID_MISSING_LIST');
 if(report.updatedHistoryFiles+missing.length!==accepted)throw new Error('COVERAGE_WRITTEN_MISSING_MISMATCH');
 const historyDir=path.join(root,'data/history');
 const files=fs.readdirSync(historyDir).filter(f=>f.endsWith('.json'));
 const existing=new Set(files.map(f=>f.slice(0,-5)));
 const unexpectedlyPresent=missing.filter(t=>existing.has(t));
 const gaps=missing.map(t=>({ticker:t,historyFile:'ABSENT',status:'REQUIRES_AUTHENTIC_HISTORY_SOURCE'}));
 const malformed=[];
 for(const file of files){
  try{
   const doc=JSON.parse(fs.readFileSync(path.join(historyDir,file),'utf8'));
   if(!Array.isArray(doc.sessions))malformed.push(file);
  }catch{malformed.push(file);}
 }
 const executionReady=accepted>=minimumRows&&report.updatedHistoryFiles>=minimumRows&&gaps.length===0&&
    unexpectedlyPresent.length===0&&malformed.length===0;
 return {schemaVersion:1,sourceReportSha256:sum(bytes),expectedSession:report.expectedSession,
  minimumRows,inputRows:input,acceptedRows:accepted,rejectedRows:rejected,droppedRows:dropped,
  updatedHistoryFiles:report.updatedHistoryFiles,missingHistoryCount:gaps.length,gaps,
  unexpectedlyPresent,malformedHistoryFiles:malformed.sort(),
  acceptedDeficit:Math.max(0,minimumRows-accepted),writtenDeficit:Math.max(0,minimumRows-report.updatedHistoryFiles),
  executionReady,remediation:'LOCATE_VERIFIED_HISTORICAL_SERIES; DO_NOT_SYNTHESIZE_BACKFILL'};
}
if(require.main===module){
 try{const result=audit({root:process.cwd()});console.log(JSON.stringify(result,null,2));if(!result.executionReady)process.exitCode=2;}
 catch(e){console.error('COVERAGE_AUDIT_FAILED:'+e.message);process.exitCode=1;}
}
module.exports={audit};
