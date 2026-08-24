#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),scanPath=path.join(root,'data/current-scan.json');
if(!fs.existsSync(scanPath)){console.error('ACCEPTANCE_BLOCKED:NO_CURRENT_SCAN');process.exit(2);}
const s=JSON.parse(fs.readFileSync(scanPath,'utf8'));const checks={
  isolation:s.sourceIsolation?.rc2RuntimeImports===0&&s.sourceIsolation?.rc2RuntimeMutations===0,
  deterministicSchema:s.schemaVersion==='1.0.0',
  noChasing:(s.all||[]).filter(x=>x.status==='EXTENDED').every(x=>x.action==='WAIT FOR NEW SETUP'),
  freshnessWarnings:(s.all||[]).filter(x=>x.failed_rules?.includes('STALE_DATA')).every(x=>x.status!=='READY NOW'&&x.status!=='BREAKOUT CONFIRMED'),
  explainable:(s.all||[]).every(x=>Array.isArray(x.failed_rules)&&Array.isArray(x.why_selected)&&x.trend_template&&x.vcp&&x.audit_stages),
  coverageAttempted:s.market_coverage.SuccessfullyAnalyzed+s.market_coverage.Errors>=s.market_coverage.TotalEligible,
  noFakeFundamentals:(s.all||[]).every(x=>x.fundamentals?.score!==0||x.fundamentals?.confidence),
};
console.log(JSON.stringify(checks,null,2));if(Object.values(checks).some(x=>!x))process.exit(1);
