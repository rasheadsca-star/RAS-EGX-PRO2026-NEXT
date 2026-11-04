'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const js=fs.readFileSync(path.join(root,'paper-v4/decision-dashboard.js'),'utf8');
const data=read('paper-v4/latest-ranking.json');
const audit=read('paper-v4/market-rules-audit.json');
test('no published live orders or official claims',()=>{
 assert.equal(data.qualifiedTradeCount,0);
 assert.equal(data.source.officialSessionVerified,false);
 assert.equal(data.source.isinIndependentlyCertified,false);
 assert.match(data.mode,/RESEARCH/);
 assert.ok(data.rows.length>0);
 for(const row of data.rows){
  assert.equal(row.sourceSession,data.session);
  assert.equal(row.recommendation,'WATCH_ONLY');
  assert.equal(row.identityApproved,false);
  assert.equal(row.officialCloseVerified,false);
  assert.ok(['SECONDARY_PUBLIC','OFFICIAL_REPORT_CLOSE_RESEARCH_ONLY'].includes(row.priceSource),'Unrecognized quote provenance');
  if(row.priceSource==='OFFICIAL_REPORT_CLOSE_RESEARCH_ONLY'){
    assert.equal(row.closeOnlySession,true);
    assert.equal(row.closeFromDatedOfficialPdf,true);
    assert.equal(data.source.officialCloseEvidencePresent,true);
    assert.equal(row.officialCloseVerified,false); // identity and full OHLC still not approved
  }
 }
});
test('every numeric plan has valid tick-rounded stop/entry/targets and nonexecutability',()=>{
 let numeric=0;
 for(const row of data.rows)for(const s of row.scenarios){
  assert.equal(s.isExecutable,false);
  if(!Number.isFinite(s.entry)){
   assert.match(s.status,/^REJECTED_/);continue;
  }
  numeric++;
  assert.ok(s.stop<s.entry&&s.entry<s.target1&&s.target1<s.target2,row.ticker);
  const risk=s.entry-s.stop;
  assert.ok(risk/s.entry>.00349&&risk/s.entry<=.120001,row.ticker);
  assert.ok(Math.abs((s.target1-s.entry)/risk-s.rewardRisk1)<.0011,row.ticker);
  assert.ok(Math.abs((s.target2-s.entry)/risk-s.rewardRisk2)<.0011,row.ticker);
  assert.equal(s.executionGuards.isinConfirmed,false);
  assert.equal(s.executionGuards.instrumentPriceLimitConfirmed,false);
 }
 assert.ok(numeric>0,'No numeric scenarios to test');
});
test('market audit matches current research rows',()=>{
 assert.equal(audit.session,data.session);
 assert.equal(audit.rows,data.rows.length);
 assert.equal(audit.failures.length,0);
 assert.equal(audit.status,'RESEARCH_ONLY_NOT_EXECUTION_APPROVED');
});
test('UI fail-closes stale, conflicting and unavailable chart evidence',()=>{
 for(const fragment of ['expectedSession','isRankingStale','plans.hidden=true','plans.hidden=stale||Boolean(mismatch)||(!last&&!closeOnlyEvidence)','RAW_RANKING','validRanking','GitHub main','Vercel static']){
  assert.ok(js.includes(fragment),'Missing UI guard '+fragment);
 }
 assert.ok(!js.includes("get('./preliminary-ranking-2026-11-03.json')"),'Hardcoded stale fallback forbidden');
});
