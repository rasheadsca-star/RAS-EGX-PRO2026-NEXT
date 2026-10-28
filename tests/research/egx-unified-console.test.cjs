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
 assert.ok(by('marketStatus').textContent.includes('غير معتمد'));
 assert.ok(by('paperLedger').textContent.includes('أوامر تداول: صفر'));
});
