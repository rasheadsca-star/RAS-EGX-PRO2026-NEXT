(function(global){
'use strict';
const CONTRACT=Object.freeze({module:'TECHNICAL_V2_BUNDLE_LOADER',authorityMode:'RESEARCH',scoringImpact:'NONE',recommendationMutationAllowed:false,executionAllowed:false,automaticOrders:false});
const CORE='/technical-chart-v2-core.js?v=20260901-v2-core';
const ALIGN='/technical-chart-v21-alignment.js?v=20260901-v21-align1';
const KPI='/realized-kpi.js?v=20260901-kpi1';
const BOARD='/championship-board.js?v=20260901-champ1';
function loadScript(src,id){
  if(typeof document==='undefined')return Promise.resolve(false);
  if(id&&document.getElementById(id))return Promise.resolve(true);
  return new Promise((resolve,reject)=>{const s=document.createElement('script');if(id)s.id=id;s.src=src;s.async=false;s.onload=()=>resolve(true);s.onerror=()=>reject(new Error(`SCRIPT_LOAD_FAILED:${src}`));document.head.appendChild(s)});
}
async function boot(){
  if(typeof document==='undefined')return false;
  if(!global.EGXOneTechnicalV2)await loadScript(CORE,'egxTechnicalV2Core');
  if(!global.EGXOneTechnicalV21)await loadScript(ALIGN,'egxTechnicalV21Alignment');
  if(!global.EGXOneRealizedKPI)await loadScript(KPI,'egxRealizedKpiModule');
  if(!global.EGXOneChampionshipBoard)await loadScript(BOARD,'egxChampionshipBoardModule');
  return !!(global.EGXOneTechnicalV2&&global.EGXOneTechnicalV21&&global.EGXOneRealizedKPI&&global.EGXOneChampionshipBoard);
}
global.EGXOneTechnicalV2Loader={CONTRACT,CORE,ALIGN,KPI,BOARD,loadScript,boot};
if(typeof document!=='undefined')boot().catch(e=>console.error('TECHNICAL_V2_BUNDLE_BLOCKED',e));
})(typeof window!=='undefined'?window:globalThis);
