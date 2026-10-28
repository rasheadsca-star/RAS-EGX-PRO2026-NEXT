'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const json=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
test('latest viewer is a research-only live-source view, not an execution interface',()=>{
 const html=fs.readFileSync(path.join(root,'latest-viewer/index.html'),'utf8');
 assert.match(html,/data\/stable\/v16-main-app-current\.json/);
 assert.match(html,/data\/quant\/daily-recommendations\.json/);
 assert.match(html,/cache:'no-store'/);
 assert.match(html,/مراقبة فقط/);
 assert.doesNotMatch(html,/fetch\([^\n]*\/api\/order/);
});
test('canonical source dates agree and display data has a dated provenance',()=>{
 const main=json('data/stable/v16-main-app-current.json');
 const quant=json('data/quant/daily-recommendations.json');
 const price=json('data/stable/v15-price-truth.json');
 for(const d of [main.sessionDate,quant.sessionId,price.expectedSession])
   assert.match(String(d),/^\d{4}-\d{2}-\d{2}$/);
 assert.equal(main.sessionDate,price.expectedSession,'main and price truth sessions diverged');
 assert.equal(quant.sessionId,price.expectedSession,'quant and price truth sessions diverged');
 assert.ok(Array.isArray(main.researchWatchlist),'main watchlist must exist');
 assert.ok(Array.isArray(quant.watchCandidates),'quant watchlist must exist');
 assert.notEqual(main.executionReady,true,'research route must not claim certified execution');
 assert.notEqual(main.practicalReady,true,'main gate cannot be bypassed in viewer');
 assert.notEqual(quant.liveExecutionEnabled,true,'quant feed must not enable live orders');
});

test('missing prices never render as zero, dates and source state stay visible',()=>{
 const html=fs.readFileSync(path.join(root,'latest-viewer/index.html'),'utf8');
 assert.match(html,/n===null\|\|n===undefined/,'missing numbers must remain unavailable');
 assert.match(html,/latest\.date!==today\(\)/,'stale session must be visible');
 assert.match(html,/String\(y\.generated\|\|''\)/,'same-date source selection must be deterministic');
 assert.match(html,/researchWatchlist/);
 assert.match(html,/watchCandidates/);
});
