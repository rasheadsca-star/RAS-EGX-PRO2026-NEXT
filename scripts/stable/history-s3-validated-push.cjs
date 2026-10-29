'use strict';
// Strict integration of existing evidence gate with disposable bare-remote push simulation.
// No production remote accepted; this is test infrastructure only.
const fs=require('node:fs');
const {evidenceGate}=require('./history-s3-shadow-evidence.cjs');
const {simulate}=require('./history-s3-push-simulator.cjs');
function simulateValidated({candidate,remote,evidencePath,artifact}){
 if(!evidencePath||!artifact)throw Error('S3_INTEGRATION_ARGS');
 return simulate({candidate,remote,artifact,gate:()=>{
  const evidence=JSON.parse(fs.readFileSync(evidencePath,'utf8'));
  return evidenceGate(evidence)===true;
 }});
}
module.exports={simulateValidated};
