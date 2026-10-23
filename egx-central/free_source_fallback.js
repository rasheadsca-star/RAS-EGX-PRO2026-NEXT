#!/usr/bin/env node
// Zero-cost, research-only auxiliary public-source collector. Never modifies trading data.
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const endpoints=[
 {source:'yahoo_chart',url:s=>'https://query1.finance.yahoo.com/v8/finance/chart/'+encodeURIComponent(s+'.CA')+'?range=5d&interval=1d'},
 {source:'stooq_daily',url:s=>'https://stooq.com/q/d/l/?s='+encodeURIComponent(s+'.eg')+'&i=d'}
];
async function check(endpoint,symbol){
 const url=endpoint.url(symbol);const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),6500);
 try{
  const res=await fetch(url,{signal:ctrl.signal,headers:{'user-agent':'Mozilla/5.0 EGX-Central-Research'}});
  const body=(await res.text()).slice(0,250000);
  const evidence={source:endpoint.source,url,http_status:res.status,body_sha256:crypto.createHash('sha256').update(body).digest('hex'),bytes:body.length};
  if(!res.ok)return {...evidence,status:'HTTP_ERROR'};
  if(endpoint.source==='yahoo_chart'){
   let root;try{root=JSON.parse(body)}catch{return {...evidence,status:'NON_JSON'}}
   const result=root.chart?.result?.[0],quote=result?.indicators?.quote?.[0],timestamp=result?.timestamp;
   if(result?.meta?.symbol&&String(result.meta.symbol).split('.')[0].toUpperCase()!==symbol)return {...evidence,status:'SYMBOL_MISMATCH'};
   if(!Array.isArray(timestamp)||!Array.isArray(quote?.close))return {...evidence,status:'NO_PRICE_SERIES'};
   const candidate=[];
   for(let i=0;i<timestamp.length;i++){
    const d=new Date(timestamp[i]*1000).toISOString().slice(0,10);
    const o=quote.open?.[i],h=quote.high?.[i],l=quote.low?.[i],c=quote.close?.[i],v=quote.volume?.[i];
    if([o,h,l,c,v].every(x=>typeof x==='number'&&Number.isFinite(x)&&x>0)&&h>=Math.max(o,c,l)&&l<=Math.min(o,c,h))
      candidate.push({session:d,open:o,high:h,low:l,close:c,volume:v,status:'UNVERIFIED_PUBLIC_RESEARCH'});
   }
   return {...evidence,status:candidate.length?'CANDIDATE_UNVERIFIED':'NO_VALID_BARS',candidate:candidate.slice(-5)};
  }
  const lines=body.trim().split(/\\r?\\n/);
  if(!/^Date,Open,High,Low,Close,Volume/i.test(lines[0]||''))return {...evidence,status:'NOT_EXPECTED_CSV'};
  const bars=[];
  for(const line of lines.slice(-6)){const [d,o,h,l,c,v]=line.split(',');const nums=[o,h,l,c,v].map(Number);
   if(/^\\d{4}-\\d{2}-\\d{2}$/.test(d)&&nums.every(x=>Number.isFinite(x)&&x>0)&&nums[1]>=Math.max(nums[0],nums[2],nums[3])&&nums[2]<=Math.min(nums[0],nums[1],nums[3]))
    bars.push({session:d,open:nums[0],high:nums[1],low:nums[2],close:nums[3],volume:nums[4],status:'UNVERIFIED_PUBLIC_RESEARCH'});
  }
  return {...evidence,status:bars.length?'CANDIDATE_UNVERIFIED':'NO_VALID_BARS',candidate:bars};
 }catch(e){return {source:endpoint.source,url,status:'NETWORK_ERROR',error:String(e.message).slice(0,150)}}
 finally{clearTimeout(timer)}
}
async function main(){
 const [inputFile,outFile]=process.argv.slice(2);
 if(!inputFile||!outFile)throw Error('Need retry queue and output');
 const input=JSON.parse(fs.readFileSync(inputFile,'utf8'));if(input.read_only!==true||!Array.isArray(input.candidates))throw Error('unsafe queue');
 const rows=[];for(const row of input.candidates.slice(0,60)){
  const symbol=String(row.symbol||'').toUpperCase();if(!/^[A-Z0-9_-]{2,12}$/.test(symbol))continue;
  const attempts=[];for(const endpoint of endpoints)attempts.push(await check(endpoint,symbol));
  rows.push({symbol,attempts});
 }
 const counts={};for(const row of rows)for(const a of row.attempts)counts[a.status]=(counts[a.status]||0)+1;
 const result={schema:'egx-free-source-fallback-1',requested:rows.length,attempts:counts,independent_price_matches_confirmed:0,
  verified_ohlcv:0,production_written:false,automatic_promotion:false,
  warning:'Free providers may not cover EGX, can change formats or have licensing restrictions; research evidence only.',rows};
 fs.mkdirSync(path.dirname(outFile),{recursive:true});fs.writeFileSync(outFile,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({requested:rows.length,attempts:counts,verified_ohlcv:0}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
