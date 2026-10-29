'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.resolve(__dirname,'../../scripts/stable/v15-recommendation-evaluator.cjs'),'utf8');
const begin=source.indexOf('function isEntered(record)');
const end=source.indexOf('function byStrategy(records)');
if(begin<0||end<=begin)throw new Error('V15 evaluator summary functions not found');
const evaluateSummary=vm.runInNewContext(source.slice(begin,end)+'\nsummarize;', {num:(v,fallback=null)=>v===null||v===undefined||v===''?fallback:Number(v),round:(v,digits=4)=>Number(Number(v).toFixed(digits))});
test('session gaps are visible and excluded from performance denominator',()=>{
 const rows=[
  {evaluationStatus:'TARGET_HIT',entryDate:'2026-10-26',netReturnPct:2},
  {evaluationStatus:'STOP_HIT',entryDate:'2026-10-26',netReturnPct:-1},
  {evaluationStatus:'HISTORY_SESSION_GAP',dataGapReason:'SYMBOL_SESSION_GAP'},
  {evaluationStatus:'AWAITING_NEXT_SESSION'}
 ];
 const r=evaluateSummary(rows);
 assert.equal(r.archivedRecommendations,4);
 assert.equal(r.unverifiedHistoryGap,1);
 assert.equal(r.unverifiableOutcomeExcluded,1);
 assert.equal(r.resolvedTrades,2);
 assert.equal(r.resolvedTradesWithNetReturn,2);
 assert.equal(r.successRatePct,50);
 assert.equal(r.averageNetReturnPct,0.5);
});

test('target hit with net loss after costs must not count as winning trade',()=>{
 const r=evaluateSummary([
  {evaluationStatus:'TARGET_HIT',entryDate:'2026-10-26',netReturnPct:-0.25},
  {evaluationStatus:'EXPIRED_POSITIVE',entryDate:'2026-10-26',netReturnPct:0.5},
  {evaluationStatus:'TARGET_HIT',entryDate:'2026-10-26',netReturnPct:null}
 ]);
 assert.equal(r.resolvedTrades,3);
 assert.equal(r.resolvedTradesWithNetReturn,2);
 assert.equal(r.profitableResolvedTrades,1);
 assert.equal(r.losingResolvedTrades,1);
 assert.equal(r.missingNetReturnResolvedTrades,1);
 assert.equal(r.successRatePct,50);
});
