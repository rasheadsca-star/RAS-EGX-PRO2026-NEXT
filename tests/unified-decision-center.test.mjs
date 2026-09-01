import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('unified decision center contains migrated legacy feature surfaces',()=>{
  for(const view of ['today','market','symbol','portfolio','journal','alerts','sim','compare','audit'])assert.ok(html.includes(`data-view="${view}"`),`missing view ${view}`);
  for(const marker of ['Top Opportunities','Full-Market Search','Portfolio Lifecycle','Decision Journal','Price Alerts','Historical Point‑in‑Time Simulator','Engine Comparison','Support / Resistance','Data Quality','Lineage & Authority'])assert.ok(html.includes(marker),`missing marker ${marker}`);
});

test('unified UI consumes clean-room research publication and simulator snapshots',()=>{
  assert.ok(html.includes("data/research/published/latest.json"));
  assert.ok(html.includes("data/research/ui/latest.json"));
  assert.ok(html.includes("data/research/simulator/latest.json"));
  assert.ok(html.includes("data/research/history/${s.ticker}.json"));
});

test('unified UI keeps production and automatic-order boundaries explicit',()=>{
  assert.ok(html.includes('PRODUCTION LOCKED'));
  assert.ok(html.includes("PUB.productionAuthority!==false"));
  assert.ok(html.includes("PUB.automaticOrders!==false"));
  assert.ok(html.includes('Automatic Orders'));
  assert.ok(html.includes('DISABLED'));
  assert.ok(!/placeOrder|submitOrder|brokerOrder|autoTrade\s*\(/i.test(html));
});

test('portfolio journal and alerts remain local browser workflows',()=>{
  for(const key of ['EGX_ONE_PORTFOLIO_V1','EGX_ONE_JOURNAL_V1','EGX_ONE_ALERTS_V1'])assert.ok(html.includes(key));
  assert.ok(html.includes('localStorage.setItem'));
  assert.ok(html.includes('localStorage.getItem'));
});
