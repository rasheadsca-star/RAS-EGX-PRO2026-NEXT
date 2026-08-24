#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),scanPath=path.join(root,'data/current-scan.json');
if(!fs.existsSync(scanPath)){console.error('ACCEPTANCE_BLOCKED:NO_CURRENT_SCAN');process.exit(2);}
const s=JSON.parse(fs.readFileSync(scanPath,'utf8'));
const completeRows=(s.all||[]).filter(x=>x.audit_stages?.data_integrity?.pass);
const checks={
  isolation:s.sourceIsolation?.rc2RuntimeImports===0&&s.sourceIsolation?.rc2RuntimeMutations===0,
  deterministicSchema:s.schemaVersion==='1.0.1',
  noChasing:(s.all||[]).filter(x=>x.status==='EXTENDED').every(x=>x.action==='WAIT FOR NEW SETUP'),
  freshnessWarnings:(s.all||[]).filter(x=>x.failed_rules?.includes('STALE_DATA')).every(x=>x.status!=='READY NOW'&&x.status!=='BREAKOUT CONFIRMED'),
  explainable:(s.all||[]).every(x=>Array.isArray(x.failed_rules)&&Array.isArray(x.why_selected)&&x.trend_template&&x.vcp&&x.audit_stages),
  coverageAttempted:s.market_coverage.SuccessfullyAnalyzed+s.market_coverage.Errors>=s.market_coverage.TotalEligible,
  noFakeFundamentals:(s.all||[]).every(x=>x.fundamentals?.score!==0||x.fundamentals?.confidence),
  exactLongHistoryContract:completeRows.every(x=>x.history_metrics?.session_count>=253&&Number.isFinite(Number(x.history_metrics?.SMA200))&&Number.isFinite(Number(x.history_metrics?.R252))&&Number.isFinite(Number(x.history_metrics?.high52w))&&Number.isFinite(Number(x.history_metrics?.low52w))),
  coverageCountersConsistent:s.market_coverage.CompleteSMA200R252Week52<=s.market_coverage.SuccessfullyAnalyzed&&s.market_coverage.R252Ready<=s.market_coverage.SuccessfullyAnalyzed&&s.market_coverage.SMA200Ready<=s.market_coverage.SuccessfullyAnalyzed&&s.market_coverage.Week52Ready<=s.market_coverage.SuccessfullyAnalyzed,
  noEligibleWithoutLongHistory:(s.top5_now||[]).every(x=>x.history_metrics?.complete===true),
};
console.log(JSON.stringify(checks,null,2));if(Object.values(checks).some(x=>!x))process.exit(1);
