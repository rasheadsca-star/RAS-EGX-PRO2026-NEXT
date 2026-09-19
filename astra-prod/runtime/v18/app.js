'use strict';
(() => {
  const PIPELINE_RESOURCE_ID='G11_CURRENT_PIPELINE_RUN.json';
  const el=id=>document.getElementById(id);
  async function boot(){
    try{
      const resources=globalThis.AstraRuntimeResources;
      if(!resources||typeof resources.load!=='function')throw new Error('V18_RESOURCE_CLIENT_UNAVAILABLE');
      const {pipeline:p,metrics:m,issues:i,guard:g,sourceIds}=await resources.load();
      if(!String(sourceIds?.pipeline||'').endsWith(PIPELINE_RESOURCE_ID))throw new Error('V18_PIPELINE_RESOURCE_CONTRACT_MISMATCH');
      if(p.productionCutover!==false||p.legacyNetworkCalls!==0)throw new Error('unsafe runtime snapshot');
      if(i.criticalUnresolved!==0||i.highProductionRelevantUnresolved!==0)throw new Error('material G11 blocker present');
      if(g.status!=='PASS')throw new Error('Guard 37 not PASS');
      el('status').textContent=p.status;
      el('status').className='ok';
      el('session').textContent=p.session;
      el('opportunities').textContent=String(p.opportunities);
      el('decisionReady').textContent=`${p.decisionReadyUniverse}/${p.activeUniverse}`;
      el('active').textContent=String(p.activeUniverse);
      el('current').textContent=`${p.currentValidCanonicalUniverse}/${p.activeUniverse}`;
      el('critical').textContent=String(i.criticalUnresolved);
      el('high').textContent=String(i.highProductionRelevantUnresolved);
      el('snapshotId').textContent=p.decisionSnapshotId;
      el('snapshotHash').textContent=p.semanticDecisionHash;
      el('guard').textContent=`${g.status} · ${g.selfTests.passed}/${g.selfTests.total}`;
      el('guard').className='ok';
      el('footer').textContent=`G11 ${m.sessionFreshnessStatus} · Decision pipeline ${m.decisionPipeline.status} · G12 replacement candidate only · no cutover`;
    }catch(error){
      el('status').textContent='FAIL-CLOSED';
      el('footer').textContent=String(error?.message||error);
      console.error('ASTRA_LOCAL_V18_BOOT_FAILED',error);
    }
  }
  boot();
})();
