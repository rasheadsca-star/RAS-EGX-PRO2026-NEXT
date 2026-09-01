import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('unified decision center contains migrated legacy feature surfaces',()=>{
  for(const view of ['today','market','symbol','portfolio','journal','alerts','sim','compare','audit'])assert.ok(html.includes(`data-view="${view}"`),`missing view ${view}`);
  for(const marker of ['Top Opportunities','Full-Market Search','Portfolio Lifecycle','Decision Journal','Price Alerts','Historical Point‑in‑Time Simulator','Engine Comparison','Support / Resistance','Data Quality','Lineage & Authority'])assert.ok(html.includes(marker),`missing marker ${marker}`);
});

test('unified UI consumes clean-room research publication simulator and regime evidence',()=>{
  for(const feed of ['data/research/published/latest.json','data/research/ui/latest.json','data/research/simulator/latest.json','data/research/regime/latest.json','data/research/context/latest.json','data/research/regime/evaluation.json','data/research/shadow-ledger/latest.json'])assert.ok(html.includes(feed),`missing feed ${feed}`);
  assert.ok(html.includes('data/research/history/${s.ticker}.json'));
});

test('regime confidence remains advisory and cannot silently replace baseline recommendation set',()=>{
  for(const marker of ['baselineRecommendationSetUnchanged','changesPublishedDecision','GUARD WOULD SKIP','Regime Challenger','Forward Shadow Ledger','DISABLED_PENDING_FORWARD_VALIDATION'])assert.ok(html.includes(marker),`missing regime guard marker ${marker}`);
  assert.ok(html.includes('ليس احتمال نجاح'));
  assert.ok(html.includes('NOT success probability'));
  assert.ok(!/\.filter\([^\n]*regimeFilterWouldAccept/.test(html),'UI must not filter published recommendations by challenger acceptance');
  assert.ok(html.includes("(PUB?.recommendations||[]).map(recCard)"),'published recommendation set must render directly');
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
