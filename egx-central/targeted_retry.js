#!/usr/bin/env node
// Recheck lagged EGX symbols against public Mubasher pages, research-only; never write production.
const fs=require('fs'),crypto=require('crypto'),path=require('path');
function parseQuote(html,symbol){
 const plain=html.replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ');
 const m=plain.match(/Last update:\s*([^\.]+?market time)\.\s*([0-9][0-9,.]*)\s+([+\-−–]?[0-9][0-9,.]*)\s+([+\-−–]?[0-9][0-9,.]*)%/i);
 if(!m)return null;
 const price=Number(m[2].replace(/,/g,''));
 if(!Number.isFinite(price)||price<=0)return null;
 const window=plain.slice(Math.max(0,plain.indexOf(m[0])),Math.max(0,plain.indexOf(m[0]))+5500);
 const metric=(name)=>{const x=window.match(new RegExp('(?:^|\\s)'+name+'\\s*:?\\s*([0-9][0-9,.]*)','i'));return x?Number(x[1].replace(/,/g,'')):null};
 const high=metric('(?:Day High|High)'),low=metric('(?:Day Low|Low)'),open=metric('(?:Opening Price|Open)'),volume=metric('(?:Traded Volume|Volume)');
 const valid= [high,low,open,volume].every(v=>Number.isFinite(v)&&v>0)&&high>=Math.max(price,open,low)&&low<=Math.min(price,open,high);
 return {symbol,market_time_text:m[1].trim(),close:price,open,high,low,volume,
  ohlcv_structurally_valid:valid,session_date:null,
  status:valid?'PARSED_UNDATED_OHLCV_RESEARCH_ONLY':'PARSED_CLOSE_INCOMPLETE_OHLCV'};
}
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
  const tries=[];let quote=null;
  for(const lang of ['english','www']){
   const url='https://'+lang+'.mubasher.info/markets/EGX/stocks/'+encodeURIComponent(symbol)+'/';
   const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),7500);
   try{
    const response=await fetch(url,{signal:controller.signal,headers:{'user-agent':'EGX-Central-Research-ReadOnly/1.0','accept':'text/html'}});
    const body=(await response.text()).slice(0,400000);
    const mark=body.toLowerCase().includes('last update');
    if(response.ok&&mark)quote=parseQuote(body,symbol);
    tries.push({url,http_status:response.status,bytes:Buffer.byteLength(body),sha256:crypto.createHash('sha256').update(body).digest('hex'),quote_marker_present:mark,parsed_quote:quote});
    if(response.ok&&quote&&quote.close>0)break;
   }catch(e){tries.push({url,error:String(e.message).slice(0,150)})}
   finally{clearTimeout(timeout)}
  }
  const found=tries.some(t=>t.http_status===200&&t.quote_marker_present);
  results.push({symbol,previous_session:item.last_session,quote,parse_failure_reason:!found?'NO_QUOTE_MARKER':!quote?'QUOTE_PATTERN_NOT_MATCHED':null,status:found?'PUBLIC_QUOTE_PAGE_REACHABLE_NOT_SESSION_VERIFIED':'RETRY_NO_VERIFIED_QUOTE',tries});
 }
 const report={schema:'egx-targeted-retry-1',generated_at:new Date().toISOString(),source_main_commit:input.source_main_commit,
   requested:candidates.length,reachable:results.filter(r=>r.status==='PUBLIC_QUOTE_PAGE_REACHABLE_NOT_SESSION_VERIFIED').length,
   parsed_close_count:results.filter(r=>r.quote&&r.quote.close>0).length,verified_ohlcv:0,production_written:false,automatic_promotion:false,results};
 fs.mkdirSync(path.dirname(outFile),{recursive:true});fs.writeFileSync(outFile,JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({requested:report.requested,reachable:report.reachable,parsed_close_count:report.parsed_close_count,verified_ohlcv:0,production_written:false}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
