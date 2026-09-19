#!/usr/bin/env node
'use strict';

const path=require('path');
const {materializeMirror}=require('../../astra/runtime/bridges/sepa-local.cjs');
const {exists,readJson,writeJsonAtomic}=require('../../astra/runtime/io/json-resource-store.cjs');

const OUT=path.resolve(__dirname,'../data/sepa-x-snapshot.json');
const DEFAULT_INPUT=path.resolve(__dirname,'../data/sepa-local-input.json');

function disconnected(reason,generatedAt=new Date().toISOString()){
  return{
    schemaVersion:'gann-fusion-x-sepa-local-v2',
    generatedAt,
    sessionDate:null,
    meta:{
      source:'ASTRA_INTERNAL_SEPA_QVUA',
      mode:'INTERNAL_LOCAL_DISCONNECTED',
      strategyId:'SEPA_QVUA_NEAR_FIRST_THEN_FORMING',
      sourceCommit:'bf63dc85f515e58a7be1c6de6633eed87228a021',
      selectionPolicy:'NEAR_FIRST_THEN_FORMING',
      reason
    },
    rows:[],
    views:{near:[],forming:[],extended:[],top:[]},
    verified:{records:[]}
  };
}
function buildLocalSnapshot(inputFile=process.env.SEPA_LOCAL_INPUT||DEFAULT_INPUT,generatedAt=new Date().toISOString()){
  if(!exists(inputFile))return disconnected('SEPA_LOCAL_INPUT_MISSING',generatedAt);
  const input=readJson(inputFile);
  if(!input||typeof input!=='object')return disconnected('SEPA_LOCAL_INPUT_INVALID',generatedAt);
  const snapshot=input.snapshot||{
    snapshotId:input.snapshotId||`SEPA-LOCAL-${input.sessionDate||'UNKNOWN'}`,
    ticker:'__MARKET__',
    sessionDate:input.sessionDate||null,
    validationStatus:'VALID',
    migrationValidationStatus:'VALID'
  };
  const history=Array.isArray(input.history)?input.history:[];
  const candidates=Array.isArray(input.candidates)?input.candidates:[];
  if(!snapshot.sessionDate||history.length<253||!candidates.length)return disconnected('SEPA_LOCAL_INPUT_INCOMPLETE',generatedAt);
  return materializeMirror({snapshot,history,candidates,regimeContext:input.regimeContext||null,generatedAt});
}
function main(){
  const result=buildLocalSnapshot();
  writeJsonAtomic(OUT,result);
  console.log(JSON.stringify({ok:true,mode:result.meta.mode,sessionDate:result.sessionDate,rows:result.rows.length,output:path.relative(process.cwd(),OUT)},null,2));
  return result;
}
if(require.main===module){try{main()}catch(error){console.error(error.stack||error);process.exit(1)}}
module.exports={buildLocalSnapshot,disconnected,main};
