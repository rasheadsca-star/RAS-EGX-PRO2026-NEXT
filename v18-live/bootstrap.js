'use strict';
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{root.V18G12Bootstrap=api;api.boot();}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const LOCAL='../astra/runtime/v18/index.html';
  const R02_FALLBACK='https://cdn.jsdelivr.net/gh/rasheadsca-star/RAS-EGX-PRO2026-NEXT@v18-global-strategy-ensemble-20260906/preview-v18-web/index.html';

  async function localReady(fetchFn){
    const r=await fetchFn(LOCAL,{method:'GET',cache:'no-store',credentials:'same-origin'});
    if(!r.ok)throw new Error('LOCAL_HTTP_'+r.status);
    const html=await r.text();
    if(!html.includes('Astra Local Decision Surface'))throw new Error('LOCAL_CONTRACT_MISSING');
    return true;
  }
  async function loadFallback(fetchFn,writeHtml,setStatus){
    setStatus('تعذر المسار المحلي — تشغيل R02 المؤقت');
    const r=await fetchFn(R02_FALLBACK,{method:'GET',mode:'cors',cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer'});
    if(!r.ok)throw new Error('R02_HTTP_'+r.status);
    writeHtml(await r.text());
    return 'R02_FALLBACK';
  }
  async function resolve({fetchFn,navigate,writeHtml,setStatus}){
    try{
      await localReady(fetchFn);
      navigate(LOCAL);
      return 'LOCAL';
    }catch(localError){
      try{return await loadFallback(fetchFn,writeHtml,setStatus)}
      catch(fallbackError){
        setStatus('FAIL-CLOSED · لا يوجد مسار محلي صالح ولا fallback متاح');
        return 'FAIL_CLOSED';
      }
    }
  }
  async function boot(){
    const status=document.getElementById('status');
    return resolve({
      fetchFn:fetch,
      navigate:url=>location.replace(url),
      writeHtml:html=>{document.open();document.write(html);document.close()},
      setStatus:value=>{if(status)status.textContent=value}
    });
  }
  return{LOCAL,R02_FALLBACK,localReady,loadFallback,resolve,boot};
});
