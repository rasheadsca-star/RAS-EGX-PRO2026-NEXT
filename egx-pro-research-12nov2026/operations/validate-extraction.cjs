#!/usr/bin/env node
'use strict';
/** Interlocks Python PDF extraction with the central validator.
 * - Reads the immutable extraction JSON and (optionally) a versioned security master.
 * - Never publishes or mutates history.
 * - Fails closed when symbol/ISIN/tick identity cannot be verified.
 */
const fs=require('node:fs'), crypto=require('node:crypto');
const {validateSession}=require('./validator.cjs');
function buildGate(extraction, master={}, options={}) {
  if(!extraction || typeof extraction!=='object')throw Error('MISSING_EXTRACTION');
  const rows=Array.isArray(extraction.rows)?extraction.rows:[];
  const byName=new Map();
  for(const [isin,m] of Object.entries(master||{})) {
    if(!m||typeof m!=='object'||!m.name||!m.symbol||!m.tickSize)continue;
    const key=String(m.name).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    if(!byName.has(key))byName.set(key,[]);
    byName.get(key).push({isin,...m});
  }
  const unresolved=[];
  const input=rows.filter(r=>r.currency==='EGP').map(r=>{
    const key=String(r.name||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    const matches=byName.get(key)||[];
    const m=matches.length===1?matches[0]:null;
    if(!m)unresolved.push({rank:r.rank,issuer:r.name,reason:matches.length?'AMBIGUOUS_IDENTITY':'NO_VERIFIED_ISIN'});
    return {
      symbol:m?.symbol??null, isin:m?.isin??null,
      // "referencePrice" is a printed bulletin field; not a verified intraday open.
      open:r.referencePrice??null,high:r.high??null,low:r.low??null,close:r.close??null,
      volume:r.volume??null,valueTraded:r.valueTraded??null
    };
  });
  const masterReady=!!master && Object.keys(master).length>0;
  const validation=validateSession({
    session:extraction.session,
    rows:input,sourceHash:extraction.sourceSha256,
    sourcePages:extraction.sourcePages,
    master:masterReady?master:null,
    minRows:options.minRows??200,previousSession:options.previousSession??null
  });
  const errors=new Set(validation.errors);
  if(!extraction.fullTableSequence)errors.add('INCOMPLETE_SOURCE_RANK_SEQUENCE');
  if(!rows.length)errors.add('NO_SOURCE_ROWS');
  if(!extraction.publicationAllowed)errors.add('SOURCE_EXTRACTOR_NOT_CERTIFIED');
  if(unresolved.length)errors.add('UNRESOLVED_SECURITY_IDENTITIES');
  return {
    schemaVersion:'egx-ingestion-gate-v1',session:extraction.session,
    sourceHash:extraction.sourceSha256,
    rowsExtracted:rows.length,egpRows:input.length,
    verifiedRows:validation.acceptedRows,quarantinedRows:validation.quarantinedRows,
    identityUnresolvedCount:unresolved.length,
    identitySamples:unresolved.slice(0,20),
    errors:[...errors],publicationAllowed:false,certifiedPaperTrading:false,
    status:'BLOCKED_PENDING_SECURITY_MASTER_AND_FULL_VALIDATION',
    note:'Extractor is research-only; no remote write or signal publication performed.'
  };
}
function main(args=process.argv.slice(2)){
  const [source,report,masterPath]=args;
  if(!source||!report)throw Error('Usage: node validate-extraction.cjs extracted.json report.json [master.json]');
  const data=JSON.parse(fs.readFileSync(source,'utf8'));
  const master=masterPath?JSON.parse(fs.readFileSync(masterPath,'utf8')):{};
  const result=buildGate(data,master);
  fs.writeFileSync(report,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({state:result.status,session:result.session,errors:result.errors,report}));
  // A quarantine result is not a successful release.
  if(result.errors.length)process.exitCode=2;
}
if(require.main===module){
  try{main()}catch(err){console.error(JSON.stringify({state:'VALIDATION_ERROR',reason:String(err.message||err)}));process.exitCode=2;}
}
module.exports={buildGate};
