import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performanceAnalytics } from '../src/performance.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { selectConcentratedRecommendations, selectReviewQueue } from '../src/concentration.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const readJson=(name,fallback=null)=>{try{return JSON.parse(fs.readFileSync(path.join(root,'data',name),'utf8'));}catch{return fallback;}};
const load=()=>readJson('current-scan.json',null);
const readHistory=()=>readJson('recommendation-history.json',null);
const readHistoricalSimulator=()=>readJson('research/historical-simulator-summary.json',null);
const readHistoricalSimulatorFull=()=>readJson('research/historical-simulator.json',null);
const readComparison=()=>readJson('research/engine-comparison.json',null);
const send=(res,status,obj)=>{res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(obj));};
const sendAsset=(res,status,body,contentType)=>{res.statusCode=status;res.setHeader('content-type',contentType);res.setHeader('cache-control','public, max-age=60, s-maxage=300, stale-while-revalidate=86400');res.end(body);};
const sendHtml=(res,status,body)=>{res.statusCode=status;res.setHeader('content-type','text/html; charset=utf-8');res.setHeader('cache-control','no-store');res.end(body);};
const concentrated=(scan)=>{
  if(Array.isArray(scan?.top_recommendations)&&scan.top_recommendations.length)return scan.top_recommendations.slice(0,5);
  if(Array.isArray(scan?.all)&&scan.all.length)return selectConcentratedRecommendations(scan.all,DEFAULT_CONFIG.concentration);
  return Array.isArray(scan?.top5_now)?scan.top5_now.slice(0,5):[];
};
const reviewQueue=(scan)=>Array.isArray(scan?.all)&&scan.all.length?selectReviewQueue(scan.all,DEFAULT_CONFIG.concentration):[];

const GITHUB_DATA_BASE='https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/develop/sepax-isolated-v1/sepa-x/data';
const GITHUB_SCAN_URL=`${GITHUB_DATA_BASE}/current-scan.json`;
const GITHUB_HISTORY_URL=`${GITHUB_DATA_BASE}/recommendation-history.json`;
const GITHUB_HISTORICAL_URL=`${GITHUB_DATA_BASE}/research/historical-simulator-summary.json`;
const GITHUB_HISTORICAL_FULL_URL=`${GITHUB_DATA_BASE}/research/historical-simulator.json`;
const GITHUB_COMPARISON_URL=`${GITHUB_DATA_BASE}/research/engine-comparison.json`;
const UI_SNAPSHOT_SHA='2b8db70ae9a83c1ae40db6c03199bf43d7ae0c1a';
const GITHUB_PUBLIC_BASE=`https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/${UI_SNAPSHOT_SHA}/sepa-x/public`;
const LIVE_SCAN_URL='https://egx-sepa-x-live-runner.vercel.app/api/live';
const REMOTE_TTL_MS=45_000;
const EVIDENCE_TTL_MS=300_000;
let remoteCache={scan:null,source:null,expiresAt:0};
let remoteInFlight=null;
const evidenceCache=new Map();
const assetCache=new Map();

const looksLikeScan=(x)=>Boolean(x&&typeof x==='object'&&Array.isArray(x.all)&&x.market_coverage&&x.market_status);
const unwrapLiveScan=(payload)=>[
  payload?.scan,
  payload?.result?.scan,
  payload?.result,
  payload?.data?.scan,
  payload?.data,
  payload
].find(looksLikeScan)||null;

async function fetchDocument(url,{timeoutMs=20_000,errorPrefix='REMOTE'}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetch(url,{cache:'no-store',signal:controller.signal});
    if(!response.ok)throw new Error(`${errorPrefix}_HTTP_${response.status}`);
    return response;
  }finally{clearTimeout(timer);}
}

async function fetchJsonDocument(url,{timeoutMs=20_000,errorPrefix='REMOTE_JSON'}={}){
  const response=await fetchDocument(url,{timeoutMs,errorPrefix});
  return response.json();
}

async function fetchTextDocument(url,{timeoutMs=12_000,errorPrefix='REMOTE_ASSET'}={}){
  const response=await fetchDocument(url,{timeoutMs,errorPrefix});
  return response.text();
}

async function fetchJsonWithTimeout(url,{timeoutMs=20_000,unwrap=x=>x,errorPrefix='REMOTE_SCAN'}={}){
  const payload=await fetchJsonDocument(url,{timeoutMs,errorPrefix});
  const scan=unwrap(payload);
  if(!looksLikeScan(scan))throw new Error(`${errorPrefix}_INVALID_PAYLOAD`);
  return scan;
}

async function loadUiAsset(key,file){
  const cached=assetCache.get(key);
  if(cached)return cached;
  const body=await fetchTextDocument(`${GITHUB_PUBLIC_BASE}/${file}`,{errorPrefix:`GITHUB_UI_${key.toUpperCase()}`});
  assetCache.set(key,body);
  return body;
}

function injectDetailedBacktestLink(html){
  if(!html||html.includes('sepax-detailed-backtest-link'))return html;
  const script=`<script id="sepax-detailed-backtest-link">document.addEventListener('DOMContentLoaded',()=>{const nav=document.querySelector('.tabs');if(nav&&!document.getElementById('detailedBacktestNav')){const a=document.createElement('a');a.id='detailedBacktestNav';a.className='tab';a.href='/backtest/view';a.textContent='الاختبار بأثر رجعي — الصفقات';a.style.textDecoration='none';nav.appendChild(a)}const box=document.getElementById('backtestStatus');if(box&&!document.getElementById('detailedBacktestBtn')){const a=document.createElement('a');a.id='detailedBacktestBtn';a.className='btn primary full';a.href='/backtest/view';a.style.marginTop='12px';a.textContent='عرض نقاط الدخول والوقف والأهداف لكل صفقة';box.insertAdjacentElement('afterend',a)}});</script>`;
  return html.replace('</body>',`${script}</body>`);
}

async function loadEvidence(key,localValue,url,fallback=null){
  if(localValue!==null&&localValue!==undefined)return {value:localValue,source:'LOCAL_BUNDLE',error:null};
  const cached=evidenceCache.get(key);
  if(cached&&Date.now()<cached.expiresAt)return {value:cached.value,source:cached.source,error:null};
  try{
    const value=await fetchJsonDocument(url,{timeoutMs:12_000,errorPrefix:`GITHUB_${key.toUpperCase()}`});
    if(!value||typeof value!=='object')throw new Error(`GITHUB_${key.toUpperCase()}_INVALID_PAYLOAD`);
    const source='GITHUB_BRANCH_SNAPSHOT';
    evidenceCache.set(key,{value,source,expiresAt:Date.now()+EVIDENCE_TTL_MS});
    return {value,source,error:null};
  }catch(error){
    return {value:fallback,source:'UNAVAILABLE',error:String(error?.message||error)};
  }
}

async function fetchRemoteScan(){
  if(remoteCache.scan&&Date.now()<remoteCache.expiresAt)return {scan:remoteCache.scan,source:remoteCache.source};
  if(remoteInFlight)return remoteInFlight;
  remoteInFlight=(async()=>{
    const errors=[];
    try{
      const scan=await fetchJsonWithTimeout(GITHUB_SCAN_URL,{errorPrefix:'GITHUB_SCAN'});
      remoteCache={scan,source:'GITHUB_BRANCH_SNAPSHOT',expiresAt:Date.now()+REMOTE_TTL_MS};
      return {scan,source:remoteCache.source,error:null};
    }catch(error){errors.push(String(error?.message||error));}
    try{
      const scan=await fetchJsonWithTimeout(LIVE_SCAN_URL,{timeoutMs:45_000,unwrap:unwrapLiveScan,errorPrefix:'LIVE_SCAN'});
      remoteCache={scan,source:'LIVE_RUNNER',expiresAt:Date.now()+REMOTE_TTL_MS};
      return {scan,source:remoteCache.source,error:null};
    }catch(error){errors.push(String(error?.message||error));}
    return {scan:null,source:'UNAVAILABLE',error:errors.join(' | ')||'REMOTE_SCAN_UNAVAILABLE'};
  })();
  try{return await remoteInFlight;}finally{remoteInFlight=null;}
}

async function loadScan(){
  const local=load();
  if(local)return {scan:local,source:'LOCAL_CURRENT_SCAN',error:null};
  return fetchRemoteScan();
}

const loadHistory=()=>loadEvidence('history',readHistory(),GITHUB_HISTORY_URL,{runs:[],recommendations:[]});
const loadHistorical=()=>loadEvidence('historical_simulator',readHistoricalSimulator(),GITHUB_HISTORICAL_URL,null);
const loadHistoricalFull=()=>loadEvidence('historical_simulator_full',readHistoricalSimulatorFull(),GITHUB_HISTORICAL_FULL_URL,null);
const loadComparison=()=>loadEvidence('engine_comparison',readComparison(),GITHUB_COMPARISON_URL,null);

const hEsc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const price=(v)=>Number.isFinite(Number(v))?Number(v).toFixed(2):'—';
const percent=(v)=>Number.isFinite(Number(v))?`${Number(v).toFixed(2)}%`:'—';
const rValue=(v)=>Number.isFinite(Number(v))?`${Number(v).toFixed(2)}R`:'—';
const plannedR=(target,entry,stop)=>{const risk=Number(entry)-Number(stop);return risk>0&&Number.isFinite(Number(target))?(Number(target)-Number(entry))/risk:null;};

function filterHistoricalTrades(report,u){
  const symbol=String(u.searchParams.get('symbol')||'').trim().toUpperCase();
  const outcome=String(u.searchParams.get('outcome')||'ALL').trim().toUpperCase();
  const entered=String(u.searchParams.get('entered')||'1')!=='0';
  let trades=Array.isArray(report?.trades)?report.trades:[];
  if(entered)trades=trades.filter(t=>t.entered===true);
  if(symbol)trades=trades.filter(t=>String(t.symbol||'').toUpperCase().includes(symbol));
  if(outcome&&outcome!=='ALL')trades=trades.filter(t=>String(t.outcome||'').toUpperCase()===outcome);
  return trades.sort((a,b)=>String(b.signalDate||'').localeCompare(String(a.signalDate||'')));
}

function renderBacktestView(report,u,source){
  const trades=filterHistoricalTrades(report,u);
  const symbol=hEsc(String(u.searchParams.get('symbol')||''));
  const selectedOutcome=String(u.searchParams.get('outcome')||'ALL').toUpperCase();
  const s=report?.summary||{},m=report?.methodology||{},d=report?.dataset||{};
  const outcomeOption=(value,label)=>`<option value="${value}" ${selectedOutcome===value?'selected':''}>${label}</option>`;
  const rows=trades.map(t=>{
    const r1=plannedR(t.target1,t.entryPrice,t.stopLoss),r2=plannedR(t.target2,t.entryPrice,t.stopLoss),r3=plannedR(t.target3,t.entryPrice,t.stopLoss);
    const outcomeClass=t.outcome==='TARGET1'?'ok':t.outcome==='STOP'?'bad':'warn';
    return `<tr><td><b>${hEsc(t.signalDate)}</b><small>${hEsc(t.status||'')}</small></td><td><b class="sym">${hEsc(t.symbol)}</b><small>Rank #${hEsc(t.rank??'—')}</small></td><td><small>${hEsc(t.entryDate||'—')}</small><b class="entry">${price(t.entryPrice)}</b></td><td><b class="stop">${price(t.stopLoss)}</b><small>Risk ${percent(t.riskPct)}</small></td><td><b class="target">${price(t.target1)}</b><small>${rValue(r1)} ${t.target1Hit?'✓':''}</small></td><td><b class="target">${price(t.target2)}</b><small>${rValue(r2)} ${t.target2Hit?'✓':''}</small></td><td><b class="target">${price(t.target3)}</b><small>${rValue(r3)} ${t.target3Hit?'✓':''}</small></td><td><span class="pill ${outcomeClass}">${hEsc(t.outcome||'—')}</span><small>${hEsc(t.exitDate||'—')}</small></td><td><b class="${Number(t.netPct)>=0?'gain':'loss'}">${percent(t.netPct)}</b><small>${rValue(t.netR)} • ${hEsc(t.holdingSessions??'—')} جلسة</small></td></tr>`;
  }).join('');
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SEPA-X — Backtest Trade Plans</title><style>
  :root{color-scheme:dark;--bg:#06131f;--panel:#0b2030;--line:#1c4058;--text:#eef7fb;--muted:#8facbd;--entry:#4db6ff;--stop:#ff6577;--target:#4fe09c;--gold:#ffc857}*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#06131f,#081a27);color:var(--text);font-family:Tahoma,Arial,sans-serif}.wrap{max-width:1500px;margin:auto;padding:24px}.top{display:flex;gap:16px;justify-content:space-between;align-items:flex-start;flex-wrap:wrap}.top h1{margin:0 0 8px;font-size:26px}.top p{margin:0;color:var(--muted);line-height:1.7}.back{display:inline-flex;padding:10px 16px;border:1px solid var(--line);border-radius:10px;color:var(--text);text-decoration:none;background:#0b2030}.note{margin:18px 0;padding:14px 16px;border:1px solid #765b1d;background:#2a2210;border-radius:12px;color:#ffe39a}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:16px 0}.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px}.card small{display:block;color:var(--muted);margin-bottom:6px}.card b{font-size:20px}.filters{display:flex;gap:10px;flex-wrap:wrap;background:var(--panel);padding:12px;border:1px solid var(--line);border-radius:12px;margin:16px 0}.filters input,.filters select,.filters button{background:#061725;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:10px 12px}.filters button{cursor:pointer;background:#123b54}.table{overflow:auto;border:1px solid var(--line);border-radius:12px;background:var(--panel)}table{width:100%;border-collapse:collapse;min-width:1250px}th,td{padding:12px 10px;border-bottom:1px solid #153448;text-align:right;vertical-align:top}th{position:sticky;top:0;background:#0d293c;color:#cfe9f5;z-index:1}td b,td small{display:block}td small{color:var(--muted);margin-top:5px;font-size:11px}.sym{font-size:16px}.entry{color:var(--entry);font-size:17px}.stop{color:var(--stop);font-size:17px}.target{color:var(--target);font-size:17px}.gain{color:var(--target)}.loss{color:var(--stop)}.pill{display:inline-block;padding:5px 8px;border-radius:999px;font-size:11px;font-weight:700}.pill.ok{background:#123f32;color:#78f0b8}.pill.bad{background:#4a1c26;color:#ff9dac}.pill.warn{background:#473b14;color:#ffe080}.legend{display:flex;gap:16px;flex-wrap:wrap;margin:10px 0 16px;color:var(--muted)}.legend b:nth-child(1){color:var(--entry)}.legend b:nth-child(2){color:var(--stop)}.legend b:nth-child(3){color:var(--target)}.method{margin-top:16px;color:var(--muted);font-size:13px;line-height:1.8}.empty{padding:40px;text-align:center;color:var(--muted)}@media(max-width:700px){.wrap{padding:14px}.top h1{font-size:21px}}
  </style></head><body><div class="wrap"><div class="top"><div><h1>الاختبار بأثر رجعي — نقاط الصفقة الفعلية</h1><p>كل صف أدناه يعرض نقطة الدخول التي تم ملؤها تاريخيًا، وقف الخسارة، والأهداف T1/T2/T3 التي كانت معروفة وقت الإشارة.</p></div><a class="back" href="/">العودة إلى SEPA-X</a></div>
  <div class="note"><b>Research Only:</b> المحاكاة Point-in-Time وNo-Lookahead. الدخول يتم بعد تاريخ الإشارة، وتكلفة التداول الدائرية ${percent(m.roundTripCostPct)}. الأهداف ليست أسعارًا أضيفت بعد معرفة النتيجة.</div>
  <div class="summary"><div class="card"><small>Signal Dates</small><b>${hEsc(s.signalDates??'—')}</b></div><div class="card"><small>Entered Trades</small><b>${hEsc(s.entered??'—')}</b></div><div class="card"><small>Positive</small><b>${percent(s.positivePct)}</b></div><div class="card"><small>Target 1 Hit</small><b>${percent(s.target1HitPct)}</b></div><div class="card"><small>Profit Factor</small><b>${hEsc(s.profitFactor??'—')}</b></div><div class="card"><small>Expectancy</small><b>${rValue(s.expectancyR)}</b></div><div class="card"><small>Max Drawdown</small><b>${percent(s.maximumBasketDrawdownPct)}</b></div><div class="card"><small>Symbols Loaded</small><b>${hEsc(d.symbolsLoaded??'—')}</b></div></div>
  <form class="filters" method="get" action="/backtest/view"><input name="symbol" value="${symbol}" placeholder="رمز السهم — مثال COMI"><select name="outcome">${outcomeOption('ALL','كل النتائج')}${outcomeOption('TARGET1','وصل للهدف الأول')}${outcomeOption('STOP','ضرب الوقف')}${outcomeOption('TIME_EXIT','خروج زمني')}</select><button type="submit">تطبيق الفلتر</button><a class="back" href="/backtest/view">مسح الفلاتر</a></form>
  <div class="legend"><span><b>Entry</b> = سعر الدخول الفعلي بالمحاكاة</span><span><b>Stop</b> = وقف الخسارة</span><span><b>Targets</b> = T1 / T2 / T3 والخطر المقابل R</span></div>
  <div class="table"><table><thead><tr><th>الإشارة</th><th>السهم</th><th>الدخول</th><th>الوقف</th><th>T1</th><th>T2</th><th>T3</th><th>الخروج</th><th>النتيجة</th></tr></thead><tbody>${rows||`<tr><td colspan="9"><div class="empty">لا توجد صفقات مطابقة للفلاتر الحالية.</div></td></tr>`}</tbody></table></div>
  <div class="method">Source: ${hEsc(source)} • Generated: ${hEsc(report?.generatedAt||'—')} • Point-in-time: ${m.pointInTime===true?'YES':'UNKNOWN'} • No look-ahead: ${m.noLookahead===true?'YES':'UNKNOWN'} • Entry expiry: ${hEsc(m.entryExpirySessions??'—')} جلسات • Max hold: ${hEsc(m.maxHoldSessions??'—')} جلسة • Same-bar ambiguity: ${hEsc(m.sameBarAmbiguity||'—')}.</div></div></body></html>`;
}

export default async function handler(req,res){
  const u=new URL(req.url,'http://localhost');
  const route=(u.searchParams.get('route')||u.pathname.replace(/^\/+/, '')).replace(/^api\/index\/?/,'');

  const ui={
    'ui/index':['index.html','text/html; charset=utf-8'],
    'ui/app':['app.js','text/javascript; charset=utf-8'],
    'ui/styles':['styles.css','text/css; charset=utf-8']
  }[route];
  if(ui){
    try{
      let body=await loadUiAsset(route,ui[0]);
      if(route==='ui/index')body=injectDetailedBacktestLink(body);
      return sendAsset(res,200,body,ui[1]);
    }catch(error){return send(res,503,{ok:false,error:'UI_SNAPSHOT_UNAVAILABLE',asset:ui[0],source:'GITHUB_IMMUTABLE_SNAPSHOT',sourceError:String(error?.message||error)});}
  }

  if(route==='backtest'||route==='engine/backtest'){
    const historical=await loadHistorical();
    if(!historical.value)return send(res,503,{ok:false,error:'HISTORICAL_SIMULATOR_RESULT_NOT_AVAILABLE',source:historical.source,sourceError:historical.error,frameworkReady:true,lookAheadGuard:true,walkForward:true,execution:false});
    return send(res,200,{...historical.value,ok:true,source:historical.source});
  }
  if(route==='backtest/trades'||route==='engine/backtest/trades'){
    const historical=await loadHistoricalFull();
    if(!historical.value)return send(res,503,{ok:false,error:'HISTORICAL_SIMULATOR_TRADES_NOT_AVAILABLE',source:historical.source,sourceError:historical.error});
    const trades=filterHistoricalTrades(historical.value,u);
    return send(res,200,{ok:true,source:historical.source,generatedAt:historical.value.generatedAt,methodology:historical.value.methodology,dataset:historical.value.dataset,summary:historical.value.summary,count:trades.length,trades});
  }
  if(route==='backtest/view'){
    const historical=await loadHistoricalFull();
    if(!historical.value)return sendHtml(res,503,'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><body style="background:#071521;color:white;font-family:Tahoma;padding:30px"><h2>تعذر تحميل تفاصيل الاختبار بأثر رجعي</h2><p>Historical simulator trade file is unavailable.</p><a href="/" style="color:#70cfff">العودة للتطبيق</a></body></html>');
    return sendHtml(res,200,renderBacktestView(historical.value,u,historical.source));
  }
  if(route==='engine/comparison'||route==='comparison'){
    const comparison=await loadComparison();
    if(!comparison.value)return send(res,503,{ok:false,error:'ENGINE_COMPARISON_NOT_AVAILABLE',source:comparison.source,sourceError:comparison.error});
    return send(res,200,{...comparison.value,ok:true,source:comparison.source});
  }

  const {scan,source:scanSource,error:scanError}=await loadScan();

  if(route==='health'||route==='engine/health'){
    const [historical,comparison]=await Promise.all([loadHistorical(),loadComparison()]);
    return send(res,200,{
      ok:true,
      engineId:'SEPA_X_ENGINE_V1',
      isolatedFromRc2:true,
      uiSource:'GITHUB_IMMUTABLE_SNAPSHOT',
      uiSnapshotSha:UI_SNAPSHOT_SHA,
      scanAvailable:Boolean(scan),
      scanSource,
      scanError:scan?null:scanError,
      historicalSimulatorAvailable:Boolean(historical.value),
      historicalSimulatorSource:historical.source,
      historicalSimulatorError:historical.value?null:historical.error,
      historicalTradeDetailsAvailable:true,
      comparisonAvailable:Boolean(comparison.value),
      comparisonSource:comparison.source,
      comparisonError:comparison.value?null:comparison.error,
      fullMarket:Boolean(scan?.market_coverage?.TotalListed&&scan?.market_coverage?.TotalEligible===scan?.market_coverage?.TotalListed),
      generatedAt:scan?.generatedAt||null,
      completeCoreHistory:scan?.market_coverage?.CompleteSMA200R252Week52??null,
      totalListed:scan?.market_coverage?.TotalListed??null,
      concentrationPolicy:DEFAULT_CONFIG.concentration
    });
  }

  if(route==='engine/performance'){
    const history=await loadHistory();
    return send(res,200,{...performanceAnalytics(history.value||{runs:[],recommendations:[]}),source:history.source,sourceError:history.error});
  }
  if(route==='engine/history'){
    const history=await loadHistory(),hist=history.value||{runs:[],recommendations:[]};
    return send(res,200,{runs:(hist.runs||[]).slice(-50).reverse(),recommendations:(hist.recommendations||[]).slice(-300).reverse(),count:(hist.recommendations||[]).length,source:history.source,sourceError:history.error});
  }

  if(!scan)return send(res,503,{ok:false,error:'NO_SCAN_AVAILABLE',scanSource,scanError,message:'Live SEPA-X scan is temporarily unavailable. No mock data is served.'});
  const top=concentrated(scan),review=reviewQueue(scan);

  if(route==='scan')return send(res,200,{engineId:scan.engineId,generatedAt:scan.generatedAt,scan_source:scanSource,market_status:scan.market_status,market_coverage:scan.market_coverage,concentration_policy:scan.concentration_policy||{mode:'TOP_3_OR_5_HIGH_CONVICTION',selected:top.length,baseCount:3,maxCount:5},review_required_count:review.length,no_high_conviction_setup:top.length<3});
  if(route==='universe')return send(res,200,{count:(scan.all||[]).length,rows:(scan.all||[]).map(x=>({symbol:x.symbol,name:x.name,rank:x.market_rank,percentile:x.market_percentile,status:x.status,action:x.action,score:x.final_score,rs:x.rs_percentile,pivot:x.pivot,distance:x.distance_to_pivot_pct,rr:x.reward_risk,classification:x.classification,historyComplete:Boolean(x.history_metrics?.complete)}))});
  if(route==='opportunities')return send(res,200,{top,review,near:scan.near_breakout||[],forming:scan.forming_leaders||[],extended:scan.strong_but_extended||[],near_miss:scan.near_miss||[],policy:{baseCount:3,maxCount:5,paddingLowQualityCandidates:false,targetRMultiples:[2,3,4],reviewQueueExecutionAllowed:false}});
  if(route==='opportunities/top')return send(res,200,top);
  if(route==='opportunities/review')return send(res,200,review);
  if(route==='opportunities/near')return send(res,200,scan.near_breakout||[]);
  if(route==='opportunities/watch'||route==='opportunities/forming')return send(res,200,scan.forming_leaders||[]);
  if(route==='opportunities/extended')return send(res,200,scan.strong_but_extended||[]);
  if(route==='opportunities/near-miss')return send(res,200,scan.near_miss||[]);
  if(route==='market/regime')return send(res,200,scan.market_status);
  if(route==='engine/coverage')return send(res,200,scan.market_coverage);
  if(route==='engine/transitions')return send(res,200,{generatedAt:scan.generatedAt,transitions:(scan.transitions||[]).slice(-500).reverse()});
  if(route==='engine/errors')return send(res,200,{generatedAt:scan.generatedAt,count:(scan.errors||[]).length,errors:(scan.errors||[]).slice(0,500)});

  const m=route.match(/^stock\/([^/]+)\/analysis$/);
  if(m){const x=(scan.all||[]).find(r=>r.symbol===m[1].toUpperCase());return x?send(res,200,x):send(res,404,{error:'SYMBOL_NOT_FOUND'});}
  const h=route.match(/^stock\/([^/]+)\/history$/);
  if(h){
    const symbol=h[1].toUpperCase(),history=await loadHistory(),hist=history.value||{runs:[],recommendations:[]};
    return send(res,200,{symbol,history:(hist.recommendations||[]).filter(r=>r.symbol===symbol).slice(-200).reverse(),source:history.source,sourceError:history.error});
  }
  return send(res,404,{error:'ROUTE_NOT_FOUND',route});
}
