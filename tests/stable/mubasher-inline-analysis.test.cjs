'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseInlineRows,explicitSession,literalArray}=require('../../scripts/stable/mubasher-inline-analysis.cjs');
const {parseHtmlRows}=require('../../scripts/collect-mubasher-analysis-tools.js');
test('observed liquidity inline dataset supplies exact session and stays supporting same-provider evidence',()=>{
 const h="<script>window.midata.liquidityMonitors = [{'lastPrice':122.8,'turnover':7.64171968E8,'updatedAt':'27 أكتوبر 2026','url':'/markets/EGX/stocks/COMI','name':'سي أي بي'}];</script>";
 const row=parseInlineRows(h,'liquidity','https://www.mubasher.info/analysis-tools/liquidity-monitor/EGX','2026-10-27')[0];
 assert.equal(row.symbol,'COMI');assert.equal(row.raw.turnover,764171968);assert.equal(row.sourceSessionDate,'2026-10-27');
 assert.equal(row.independentSource,false);assert.equal(row.executionGrade,false);assert.equal(row.raw.open,undefined);
 assert.equal(parseHtmlRows(h,{id:'liq',group:'liquidity'},new Set(['COMI'])).length,1);
});
test('time label lacking explicit year cannot be relabeled current',()=>{
 const h="window.midata.volumes = [{'volume':4602752,'updatedAt':'27 أكتوبر 11:27 ص','url':'/markets/EGX/stocks/CCRS'}];";
 const row=parseInlineRows(h,'volume','url','2026-10-27')[0];assert.equal(row.sourceSessionDate,null);assert.equal(row.sourceSessionStatus,'EXPLICIT_YEAR_OR_DATE_MISSING');
 assert.equal(explicitSession('٣١ فبراير ٢٠٢٦'),null);
});
test('provider misspelled supportRisistance key is read without executing scripts',()=>{
 const h="window.midata.supportRisistance = [{'name':'Stock','url':'/markets/EGX/stocks/ABUK/support-resistance','l1Support':50.2,'l1Resistance':55.8,'updatedAt':null}]; globalThis.MUST_NOT_RUN=true;";
 assert.equal(parseInlineRows(h,'supportResistance','url')[0].raw.l1Support,50.2);assert.equal(globalThis.MUST_NOT_RUN,undefined);
 assert.throws(()=>literalArray('window.midata.volumes = [process.exit(1)];','volumes'));
});
test('quoted closing brackets and escaped apostrophe are literal data',()=>{
 const h="window.midata.volumes = [{'name':'A]B\\'C','url':'/markets/EGX/stocks/ABUK'}];";
 assert.equal(parseInlineRows(h,'volume','url')[0].name,"A]B'C");
});

test('provider escaped double quotes are decoded as data, never broken JSON',()=>{
 const h=`window.midata.volumes = [{'name':'A\\"B','url':'/markets/EGX/stocks/ABUK'}];`;
 assert.equal(parseInlineRows(h,'volume','url')[0].name,'A"B');
});
test('stale support rows remain explicitly mismatched against the required session',()=>{
 const h="window.midata.supportRisistance = [{'url':'/markets/EGX/stocks/ABUK/support-resistance','updatedAt':'26 أكتوبر 2026','l1Support':50,'l1Resistance':55}];";
 const row=parseInlineRows(h,'supportResistance','url','2026-10-27')[0];assert.equal(row.sourceSessionDate,'2026-10-26');assert.equal(row.sourceSessionStatus,'SESSION_MISMATCH');
});
test('ISO source labels must be real calendar dates',()=>{
 assert.equal(explicitSession('2026-02-30'),null);assert.equal(explicitSession('2026-13-01'),null);assert.equal(explicitSession('2024-02-29'),'2024-02-29');
});
test('current supporting evidence wins over stale duplicate and same-session conflicts remain unresolved',()=>{
 const {selectSupportingRow}=require('../../scripts/stable/mubasher-inline-analysis.cjs');
 const current={symbol:'COMI',sourceSessionDate:'2026-10-27',sourceSessionStatus:'EXPLICIT_SESSION',raw:{lastPrice:122.8,turnover:10}};
 const stale={...current,sourceSessionDate:'2026-10-26',sourceSessionStatus:'SESSION_MISMATCH',raw:{lastPrice:120,turnover:9}};
 assert.deepEqual(selectSupportingRow(current,stale,'liquidity'),current);assert.deepEqual(selectSupportingRow(stale,current,'liquidity'),current);
 const conflict=selectSupportingRow(current,{...current,raw:{lastPrice:125,turnover:10}},'liquidity');
 assert.equal(conflict.sourceSessionStatus,'CONFLICTING_PROVIDER_ROWS');assert.equal(conflict.raw,null);assert.equal(conflict.conflictingRows.length,2);
 assert.equal(selectSupportingRow(conflict,current,'liquidity').sourceSessionStatus,'CONFLICTING_PROVIDER_ROWS');
});
test('dated evidence without a requested session remains uncompared',()=>{
 const h="window.midata.liquidityMonitors = [{'url':'/markets/EGX/stocks/COMI','updatedAt':'27 أكتوبر 2026','lastPrice':122.8}];";
 assert.equal(parseInlineRows(h,'liquidity','url')[0].sourceSessionStatus,'EXPLICIT_SESSION_UNCOMPARED');
});
test('separate Mubasher datasets cannot increase independent source count or corroborate a missing price',()=>{
 const {mergeEvidence}=require('../../scripts/collect-mubasher-analysis-tools.js');
 const common={symbol:'COMI',name:'CIB',sourceSessionDate:'2026-10-27',sourceSessionStatus:'EXPLICIT_SESSION',raw:{lastPrice:122.8}};
 const datasets=['volume','liquidity','supportResistance'].map(group=>({id:group,group,currentRunOk:true,rows:[common]}));
 const r=mergeEvidence([{symbol:'COMI',price:122.8,volume:100}],datasets)[0];assert.equal(r.datasetCount,3);assert.equal(r.sourceCount,1);assert.equal(r.independentExternalSourceCount,0);assert.equal(r.currentExternalSourceCount,0);assert.equal(r.currentSameProviderDatasetCount,3);
 assert.equal(r.confirmationSources.filter(x=>x.startsWith('same-provider:')).length,1);
 const missing=mergeEvidence([{symbol:'COMI'}],datasets)[0];assert.equal(missing.coverageStatus,'BLOCKED_MISSING_CORE_DATA');
});
