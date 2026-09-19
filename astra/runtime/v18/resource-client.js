'use strict';
(() => {
  const RESOURCE_PATHS=Object.freeze({
    pipeline:'../../../docs/astra/G11_CURRENT_PIPELINE_RUN.json',
    metrics:'../../../docs/astra/G11_DATA_HEALTH_METRICS.json',
    issues:'../../../docs/astra/G11_DATA_HEALTH_ISSUES.json',
    guard:'../../../docs/astra/G11_GUARD37_EVIDENCE.json'
  });
  const relativeOnly=value=>typeof value==='string'&&!/^[a-z][a-z0-9+.-]*:/i.test(value)&&!value.startsWith('//');
  const readJson=async resource=>{
    if(!relativeOnly(resource))throw new Error('V18_RESOURCE_MUST_BE_SAME_ORIGIN_RELATIVE');
    const response=await fetch(resource,{cache:'no-store',credentials:'same-origin'});
    if(!response.ok)throw new Error(`${resource}: HTTP ${response.status}`);
    return response.json();
  };
  async function load(){
    const [pipeline,metrics,issues,guard]=await Promise.all(Object.values(RESOURCE_PATHS).map(readJson));
    return{pipeline,metrics,issues,guard,sourceIds:RESOURCE_PATHS};
  }
  globalThis.AstraRuntimeResources=Object.freeze({load,sourceIds:RESOURCE_PATHS});
})();
