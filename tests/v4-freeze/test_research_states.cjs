const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const e=require('../../paper-v4/research/engine.js');const snapshot=JSON.parse(fs.readFileSync(path.join(__dirname,'../../paper-v4/research/snapshot.json'),'utf8'));
test('snapshot is explicitly partial and V4 original remains frozen',()=>{assert.equal(snapshot.universeTotal,217);assert.equal(snapshot.rows.length,7);assert.equal(snapshot.mode,'RESEARCH_ONLY');assert.equal(snapshot.session,'2026-10-29')});
test('AMOC retained as frozen and qualified Multi-Factor',()=>{const r=e.rank(snapshot).find(x=>x.ticker==='AMOC');assert.equal(r.state,e.STATES.FROZEN);assert.equal(r.why,'FROZEN_AND_PASSED_RESEARCH_FILTER')});
test('ENGC remains unverified research watch not authorized buy',()=>{const r=e.rank(snapshot).find(x=>x.ticker==='ENGC');assert.equal(r.state,e.STATES.WATCH);assert.equal(r.why,'OFFICIAL_CLOSE_REVIEW_REQUIRED')});
test('nonfrozen strict multi-factor becomes research watch not investment order',()=>{const r=e.classify({ticker:'ABCD',historyEligible:true,evidence:'DIRECT_OFFICIAL_CLOSE',multiFactorPass:true,volatilityPass:true,frozenRecommendation:false});assert.equal(r.state,e.STATES.WATCH)});
test('reject stale or incomplete history',()=>{const r=e.classify({ticker:'ABCD',historyEligible:false,frozenRecommendation:false});assert.equal(r.state,e.STATES.INELIGIBLE)});
test('reject duplicated symbols',()=>{assert.throws(()=>e.rank({...snapshot,rows:[snapshot.rows[0],snapshot.rows[0]]}),/Duplicate/)});
test('reject lookahead: not a later session',()=>{assert.throws(()=>e.forwardGuard({ticker:'AMOC',session:'2026-10-29',referenceClose:14,mode:'RESEARCH_ONLY'},{ticker:'AMOC',session:'2026-10-29',close:14.5,evidence:'DIRECT_OFFICIAL_CLOSE'}),/later/)});
test('reject missing official confirmation',()=>{assert.throws(()=>e.forwardGuard({ticker:'AMOC',session:'2026-10-29',referenceClose:14,mode:'RESEARCH_ONLY'},{ticker:'AMOC',session:'2026-11-01',close:14.5,evidence:'UNVERIFIED_CLOSE'}),/official/)});
test('compute only later officially verified illustrative observation',()=>{const r=e.forwardGuard({ticker:'AMOC',session:'2026-10-29',referenceClose:14,mode:'RESEARCH_ONLY'},{ticker:'AMOC',session:'2026-11-01',close:14.7,evidence:'DIRECT_OFFICIAL_CLOSE'});assert.equal(r.returnPct,5);assert.equal(r.noOrders,true)});
test('reject invalid price',()=>{assert.throws(()=>e.forwardGuard({ticker:'AMOC',session:'2026-10-29',referenceClose:14,mode:'RESEARCH_ONLY'},{ticker:'AMOC',session:'2026-11-01',close:0,evidence:'DIRECT_OFFICIAL_CLOSE'}),/Invalid/)});
test('parse read-only 217-rows CSV format',()=>{const head='ticker,last_session,last_close,last_close_evidence,history_rows,score,volatility20_pct,base_multifactor,volatility_pass,filtered_multifactor,frozen_seed_29oct';const s=head+'\nAMOC,2026-10-29,14,DIRECT_OFFICIAL_CLOSE,2353,63.9,2.9397,True,True,True,True';const x=e.normalizeCSV(s);assert.equal(x.rows[0].multiFactorPass,true);assert.equal(x.rows[0].frozenRecommendation,true);assert.equal(x.rows[0].historyEligible,true)});
test('prevent any real order instruction in HTML snapshot',()=>{const page=fs.readFileSync(path.join(__dirname,'../../paper-v4/research/index.html'),'utf8');assert.match(page,/RESEARCH ONLY/);assert.match(page,/لا توجد أوامر شراء حقيقية/);assert.doesNotMatch(page,/astra-prod/);});

test('full 217-stock research snapshot decompresses and validates exact counts',()=>{
 const encoded=fs.readFileSync(path.join(__dirname,'../../paper-v4/research/universe-217.gzip.base64.txt'),'utf8').trim();
 const raw=require('node:zlib').gunzipSync(Buffer.from(encoded,'base64')).toString('utf8');
 const all=e.expandCompact(JSON.parse(raw));assert.equal(all.rows.length,217);assert.equal(all.eligibleHistory,148);assert.equal(all.volatilityQualified,117);
 assert.equal(all.rows.find(x=>x.ticker==='AMOC').multiFactorPass,true);
 assert.equal(all.rows.find(x=>x.ticker==='ENGC').evidence,'UNVERIFIED_CLOSE');
 assert.equal(e.rank(all).length,217);
});

test('manual future close cannot claim official verification or OOS certification',()=>{
 const signal={ticker:'AMOC',session:'2026-10-29',referenceClose:14,mode:'RESEARCH_ONLY'};
 const r=e.manualScenario(signal,{ticker:'AMOC',session:'2026-11-01',close:14.7,evidence:'DIRECT_OFFICIAL_CLOSE'});
 assert.equal(r.returnPct,5);assert.equal(r.evidence,'USER_ENTERED_UNVERIFIED');
 assert.equal(r.performanceCertified,false);assert.equal(r.oosCertified,false);assert.equal(r.noOrders,true);
 assert.throws(()=>e.manualScenario(signal,{ticker:'AMOC',session:'2026-10-29',close:15}),/later/);
 const html=fs.readFileSync(path.join(__dirname,'../../paper-v4/research/index.html'),'utf8');
 assert.doesNotMatch(html,/<option value="DIRECT_OFFICIAL_CLOSE">/);
 assert.match(html,/EGXResearch\.manualScenario/);
});
test('V4 banner session-date validation actually accepts ISO session',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../../paper-v4/index.html'),'utf8');
 const match=html.match(/if\(!(.+?)\.test\(d\.lastVerifiedMarketSession\)/);
 assert.ok(match,'status banner date-validation expression missing');
 const re=require('node:vm').runInNewContext(match[1]);
 assert.equal(re.test('2026-10-29'),true);
 assert.equal(re.test('not-a-date'),false);
});
