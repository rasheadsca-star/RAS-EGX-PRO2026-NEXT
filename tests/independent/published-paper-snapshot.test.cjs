'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {validArchive,validLedger}=require('../../scripts/independent/preserve-verified-paper.cjs');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
test('published paper archive and ledger exist and remain non-executable',()=>{
 const archive=read('unified-console/independent-last-verified.json');
 const ledger=read('unified-console/independent-paper-ledger.json');
 const current=read('unified-console/independent-paper.json');
 assert.equal(validArchive(archive),true);
 assert.equal(validLedger(ledger),true);
 assert.equal(current.mode,'PAPER_ONLY');
 assert.equal(current.executable,false);
 assert.deepEqual(current.recommendations,[]);
 assert.deepEqual(archive.orders,[]);
 assert.deepEqual(ledger.orders,[]);
 for(const r of archive.datedPriceObservations)
  assert.ok(ledger.observations.some(x=>x.session===r.session&&x.ticker===r.ticker&&x.close===r.close),
   r.ticker+' archived observation missing from ledger');
});
test('unified console distinguishes archived prices and paper observations from signals',()=>{
 const html=fs.readFileSync('unified-console/index.html','utf8');
 for(const p of ['unified-console/independent-last-verified.json','unified-console/independent-paper-ledger.json'])
  assert.ok(html.includes(p),p);
 assert.ok(html.includes('أرشيف فقط'));
 assert.ok(html.includes('أوامر تداول: صفر'));
 assert.ok(html.includes('التنفيذ الآلي والتداول الورقي التنفيذي مغلقان'));
});

test('MVP archive table remains available even when current price fetch is blocked',()=>{
 const html=fs.readFileSync('unified-console/index.html','utf8');
 const current=read('unified-console/independent-paper.json');
 const archive=read('unified-console/independent-last-verified.json');
 assert.equal(current.inputs.aggregatePriceReady,false);
 assert.ok(archive.datedPriceObservations.length>0);
 assert.ok(html.includes('id="archivedPriceResults"'));
 assert.ok(html.includes('archiveRows=archiveOK?archive.datedPriceObservations.filter'));
 assert.ok(html.includes('أرشيف فقط — ليس سعر اليوم ولا إشارة دخول'));
});
