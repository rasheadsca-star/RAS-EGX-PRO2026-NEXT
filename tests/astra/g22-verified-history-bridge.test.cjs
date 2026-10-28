'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {reconcile,independentlyDated}=require('../../scripts/astra/g22-verified-history-bridge.cjs');
const bar=(date,close,overrides={})=>({ticker:'AALR',date,sourceSessionDate:date,open:close,high:close,low:close,close,volume:100,validationStatus:'precise_public_source_session_confirmed',sourceSessionEvidence:'mubasher_page_last_update',sourceUrls:{primary:'https://english.mubasher.info/markets/EGX/stocks/AALR/'},warnings:[],...overrides});
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'g22-history-bridge-'));
 const prod=path.join(root,'prod'),cert=path.join(root,'cert');
 for(const dir of [prod,cert]){fs.mkdirSync(path.join(dir,'data/history'),{recursive:true});fs.mkdirSync(path.join(dir,'data/stable'),{recursive:true});}
 const put=(base,name,value)=>fs.writeFileSync(path.join(base,name),JSON.stringify(value));
 put(prod,'data/stable/v15-price-truth.json',{expectedSession:'2026-10-27',ready:true,executionGrade:true,acceptedRows:2,rejectedRows:1,droppedRows:0,source:{inputRows:3,verifiedExpectedSessionRows:3,sourceSessionEvidenceCoveragePct:100}});
 put(prod,'data/fetch-status.json',{expectedSession:'2026-10-27',ok:true,executionGrade:true,marketRows:2,currentSessionRows:2,rejectedCurrentSessionRows:1,droppedCurrentSessionRows:0,inputRows:3,sourceSessionVerifiedRows:3,sourceSessionEvidenceCoveragePct:100,coveragePct:66.67});
 const identity={ticker:'AALR',symbolVerified:true,isin:'EGS01081C016',currency:'EGP'};
 put(cert,'data/history/AALR.json',{...identity,sessions:[bar('2026-09-17',315,{validationStatus:'starta_exact_egx_source_validated'})]});
 put(prod,'data/history/AALR.json',{...identity,isin:null,sessions:[bar('2026-09-20',306),bar('2026-10-25',301,{warnings:['partial_ohlc_reconstructed_from_close_or_previous_close']}),bar('2026-10-26',189),bar('2026-10-27',205)]});
 return {root,prod,cert,put};
}
test('bridges independently dated intervening bars without treating September-to-October as a daily move',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 const result=reconcile({prodRoot:f.prod,certRoot:f.cert});
 assert.equal(result.addedBars,2);assert.equal(result.rejectedBars,1);
 const rows=JSON.parse(fs.readFileSync(path.join(f.cert,'data/history/AALR.json'))).sessions;
 assert.deepEqual(rows.map(x=>x.date),['2026-09-17','2026-09-20','2026-10-26']);
 assert.equal(rows.at(-1).close,189);
 assert.equal(reconcile({prodRoot:f.prod,certRoot:f.cert}).addedBars,0);
});
test('does not silently overwrite conflicting certified bars',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 const filename=path.join(f.cert,'data/history/AALR.json');const j=JSON.parse(fs.readFileSync(filename));j.sessions.push(bar('2026-09-20',999));fs.writeFileSync(filename,JSON.stringify(j));
 const r=reconcile({prodRoot:f.prod,certRoot:f.cert});assert.equal(r.addedBars,1);
 assert.equal(JSON.parse(fs.readFileSync(filename)).sessions.find(x=>x.date==='2026-09-20').close,999);
});
test('rejects missing source identity and inconsistent price truth',t=>{
 const f=fixture();t.after(()=>fs.rmSync(f.root,{recursive:true,force:true}));
 const filename=path.join(f.prod,'data/history/AALR.json');const j=JSON.parse(fs.readFileSync(filename));j.symbolVerified=false;fs.writeFileSync(filename,JSON.stringify(j));
 assert.equal(reconcile({prodRoot:f.prod,certRoot:f.cert}).identityRejected,1);
 const truth=path.join(f.prod,'data/stable/v15-price-truth.json');const p=JSON.parse(fs.readFileSync(truth));p.acceptedRows=3;fs.writeFileSync(truth,JSON.stringify(p));
 assert.throws(()=>reconcile({prodRoot:f.prod,certRoot:f.cert}),/SOURCE_TRUTH_MISMATCH/);
});
test('rejects reconstructed, stale, impossible and undocumented OHLCV',()=>{
 assert.equal(independentlyDated(bar('2026-10-26',10)),true);
 assert.equal(independentlyDated(bar('2026-10-26',10,{sourceSessionDate:'2026-10-25'})),false);
 assert.equal(independentlyDated(bar('2026-10-26',10,{open:12,high:11})),false);
 assert.equal(independentlyDated(bar('2026-10-26',10,{warnings:['partial_ohlc_reconstructed_from_close_or_previous_close']})),false);
 assert.equal(independentlyDated(bar('2026-10-26',10,{sourceUrls:{}})),false);
});
