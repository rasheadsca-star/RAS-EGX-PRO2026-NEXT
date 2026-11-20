'use strict';
// Run with: node --test runtime-regression.test.cjs
// Loads the REAL checked-out PR scripts in an isolated Node VM with a minimal DOM.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const repo=process.env.EGX_REPO||process.cwd();
const src=n=>fs.readFileSync(path.join(repo,'paper-v4',n),'utf8');
const guardSrc=src('research-guards.js');
const enhancedSrc=src('decision-enhancements.js');
const dashSrc=src('decision-dashboard.js');
const quoteSrc=src('official-quotes-dashboard.js');
const pdf=JSON.parse(src('official-session-latest.json'));

const frozenDate=class extends Date {
 constructor(...args){super(...(args.length?args:['2026-11-07T19:00:00Z']))}
 static now(){return Date.parse('2026-11-07T19:00:00Z')}
};

test('same expected-session logic is shared across dashboard and enhancement; weekend + verified holiday handled',()=>{
 const ctx=vm.createContext({Date:frozenDate,Intl,console});
 vm.runInContext(guardSrc,ctx);
 const g=ctx.EGXResearchGuards;
 assert.equal(g.expectedSession(),'2026-11-05');
 assert.equal(g.expectedSession(new Date('2026-11-05T18:00:00Z'),['2026-11-05']),'2026-11-04');
 assert.match(enhancedSrc,/EGXResearchGuards\.expectedSession\(\)/);
 assert.match(dashSrc,/EGXResearchGuards\.expectedSession\(\)/);
 assert.equal(g.isCurrentReport({session:'2026-11-04',quotes:[{}]},g.expectedSession()),false);
});

test('all paper-v4 resources are branch-relative and cannot silently read main',()=>{
 for(const content of [dashSrc,enhancedSrc,quoteSrc])
  assert.doesNotMatch(content,/raw\.githubusercontent\.com\/rasheadsca-star\/RAS-EGX-PRO2026-NEXT\/main\//);
 assert.match(dashSrc,/official\.sourceHash===state\.snapshot\.source\.documentSha256/);
});

test('pdf row 152 suggests EHDR, never eligible for trading',()=>{
 const row=pdf.quotes.find(x=>x.rowNumber===152);
 assert.equal(row.ticker,'EHDR');assert.equal(row.identityVerified,false);
 assert.equal(row.matching,'EVIDENCE_SUGGESTED_UNVERIFIED');
 const ctx=vm.createContext({Date:frozenDate,Intl});vm.runInContext(guardSrc,ctx);
 assert.equal(ctx.EGXResearchGuards.eligible(row),false);
});

test('actual analyst script loads a stock and renders chart + metrics without last ReferenceError', async()=>{
 const elements=new Map();
 class FakeElement {
  constructor(id){this.id=id;this.innerHTML='';this.textContent='';this.style={};this.value=id==='exCapital'?'100000':id==='exRisk'?'0.5':'';this.dataset={}}
  addEventListener(){}
  querySelectorAll(){return []}
  replaceChildren(){this.innerHTML='';this.textContent=''}
  getBoundingClientRect(){return {width:900,left:0,top:0}}
 }
 const element=id=>{if(!elements.has(id))elements.set(id,new FakeElement(id));return elements.get(id)};
 const document={getElementById:element,querySelectorAll:()=>[]};
 const bars=Array.from({length:65},(_,i)=>{
  const date=new Date(Date.UTC(2026,7,1+i)).toISOString().slice(0,10);
  // Explicitly synthetic fixture; no real EGX prices, returns, or performance.
  return {date,open:10,high:11,low:9,close:10,volume:1000};
 });
 const requested=[];
 const fetch=async url=>{
  requested.push(url);
  const key=String(url).split('?')[0];
  const payload=key.endsWith('data/market.json')?{rows:[{symbol:'ABUK',name_en:'Synthetic fixture'}],updatedAt:'2026-11-05'}:
    key.endsWith('data/fundamentals/v16-fundamental-raw.json')?{records:{}}:
    key.endsWith('paper-v4/official-session-latest.json')?{session:'2026-11-05',quotes:[]}:
    key.endsWith('data/history/ABUK.json')?{sessions:bars,primarySource:'synthetic-test-fixture'}:null;
  return {ok:payload!==null,status:payload===null?404:200,json:async()=>payload};
 };
 const ctx=vm.createContext({Date:frozenDate,Intl,window:null,document,fetch,console,Map,Set,Number,String,Math,Promise,Array,RegExp});ctx.window=ctx;
 vm.runInContext(guardSrc,ctx);
 vm.runInContext(enhancedSrc,ctx);
 for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.match(element('exChart').innerHTML,/<svg\b/);
 assert.match(element('exMetrics').innerHTML,/MA20/);
 assert.match(element('exMetrics').innerHTML,/RSI14/);
 assert.doesNotMatch(element('exWarning').textContent,/last is not defined|ReferenceError/);
 assert.ok(requested.every(url=>!url.includes('raw.githubusercontent.com')));
});
