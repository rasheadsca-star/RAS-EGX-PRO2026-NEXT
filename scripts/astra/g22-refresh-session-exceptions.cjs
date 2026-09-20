'use strict';

const fs=require('fs');
const path=require('path');

const ROOT=path.resolve(process.env.ASTRA_DECISION_ROOT||process.env.GITHUB_WORKSPACE||process.cwd());
const P=p=>path.join(ROOT,p);
const read=(p,d=null)=>{try{return JSON.parse(fs.readFileSync(P(p),'utf8'))}catch{return d}};
const write=(p,v)=>{fs.writeFileSync(P(p),JSON.stringify(v,null,2)+'\n','utf8')};
const dateOnly=v=>(String(v||'').match(/^(\d{4}-\d{2}-\d{2})/)||[])[1]||null;
const norm=v=>String(v||'').trim().toUpperCase().replace(/\.CA$/i,'').replace(/[^A-Z0-9._-]/g,'');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function decodeHtml(v){
  return String(v||'').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&#39;|&apos;/gi,"'")
    .replace(/&quot;/gi,'"').replace(/&#(\d+);/g,(_,c)=>String.fromCharCode(Number(c))).replace(/\s+/g,' ').trim();
}
function parseNum(v){
  const raw=String(v||'').replace(/,/g,'').trim();
  if(!raw||raw==='-'||raw==='—')return null;
  const n=Number(raw.replace(/[KMBT]$/i,''));
  if(!Number.isFinite(n))return null;
  const s=(raw.match(/[KMBT]$/i)||[''])[0].toUpperCase();
  return n*({K:1e3,M:1e6,B:1e9,T:1e12}[s]||1);
}
function parseRows(html){
  const rows=[];
  for(const tr of String(html||'').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
    const cells=[...tr[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)].map(m=>decodeHtml(m[1]));
    if(cells.length<5)continue;
    const time=Date.parse(cells[0]);
    if(!Number.isFinite(time))continue;
    rows.push({date:new Date(time).toISOString().slice(0,10),close:parseNum(cells[4]),volume:parseNum(cells[6])});
  }
  return rows.sort((a,b)=>a.date.localeCompare(b.date));
}
async function fetchText(url){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),18000);
  try{
    const r=await fetch(url,{redirect:'follow',signal:controller.signal,cache:'no-store',headers:{
      accept:'text/html,application/xhtml+xml','accept-language':'en-US,en;q=0.9',
      'cache-control':'no-cache','user-agent':'Mozilla/5.0 EGX-Pro-G22-Session-Exception-Revalidator/1.0'
    }});
    if(!r.ok)throw new Error('HTTP_'+r.status);
    return await r.text();
  }finally{clearTimeout(timer)}
}

async function main(){
  const base=read('data/g11-current-session-exceptions.json',{records:[]});
  const truth=read('data/stable/v15-price-truth.json',{});
  const market=read('data/market.json',{rows:[]});
  const symbols=read('data/symbol-map.json',{});
  const disposition=read('data/stable/v16-market-universe-disposition.json',{verifiedIneligible:[]});
  const verifiedIneligible=new Set((disposition.verifiedIneligible||[]).map(x=>norm(x.ticker)));
  const expected=dateOnly(truth.expectedSession);
  if(!expected)throw new Error('expected_session_missing');
  const marketByTicker=new Map((market.rows||[]).map(r=>[norm(r.ticker||r.symbol||r.code),r]));
  const reviewed=read('data/g22-reviewed-session-exceptions-'+expected+'.json',{expectedSession:null,records:[]});
  const reviewedRecords=dateOnly(reviewed.expectedSession)===expected?(reviewed.records||[]):[];
  const mergedRaw=new Map();
  for(const raw of (base.records||[])) mergedRaw.set(norm(raw.ticker),raw);
  for(const raw of reviewedRecords) mergedRaw.set(norm(raw.ticker),raw);
  const records=[];
  const audit=[];

  for(const raw of mergedRaw.values()){
    const ticker=norm(raw.ticker);
    const mapEntry=Array.isArray(symbols)?symbols.find(x=>norm(x.ticker)===ticker):symbols[ticker];
    if(!ticker||!mapEntry||mapEntry.active===false)continue;

    const primary=marketByTicker.get(ticker)||null;
    const primarySession=dateOnly(primary?.sourceSessionDate||primary?.sessionDate||primary?.date);
    const hasCurrentPrimary=primarySession===expected;

    if(raw.disposition==='LEGITIMATE_SUSPENSION'){
      const from=dateOnly(raw.effectiveFrom),through=dateOnly(raw.effectiveThrough);
      const active=Boolean(from&&through&&from<=expected&&expected<=through&&raw.authorityClass==='REGULATOR_OR_EXCHANGE');
      audit.push({ticker,mode:'SUSPENSION',active,from,through,primarySession});
      if(!active)continue;
      records.push({...raw,session:expected,expectedSession:expected,reviewedAt:new Date().toISOString(),
        evidenceSummary:String(raw.evidenceSummary||'')+' Automated G22 revalidation confirms '+expected+' remains inside the approved suspension window '+from+'..'+through+'; no synthetic market row is created.'});
      continue;
    }

    if(raw.disposition!=='LEGITIMATE_NO_TRADE'||raw.approved!==true||raw.identityVerified!==true||hasCurrentPrimary){
      audit.push({ticker,mode:'NO_TRADE',accepted:false,reason:hasCurrentPrimary?'CURRENT_PRIMARY_EXISTS':'BASE_RULE_INELIGIBLE',primarySession});
      continue;
    }

    const structural=String(raw.authorityClass||'')==='TEMPORARY_LISTING_NO_ORDINARY_TRADING';
    const stockUrl=(raw.evidenceUrls||[]).find(u=>/stockanalysis\.com\/quote\/egx\//i.test(String(u||'')));
    let currentIndependent=false,latestAvailableSession=null,checkError=null;
    if(stockUrl){
      try{
        const html=await fetchText(stockUrl);
        const rows=parseRows(html);
        const current=rows.find(x=>x.date===expected);
        latestAvailableSession=rows.at(-1)?.date||null;
        currentIndependent=!current&&Boolean(latestAvailableSession&&latestAvailableSession<expected);
      }catch(e){checkError=String(e?.message||e)}
      await sleep(80);
    }

    const dispositionVerified=verifiedIneligible.has(ticker);
    const accept=Boolean(structural||currentIndependent||dispositionVerified);
    audit.push({ticker,mode:'NO_TRADE',accepted:accept,structural,currentIndependent,dispositionVerified,primarySession,latestAvailableSession,stockUrl:stockUrl||null,checkError});
    if(!accept)continue;

    const basis=structural
      ? 'The previously reviewed temporary-listing/no-ordinary-trading status remains the governing disposition and the current primary market feed has no exact '+expected+' traded row.'
      : dispositionVerified
        ? 'The previously reviewed no-trade identity remains unchanged and the current professional market-universe disposition independently verified that no executable '+expected+' session row is available.'
        : 'The current primary market feed has no exact '+expected+' traded row and the independently checked StockAnalysis EGX history has no '+expected+' trading row; its latest listed trading session is '+latestAvailableSession+'.';
    records.push({...raw,session:expected,expectedSession:expected,sessionClosed:true,noTradesConfirmed:true,reviewedAt:new Date().toISOString(),
      evidenceSummary:basis+' This is a session exclusion only: no prior price is carried forward and no synthetic OHLCV bar is created. Previous G22-reviewed identity/evidence remains attached for audit.'});
  }

  const out={
    schemaVersion:'astra-g11-current-session-exceptions-1',
    expectedSession:expected,
    policy:'Daily G22 operational revalidation of previously reviewed legitimate no-trade/suspension exceptions. A record is carried only when the current session remains inside an approved suspension window, a structural no-trading status remains applicable, or current independent history confirms no expected-session trading row. No price is synthesized or carried forward.',
    records
  };
  write('data/g11-current-session-exceptions.json',out);
  write('data/g22-session-exception-refresh-audit.json',{
    schemaVersion:'astra-g22-session-exception-refresh-audit-1',generatedAt:new Date().toISOString(),expectedSession:expected,
    baselineSession:dateOnly(base.expectedSession),acceptedTickers:records.map(x=>x.ticker),acceptedCount:records.length,audit
  });
  console.log('G22_SESSION_EXCEPTIONS '+JSON.stringify({expectedSession:expected,acceptedTickers:records.map(x=>x.ticker),acceptedCount:records.length}));
}
main().catch(e=>{console.error(e);process.exit(1)});