import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('V16.9 loads a dedicated RC2 operations center from its existing addon entry point', async () => {
  const [wrapper, center] = await Promise.all([source('public/portfolio-manager.js'), source('public/rc2-ops-center.js')]);
  assert.ok(wrapper.includes("import('./rc2-ops-center.js?v=20260824-opsall1')"));
  assert.ok(center.includes("tab.dataset.view='operations'"));
  assert.ok(center.includes("section.id=VIEW_ID"));
  for (const marker of ['RC2_LIVE_REFRESH_V1','SESSION_MONITOR_V1','V16_9_OPERATIONAL_OVERLAYS_V1','RC2_INTRADAY_OPERATIONS_V1','OPS_ALERT_CENTER','RC2_EOD_PORTFOLIO_MANAGER','RC2_LIVE_PORTFOLIO_VIEW','RC2_DEEP_PORTFOLIO_ANALYSIS_V1','RC2_PORTFOLIO_RISK_OVERLAY','RC2_AUTO_FUNDAMENTALS_V1','RC2_MARKET_REGIME_EVIDENCE']) assert.ok(center.includes(marker), `MISSING_MODULE:${marker}`);
});

test('operations center navigates to existing modules instead of duplicating engines or polling APIs', async () => {
  const center = await source('public/rc2-ops-center.js');
  assert.equal(/import\s+.*(engine|policy|confidence|originalScore|originalIndicators)/.test(center), false);
  assert.equal(center.includes('/api/intraday'), false);
  assert.equal(center.includes('/api/index'), false);
  assert.ok(center.includes("document.getElementById('refreshBtn')?.click()"));
  assert.ok(center.includes("document.getElementById('sessionMonitorRefresh')?.click()"));
  assert.ok(center.includes("document.getElementById('ioPriorityNow')?.click()"));
  assert.ok(center.includes("document.getElementById('ioBatchNow')?.click()"));
});

test('operations center preserves research-only execution lock', async () => {
  const center = await source('public/rc2-ops-center.js');
  assert.equal(/executionAllowed\s*[:=]\s*true/i.test(center), false);
  assert.equal(/automaticOrders\s*[:=]\s*true/i.test(center), false);
  assert.equal(/recommendationMutationAllowed\s*[:=]\s*true/i.test(center), false);
  assert.ok(center.includes('لا تغيّر Alpha أو Fusion Rank'));
});

test('existing add-on wrapper still loads deep portfolio and automatic fundamentals', async () => {
  const wrapper = await source('public/portfolio-manager.js');
  assert.ok(wrapper.includes('portfolio-manager-core.js?v=20260823-deep2'));
  assert.ok(wrapper.includes('portfolio-deep-analysis.js?v=20260823-deep2'));
  assert.ok(wrapper.includes('fundamental-auto.js?v=20260823-fund2'));
});

test('operations center observer ignores self-render mutations', async () => {
  const center = await source('public/rc2-ops-center.js');
  assert.ok(center.includes('!t.closest(`#${VIEW_ID}`)'));
  assert.ok(center.includes('if(!external)return'));
});
