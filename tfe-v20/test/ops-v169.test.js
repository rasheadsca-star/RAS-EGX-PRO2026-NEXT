import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path){return readFile(new URL(`../${path}`,import.meta.url),'utf8')}

test('V16.9 ops consumes the existing monitor snapshot instead of duplicating quote polling',async()=>{
  const [ops,monitor]=await Promise.all([source('public/ops-v169.js'),source('public/session-monitor.js')]);
  assert.match(monitor,/CustomEvent\('rc2:session-monitor'/);
  assert.match(monitor,/__RC2_SESSION_MONITOR_LAST__/);
  assert.match(monitor,/import '\.\/ops-v169\.js'/);
  assert.match(ops,/rc2:session-monitor/);
  assert.match(ops,/__RC2_SESSION_MONITOR_LAST__/);
  assert.equal(ops.includes('/api/session-monitor?'),false,'OPS_MUST_NOT_DUPLICATE_QUOTE_FETCH');
});

test('V16.9 ops remains isolated from Alpha, policy, confidence and execution modules',async()=>{
  const ops=await source('public/ops-v169.js');
  assert.equal(/src\/(engine|policy|confidence|originalScore|originalIndicators|repository)/.test(ops),false);
  assert.equal(/executionAllowed\s*[:=]\s*true/i.test(ops),false);
  assert.equal(/automaticOrders\s*[:=]\s*true/i.test(ops),false);
  assert.equal(/recommendationMutationAllowed\s*[:=]\s*true/i.test(ops),false);
});

test('operational feature set is present and evidence-only where required',async()=>{
  const ops=await source('public/ops-v169.js');
  for(const marker of ['مركز التنبيهات','حداثة التوصية','تأكيد الافتتاح','سلة المرشحين','الارتباط ومخاطر التركّز','Portfolio Stress Test','Market Regime — Evidence Only']) assert.ok(ops.includes(marker),`MISSING_FEATURE:${marker}`);
  assert.ok(ops.includes('PENDING VERIFIED BENCHMARK FEED'));
  assert.equal(ops.includes('v16-market-regime.json'),false,'STALE_V16_REGIME_MUST_NOT_BE_REUSED_AS_CURRENT');
});

test('morning confirmation explicitly refuses to invent first-15m liquidity evidence',async()=>{
  const ops=await source('public/ops-v169.js');
  assert.ok(ops.includes('PRICE_ONLY'));
  assert.ok(ops.includes('لا نخترع Liquidity Confirmation'));
  assert.ok(ops.includes('ممنوع تحويلها إلى مطاردة'));
});

test('browser notifications require explicit user permission and transition de-duplication',async()=>{
  const ops=await source('public/ops-v169.js');
  assert.match(ops,/Notification\.requestPermission\(\)/);
  assert.match(ops,/notified\.has\(id\)/);
  assert.match(ops,/Notification\.permission!==['"]granted['"]/);
});

test('portfolio intelligence uses read-only history and local portfolio storage',async()=>{
  const ops=await source('public/ops-v169.js');
  assert.ok(ops.includes("route:'history'"));
  assert.ok(ops.includes('egx-tfe-rc2-v169-portfolio'));
  assert.ok(ops.includes('pearson'));
  assert.ok(ops.includes('Market -3%'));
  assert.ok(ops.includes('Market -5%'));
  assert.equal(/fetch\([^\n]*route[:=]['"]scan['"]/.test(ops),false,'OPS_MUST_NOT_TRIGGER_RESCAN_FOR_PORTFOLIO_INTELLIGENCE');
});

test('basket allocation stays local and bounded by existing UI risk inputs',async()=>{
  const ops=await source('public/ops-v169.js');
  assert.ok(ops.includes("document.getElementById('riskPctInput')"));
  assert.ok(ops.includes("document.getElementById('maxWeightInput')"));
  assert.ok(ops.includes('portfolioRiskLimit'));
  assert.ok(ops.includes('Equal-risk local planner'));
  assert.equal(/broker|placeOrder|submitOrder|executeTrade/i.test(ops),false);
});

test('recommendation freshness distinguishes the latest data session from an older frozen snapshot',async()=>{
  const ops=await source('public/ops-v169.js');
  assert.ok(ops.includes('__RC2_UI_SCAN__'));
  assert.ok(ops.includes('publicationEligibleTotal'));
  assert.ok(ops.includes('لا توصيات جديدة'));
  assert.ok(ops.includes('0 سهم اجتاز بوابات النشر'));
  assert.ok(ops.includes('سجل متابعة تاريخي فقط'));
  assert.equal(ops.includes('آخر إشارة مجمدة ${session}. حالة السوق الحالية ${phase.phase}.'),false,'STALE_SNAPSHOT_MUST_NOT_BE_PRESENTED_AS_CURRENT_SESSION');
});
