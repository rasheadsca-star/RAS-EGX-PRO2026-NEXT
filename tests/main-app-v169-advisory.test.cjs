'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../preview-v16/app/v16-9-position-advisory-core.js');

const managerSource = fs.readFileSync(path.join(__dirname,'../preview-v16/app/v16-9-active-position-manager.js'),'utf8');

function mockAnalysis({bull=60,bear=20,side=20,ema20=10,ema50=9.8,resistance=13}={}){
  return {
    ready:true, price:10.2, barsAnalyzed:160,
    evidence:{ema20,ema50,sma200:8.5,rsi14:61,macd:{hist:.12},atr14:.25,volumeRatio:1.4,supports:[{level:9.7}],resistances:[{level:resistance}],fib:{e1272:13.5},weekly:{bias:'UP'}},
    final:{bull,side,bear,confidence:'مرتفع',confidenceScore:82},
    calibration:{ready:true,matches:18,quality:.7,horizons:[{h:1,bull:55,side:25,bear:20,expected:.8},{h:3,bull:58,side:22,bear:20,expected:1.8},{h:5,bull:62,side:18,bear:20,expected:2.7}]}
  };
}

test('MAIN APP portfolio rows normalize the current V16 schema and consolidate duplicates',()=>{
  const rows = Core.normalizePortfolio([
    {ticker:'AAA',quantity:10,entry:10,stop:9,target:12,name:'A'},
    {ticker:'aaa',quantity:20,averagePrice:11,stop:9.2,target:12.5,name:'A'}
  ]);
  assert.equal(rows.length,1);
  assert.equal(rows[0].ticker,'AAA');
  assert.equal(rows[0].quantity,30);
  assert.ok(Math.abs(rows[0].averagePrice-10.6666667)<1e-5);
  assert.equal(rows[0].stop,9.2);
  assert.equal(rows[0].target,12.5);
});

test('held recommendation exits when protective stop is broken',()=>{
  const action = Core.advisory({
    holding:{ticker:'AAA',quantity:100,averagePrice:10,stop:9.5},
    recommendation:{ticker:'AAA',entryLow:9.9,entryHigh:10.2,stopLoss:9.4,target1:11},
    analysis:mockAnalysis(), quote:{price:9.4,high:9.6}
  });
  assert.equal(action.code,'SELL_EXIT');
  assert.equal(action.automaticOrder,false);
  assert.equal(action.advisoryOnly,true);
});

test('held recommendation inside entry with bullish structure says hold to target',()=>{
  const action = Core.advisory({
    holding:{ticker:'AAA',quantity:100,averagePrice:10},
    recommendation:{ticker:'AAA',entryLow:10,entryHigh:10.5,stopLoss:9.4,target1:12},
    analysis:mockAnalysis({bull:64,bear:16}), quote:{price:10.2,high:10.3}
  });
  assert.equal(action.code,'HOLD_TO_TARGET');
  assert.match(action.labelAr,/احتفظ/);
});

test('after T1 is touched with bullish structure advisory takes partial profit and waits next target',()=>{
  const action = Core.advisory({
    holding:{ticker:'AAA',quantity:100,averagePrice:10},
    recommendation:{ticker:'AAA',entryLow:10,entryHigh:10.5,stopLoss:9.4,target1:12},
    analysis:mockAnalysis({bull:66,bear:14,resistance:13}), quote:{price:12.2,high:12.3}
  });
  assert.equal(action.code,'PARTIAL_HOLD_NEXT');
  assert.ok(action.nextTarget>12.2);
  assert.match(action.labelAr,/جني جزئي/);
});

test('professional manager uses current V16 portfolio key and only treats legacy V13.7 as one-time migration input',()=>{
  assert.match(managerSource,/CANONICAL_PORTFOLIO_KEY = 'egx-v16-professional-portfolio'/);
  assert.match(managerSource,/LEGACY_PORTFOLIO_KEY = 'egx-v137-portfolio'/);
  assert.match(managerSource,/MIGRATION_KEY/);
  assert.match(managerSource,/canonicalRaw===null/);
  assert.equal(/const PORTFOLIO_KEY = 'egx-v137-portfolio'/.test(managerSource),false);
});

test('MAIN APP live advisory is scheduled every five minutes with catch-up on resume',()=>{
  assert.match(managerSource,/REFRESH_MS = 5 \* 60 \* 1000/);
  assert.match(managerSource,/scheduleNext\(\)/);
  assert.match(managerSource,/visibility-catchup/);
  assert.match(managerSource,/focus-catchup/);
  assert.match(managerSource,/pageshow-catchup/);
  assert.match(managerSource,/QUOTE_API = 'https:\/\/egx-tfe-v20-fusion-rc2\.vercel\.app\/api\/intraday'/);
});

test('manager provides deep technical evidence and decision-change alerts without auto execution',()=>{
  assert.match(managerSource,/EMA20 \/ EMA50/);
  assert.match(managerSource,/Walk-Forward حالات مشابهة/);
  assert.match(managerSource,/Notification\.requestPermission/);
  assert.match(managerSource,/تغيرت إدارة المركز إلى/);
  assert.match(managerSource,/automaticOrders:false/);
  assert.equal(/automaticOrders\s*:\s*true/.test(managerSource),false);
  assert.equal(/placeOrder|submitOrder|executeTrade/i.test(managerSource),false);
});
