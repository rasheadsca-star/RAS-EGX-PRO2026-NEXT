'use strict';
(() => {
  const LOCAL = Object.freeze({
    pipeline:'../../../docs/astra/G11_CURRENT_PIPELINE_RUN.json',
    metrics:'../../../docs/astra/G11_DATA_HEALTH_METRICS.json',
    issues:'../../../docs/astra/G11_DATA_HEALTH_ISSUES.json',
    guard:'../../../docs/astra/G11_GUARD37_EVIDENCE.json'
  });
  const el=id=>document.getElementById(id);
  const json=async url=>{
    const r=await fetch(url,{cache:'no-store',credentials:'same-origin'});
    if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  };
  async function boot(){
    try{
      const [p,m,i,g]=await Promise.all(Object.values(LOCAL).map(json));
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
