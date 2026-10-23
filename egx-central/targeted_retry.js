#!/usr/bin/env node
// Recheck lagged EGX symbols against public Mubasher pages, research-only; never write production.
const fs=require('fs'),crypto=require('crypto'),path=require('path');
async function main(){
 const [queueFile,outFile]=process.argv.slice(2);
 if(!queueFile||!outFile)throw Error('Usage: targeted_retry.js retry_candidates.json output.json');
 const input=JSON.parse(fs.readFileSync(queueFile,'utf8'));
 if(!input.read_only||!Array.isArray(input.candidates))throw Error('Unsafe or invalid retry queue');
 const candidates=input.candidates.slice(0,60);
 const results=[];
 for(const item of candidates){
  const symbol=String(item.symbol||'').toUpperCase();
  if(!/^[A-Z0-9._-]{2,12}$/.test(symbol)){results.push({symbol,status:'INVALID_SYMBOL'});continue}
  const tries=[];
  for(const lang of ['english','www']){
   const url='https://'+lang+'.mubasher.info/markets/EGX/stocks/'+encodeURIComponent(symbol)+'/';
   const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),7500);
   try{
    const response=await fetch(url,{signal:controller.signal,headers:{'user-agent':'EGX-Central-Research-ReadOnly/1.0','accept':'text/html'}});
    const body=(await response.text()).slice(0,400000);
    const mark=body.toLowerCase().includes('last update');
    tries.push({url,http_status:response.status,bytes:Buffer.byteLength(body),sha256:crypto.createHash('sha256').update(body).digest('hex'),quote_marker_present:mark});
    if(response.ok&&mark)break;
   }catch(e){tries.push({url,error:String(e.message).slice(0,150)})}
   finally{clearTimeout(timeout)}
  }
  const found=tries.some(t=>t.http_status===200&&t.quote_marker_present);
  results.push({symbol,previous_session:item.last_session,status:found?'PUBLIC_QUOTE_PAGE_REACHABLE_NOT_SESSION_VERIFIED':'RETRY_NO_VERIFIED_QUOTE',tries});
 }
 const report={schema:'egx-targeted-retry-1',generated_at:new Date().toISOString(),source_main_commit:input.source_main_commit,
   requested:candidates.length,reachable:results.filter(r=>r.status==='PUBLIC_QUOTE_PAGE_REACHABLE_NOT_SESSION_VERIFIED').length,
   verified_ohlcv:0,production_written:false,automatic_promotion:false,results};
 fs.mkdirSync(path.dirname(outFile),{recursive:true});fs.writeFileSync(outFile,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({requested:report.requested,reachable:report.reachable,verified_ohlcv:0,production_written:false}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
