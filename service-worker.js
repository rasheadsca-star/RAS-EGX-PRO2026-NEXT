/* G22_SERVICE_WORKER_DECOMMISSION
 * Full Application cutover: retire any legacy root worker and send existing
 * clients to the certified Astra full application.
 */
const G22_TARGET=new URL('./astra-prod/app/index.html?entry=g22-service-worker',self.location.href).href;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    try{await self.clients.claim()}catch(_){}
    try{await self.registration.unregister()}catch(_){}
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    await Promise.all(windows.map(async client=>{
      try{
        const u=new URL(client.url);
        if(u.origin===self.location.origin&&u.pathname.startsWith(new URL('./',self.location.href).pathname)) await client.navigate(G22_TARGET);
      }catch(_){}
    }));
  })());
});
self.addEventListener('fetch',()=>{});
