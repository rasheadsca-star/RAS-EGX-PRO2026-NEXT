// V15.2-RECONCILED
const VERSION='V15.2-RECONCILED';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith((async()=>{
    try{return await fetch(event.request,{cache:'no-store'});}
    catch(e){
      if(event.request.mode==='navigate'){
        return new Response('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body style="background:#061426;color:#fff;font-family:Arial;padding:30px"><h2>غير متصل</h2><p>تم منع عرض نسخة قديمة. اتصل بالإنترنت وأعد فتح التطبيق.</p></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
      }
      throw e;
    }
  })());
});
