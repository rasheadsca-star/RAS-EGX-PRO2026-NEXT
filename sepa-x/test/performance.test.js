import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendHistory, readJson } from '../src/store.js';
import { performanceAnalytics } from '../src/performance.js';

const rec={symbol:'AAA',status:'READY NOW',action:'WATCH TRIGGER',final_score:90,entry_zone:{from:100,to:101.5},pivot:100,stop_loss:95,risk_pct:6,reward_risk:3,strength_score:90,setup_clarity_score:88,entry_readiness_score:96,confidence_score:85,rs_percentile:92,vcp:{quality:90},failed_rules:[],why_selected:[],last_session:{high:101,low:99}};
test('recommendation history persists and self-evaluation updates conservatively',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sepax-')),file=path.join(dir,'history.json');
  appendHistory(file,{generatedAt:'2026-08-24T10:00:00Z',market_status:{Regime:'BULL'},market_coverage:{},top5_now:[rec],all:[rec]});
  const next={...rec,status:'BREAKOUT CONFIRMED',last_session:{high:113,low:99}};
  appendHistory(file,{generatedAt:'2026-08-25T10:00:00Z',market_status:{Regime:'BULL'},market_coverage:{},top5_now:[next],all:[next]});
  const h=readJson(file);assert.ok(h.recommendations.length>=2);assert.equal(h.recommendations[0].hit_2R,true);
  const p=performanceAnalytics(h);assert.ok(p.totalRecommendations>=2);
});
