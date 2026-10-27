#!/usr/bin/env node
'use strict';
// Fail-closed assessment of existing research-stage provider probes.
// A reachable web page is never proof of OHLCV availability or security identity.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
function audit(dir){
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
 if(manifest.productionPromotion!==false||manifest.readOnly!==true)throw Error('UNSAFE_PROMOTION_CLAIM');
 const seen=new Set(),records=[];
 for(const batch of manifest.batches||[]){
  const file=path.resolve(root,batch.evidenceFile);
  if(!file.startsWith(path.resolve(dir)+path.sep))throw Error('EVIDENCE_PATH_OUTSIDE_STAGING');
  const data=JSON.parse(fs.readFileSync(file,'utf8'));
  if(data.expectedSession!==manifest.session)throw Error('SESSION_MISMATCH');
  for(const record of data.records||[]){
   if(seen.has(record.ticker))throw Error('DUPLICATE_TICKER');
   seen.add(record.ticker);
   const yahoo=(record.providers||[]).find(p=>p.id==='YAHOO_CHART');
   const mubasher=(record.providers||[]).find(p=>p.id==='MUBASHER_EGX_PAGE');
   const official=(record.providers||[]).find(p=>p.id==='EGX_OFFICIAL_PUBLIC_PAGE');
   records.push({ticker:record.ticker,yahooStatus:yahoo?.status||'UNREPORTED',
    yahooStagedRows:Number(yahoo?.rows||0),mubasherPageAccessible:mubasher?.ok===true,
    egxPageAccessible:official?.ok===true,identityVerified:false,
    historicalBarsApproved:0,recoveryStatus:'UNRESOLVED_REQUIRES_VERIFIED_OHLCV',
    executionEligible:false});
  }
 }
 if(manifest.requested!==seen.size)throw Error('INCOMPLETE_SYMBOL_COVERAGE');
 const summary={schemaVersion:'egx-targeted-source-evidence-assessment-1',session:manifest.session,
 checked:seen.size,yahooUnresolved:records.filter(x=>x.yahooStatus==='UNRESOLVED').length,
 yahooStagedRows:records.reduce((n,x)=>n+x.yahooStagedRows,0),
 mubasherAccessible:records.filter(x=>x.mubasherPageAccessible).length,
 egxPageAccessible:records.filter(x=>x.egxPageAccessible).length,
 approvedRecoveredSymbols:0,productionPromotion:false,
 decision:'RESEARCH_COMPLETED_RECOVERY_NOT_CERTIFIED',records};
 return summary;
}
if(require.main===module){
 try{
 const dir=path.join(root,'artifacts/history-recovery/targeted-21');
 const result=audit(dir);
 fs.writeFileSync(path.join(dir,'assessment.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({checked:result.checked,yahooUnresolved:result.yahooUnresolved,yahooStagedRows:result.yahooStagedRows,
  mubasherAccessible:result.mubasherAccessible,egxPageAccessible:result.egxPageAccessible,
  approvedRecoveredSymbols:result.approvedRecoveredSymbols,decision:result.decision}));
 }catch(e){console.error(e);process.exitCode=2}
}
module.exports={audit};
