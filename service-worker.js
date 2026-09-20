/* G20_SERVICE_WORKER_DECOMMISSION
 * Final Production Cutover: retire the legacy root worker without rewriting
 * the certified Astra runtime bundle.
 */
const G20_TARGET=new URL('./astra-prod/runtime/v18/index.html?entry=g20-service-worker',self.location.href).href;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    try{await self.clients.claim()}catch(_){}
    try{await self.registration.unregister()}catch(_){}
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    await Promise.all(windows.map(async client=>{
      try{
        const u=new URL(client.url);
        if(u.origin===self.location.origin&&u.pathname.startsWith(new URL('./',self.location.href).pathname)){
          await client.navigate(G20_TARGET);
        }
      }catch(_){}
    }));
  })());
});
self.addEventListener('fetch',()=>{});
