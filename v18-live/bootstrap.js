'use strict';
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else{root.V18G12Bootstrap=api;api.boot();}
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const LOCAL='../astra/runtime/v18/index.html';

  async function localReady(fetchFn){
    const r=await fetchFn(LOCAL,{method:'GET',cache:'no-store',credentials:'same-origin'});
    if(!r.ok)throw new Error('LOCAL_HTTP_'+r.status);
    const html=await r.text();
    if(!html.includes('Astra Local Decision Surface'))throw new Error('LOCAL_CONTRACT_MISSING');
    return true;
  }
  async function resolve({fetchFn,navigate,setStatus}){
    try{
      await localReady(fetchFn);
      navigate(LOCAL);
      return 'LOCAL';
    }catch(error){
      setStatus('FAIL-CLOSED · تعذر المسار المحلي المعتمد');
      return 'FAIL_CLOSED';
    }
  }
  async function boot(){
    const status=document.getElementById('status');
    return resolve({
      fetchFn:fetch,
      navigate:url=>location.replace(url),
      setStatus:value=>{if(status)status.textContent=value}
    });
  }
  return{LOCAL,localReady,resolve,boot};
});
