(function(global){
'use strict';
const CONTRACT=Object.freeze({module:'TECHNICAL_V2_BUNDLE_LOADER',authorityMode:'RESEARCH',scoringImpact:'NONE',recommendationMutationAllowed:false,executionAllowed:false,automaticOrders:false});
const CORE='/technical-chart-v2-core.js?v=20260901-v2-core';
const KPI='/realized-kpi.js?v=20260901-kpi1';
function loadScript(src,id){
  if(typeof document==='undefined')return Promise.resolve(false);
  if(id&&document.getElementById(id))return Promise.resolve(true);
  return new Promise((resolve,reject)=>{const s=document.createElement('script');if(id)s.id=id;s.src=src;s.async=false;s.onload=()=>resolve(true);s.onerror=()=>reject(new Error(`SCRIPT_LOAD_FAILED:${src}`));document.head.appendChild(s)});
}
async function boot(){
  if(typeof document==='undefined')return false;
  if(!global.EGXOneTechnicalV2)await loadScript(CORE,'egxTechnicalV2Core');
  if(!global.EGXOneRealizedKPI)await loadScript(KPI,'egxRealizedKpiModule');
  return !!(global.EGXOneTechnicalV2&&global.EGXOneRealizedKPI);
}
global.EGXOneTechnicalV2Loader={CONTRACT,CORE,KPI,loadScript,boot};
if(typeof document!=='undefined')boot().catch(e=>console.error('TECHNICAL_V2_BUNDLE_BLOCKED',e));
})(typeof window!=='undefined'?window:globalThis);
