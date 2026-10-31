'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const html=fs.readFileSync('unified-console/index.html','utf8');
test('unified console references actual stored source files',()=>{for(const p of ['data/stable/v15-price-truth.json','data/ops/g22-main-app-handoff.json','astra-prod/app/data.json','unified-console/gann-research.json'])assert.ok(html.includes(p));});
test('stale Astra plans are labeled archived and cannot claim live',()=>{assert.ok(html.includes('aDate===market'));assert.ok(html.includes('أرشيفية — غير صالحة'));assert.ok(html.includes('التنفيذ الآلي والتداول الورقي التنفيذي مغلقان'));});
test('safe rendering uses textContent and no dynamic innerHTML',()=>{assert.ok(html.includes('textContent'));assert.ok(!html.includes('.innerHTML='));});

test('Pages workflow enforces live independent archive and zero-order ledger E2E',()=>{
 const yml=fs.readFileSync('.github/workflows/static.yml','utf8');
 assert.ok(yml.includes('INDEPENDENT_PAPER_LIVE_E2E_PASS'));
 assert.ok(yml.includes('/unified-console/independent-last-verified.json'));
 assert.ok(yml.includes('/unified-console/independent-paper-ledger.json'));
 assert.ok(yml.includes("ledger['orders'] == []"));
});

test('MVP renders dated last-known-good archive rows separately from current research signals',()=>{
 assert.ok(html.includes('id="archivedPriceResults"'));
 assert.ok(html.includes('archive.datedPriceObservations.filter'));
 assert.ok(html.includes("p.session===archive.session"));
 assert.ok(html.includes('أرشيف فقط — ليس سعر اليوم ولا إشارة دخول'));
 assert.ok(html.includes('archive.recommendations.length===0'));
 assert.ok(html.includes('archive.orders.length===0'));
});

test('MVP render E2E: archived prices survive failed fetch and blockers are visible without orders',async()=>{
 const elements=new Map();
 class Element{
  constructor(){this.textContent='';this.children=[];this.listeners={};}
  appendChild(x){this.children.push(x);return x}
  replaceChildren(...x){this.children=x}
  addEventListener(k,f){this.listeners[k]=f}
 }
 const by=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
 const document={getElementById:by,createElement:()=>new Element()};
 const fetch=async url=>{
  const relative=String(url).split('?')[0].replace(/^\.\.\//,'');
  const data=JSON.parse(fs.readFileSync(path.join(process.cwd(),relative),'utf8'));
  return {ok:true,json:async()=>data};
 };
 const code=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(code,'inline console script must exist');
 const context={document,fetch,console};
 vm.runInNewContext(code+';globalThis.__refreshForTest=refresh;',context);
 await context.__refreshForTest();
 const archive=JSON.parse(fs.readFileSync('unified-console/independent-last-verified.json','utf8'));
 const current=JSON.parse(fs.readFileSync('unified-console/independent-paper.json','utf8'));
 const archiveRows=by('archivedPriceResults').children;
 assert.equal(archiveRows.length,archive.datedPriceObservations.length);
 assert.ok(archiveRows.length>0);
 for(const row of archiveRows){
  const rendered=row.children.map(x=>x.textContent).join(' | ');
  assert.ok(rendered.includes('أرشيف فقط — ليس سعر اليوم ولا إشارة دخول'));
 }
 const observations=by('datedPriceResults').children;
 if(current.datedPriceObservations.length){
  assert.equal(observations.length,Math.min(30,current.datedPriceObservations.length));
  for(const row of observations){
   const cells=row.children.map(x=>x.textContent);
   assert.equal(cells.length,7);
   if(cells[5]==='تاريخ غير مكتمل — لا إشارة')
    assert.notEqual(cells[6],'لا مانع فني؛ الاعتماد العام مطلوب');
  }
 }
 assert.ok(by('independentBlockers').textContent.includes('أسباب الحجب'));
 assert.ok(by('astraStatus').textContent.includes('أرشيفي'));
 const truth=JSON.parse(fs.readFileSync('data/stable/v15-price-truth.json','utf8'));
 const priceReady=truth.ready===true&&truth.executionGrade===true&&Number.isInteger(truth.acceptedRows)&&truth.acceptedRows>0;
 const fetched=JSON.parse(fs.readFileSync('data/fetch-status.json','utf8'));
 const fetchReady=fetched.ok===true&&fetched.marketRows>0&&/^\\d{4}-\\d{2}-\\d{2}$/.test(fetched.expectedSession);
 assert.equal(by('marketDate').textContent,fetchReady?fetched.expectedSession:truth.expectedSession);
 if(fetchReady){
  assert.ok(by('marketStatus').textContent.includes(fetched.expectedSession));
  if(fetched.expectedSession!==truth.expectedSession)
   assert.ok(by('marketStatus').textContent.includes('لا اعتماد تداول'));
 }else assert.ok(by('marketStatus').textContent.includes(priceReady?'أسعار مؤرخة اجتازت بوابة المصدر':'غير معتمد'));
 assert.ok(by('paperLedger').textContent.includes('أوامر تداول: صفر'));
 const radar=by('researchRadarResults').children;
 const v16=JSON.parse(fs.readFileSync('data/stable/v16-main-app-current.json','utf8'));
 const quant=JSON.parse(fs.readFileSync('data/quant/daily-recommendations.json','utf8'));
 const gann=JSON.parse(fs.readFileSync('unified-console/gann-research.json','utf8'));
 const sources=[
  {name:'V16',session:v16.sessionDate,items:v16.researchWatchlist||[]},
  {name:'Quant',session:quant.sessionId,items:quant.status==='WATCH_ONLY'?quant.watchCandidates||[]:[]},
  {name:'Gann',session:gann.sourceSession,items:gann.reviewPassed===true?gann.watchRadar||[]:[]}
 ];
 const expected=[...new Set(sources.flatMap(s=>s.items.map(x=>x.ticker).filter(Boolean)))];
 if(!expected.length){
  assert.equal(radar.length,1,'zero research candidates must render one explanatory placeholder');
  assert.equal(radar[0].children[0].textContent,'لا توجد قوائم متابعة بحثية مؤرخة');
 }else{
  assert.equal(radar.length,expected.length,'one dated research row per unique ticker');
  const tickers=radar.map(row=>row.children[0].textContent);
  assert.equal(new Set(tickers).size,radar.length,'one row per ticker, never duplicate signals');
  const sourceLabel=(name,sourceSession)=>name+' '+sourceSession+
   (sourceSession===truth.expectedSession?'':' (أرشيف)');
  for(const source of sources)for(const candidate of source.items){
   const row=radar.find(r=>r.children[0].textContent===candidate.ticker);
   assert.ok(row,'missing radar row for '+candidate.ticker);
   assert.ok(row.children[1].textContent.includes(sourceLabel(source.name,source.session)),
    'missing source/date label for '+candidate.ticker+' from '+source.name);
   const observation=current.datedPriceObservations.find(p=>p.ticker===candidate.ticker&&p.session===source.session);
   if(observation&&observation.indicatorReady!==true)
    assert.ok(row.children[2].textContent.includes('مؤشرات OHLCV محجوبة'),
     'unverified indicators must stay blocked for '+candidate.ticker);
  }
  for(const row of radar)assert.equal(row.children[3].textContent,'RESEARCH_ONLY — لا أمر ولا اعتماد تنفيذ');
 }
 const health=JSON.parse(fs.readFileSync('data/source-health.json','utf8'));
 const fetchStatus=JSON.parse(fs.readFileSync('data/fetch-status.json','utf8'));
 if(fetchStatus.marketRows+fetchStatus.rejectedCurrentSessionRows===fetchStatus.inputRows)
  assert.ok(by('sourceHealthInfo').textContent.includes(fetchStatus.marketRows+' / '+fetchStatus.inputRows));
 assert.ok(by('sourceHealthInfo').textContent.includes(health.coveragePct.toFixed(1)+'%'));
 assert.ok(by('sourceHealthInfo').textContent.includes('تأخر المصدر: '+(health.delayed?'نعم':'لا')));
 assert.ok(by('researchRadarIntro').textContent.includes('executionReady='+String(v16.executionReady===true)));
});

test('unified MVP consumes V16 and Quant source dates without V16 probability-as-calibration',()=>{
 assert.ok(html.includes('data/stable/v16-main-app-current.json'));
 assert.ok(html.includes('data/quant/daily-recommendations.json'));
 assert.ok(html.includes('data/source-health.json'));
 assert.ok(html.includes('data/fetch-status.json'));
 assert.ok(html.includes('accepted/inputRows'));
 assert.ok(html.includes('researchRadarResults'));
 assert.ok(html.includes('RESEARCH_ONLY — لا أمر ولا اعتماد تنفيذ'));
 assert.ok(!html.includes('hasValidatedProbability'));
 assert.ok(!html.includes('probabilityTop10Pct'));
});

test('MVP displays reproducible OHLCV audit counts separately from paper recommendations',async()=>{
 assert.ok(html.includes('history-quality-audit.json'));
 assert.ok(html.includes('id="historyAuditSummary"'));
 assert.ok(html.includes('id="historyAuditTop10"'));
 const elements=new Map();
 class Element{constructor(){this.textContent='';this.children=[];this.listeners={}}
  appendChild(x){this.children.push(x);return x}
  replaceChildren(...x){this.children=x}
  addEventListener(k,f){this.listeners[k]=f}}
 const by=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)};
 const report={schemaVersion:'egx-history-quality-audit-v1',mode:'RESEARCH_ONLY',
  executionReady:false,performanceCertified:false,auditDate:'2026-10-28',
  generatedAt:'2026-10-28T20:00:00Z',inputsSha256:'abcd1234',
  calendar:{officialExchangeCalendar:false,latest:'2026-10-28'},
  summary:{historyFiles:201,rawInputRows:8000,structuralAcceptedRows:5000,
   strictAcceptedRows:100,medianLongestStrictConsecutive:3,medianTrailingAtOwnLatestSourceProvenance:3,medianLongestSourceProvenanceConsecutive:13,
   currentEligibility:{structural60:8,strict60:0,structural140:0,strict140:0}},
  tickers:[{ticker:'TEST'}],
  top10Recovery:[{ticker:'TEST',latestSession:'2026-10-28',structuralTrailing:8,
   strictTrailing:3,isinChecksumValid:true,licenseStatus:'NO_EXPLICIT_USAGE_RIGHTS'}]};
 const fetch=async url=>{
  const relative=String(url).split('?')[0].replace(/^\.\.\//,'');
  const data=relative==='unified-console/history-quality-audit.json'?report:
   JSON.parse(fs.readFileSync(path.join(process.cwd(),relative),'utf8'));
  return {ok:true,json:async()=>data};
 };
 const code=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 const context={document:{getElementById:by,createElement:()=>new Element()},fetch,console};
 vm.runInNewContext(code+';globalThis.__refreshForTest=refresh;',context);
 await context.__refreshForTest();
 assert.ok(by('historyAuditSummary').textContent.includes('8000'));
 assert.ok(by('historyAuditSummary').textContent.includes('صارم 0'));
 assert.ok(by('historyAuditCalendar').textContent.includes('لا أيام تقويمية'));
 assert.equal(by('historyAuditTop10').children.length,1);
 assert.ok(by('historyAuditTop10').children[0].children.some(x=>x.textContent==='حقوق الاستخدام غير موثقة'));
 assert.ok(by('paperLedger').textContent.includes('أوامر تداول: صفر'));
});
