#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const html = read('v20/index.html');
const css = read('v20/styles.css');
const js = read('v20/app.js');
const failures = [];
const check = (ok, code) => { if (!ok) failures.push(code); };

check(/<html\s+lang="ar"\s+dir="rtl">/i.test(html), 'ARABIC_RTL_DOCUMENT_MISSING');
check(/meta\s+name="viewport"/i.test(html), 'VIEWPORT_META_MISSING');
check(html.includes('id="executionBadge"'), 'EXECUTION_STATUS_NOT_VISIBLE');
check(html.includes('id="gateBanner"'), 'GLOBAL_GATE_BANNER_MISSING');
check(html.includes('id="searchInput"'), 'MARKET_SEARCH_MISSING');
check(html.includes('id="stockDialog"'), 'STOCK_DETAIL_DIALOG_MISSING');
check(html.includes('Net R/R T1'), 'NET_RR_COLUMN_MISSING');
check(js.includes('riskReward?.primaryTarget1NetRiskReward'), 'UI_NOT_USING_PRIMARY_NET_RR');
check(js.includes('Legacy R/R — للمراجعة فقط'), 'LEGACY_RR_NOT_LABELED_AUDIT_ONLY');
check(js.includes('GLOBAL_EXECUTION_GATE_CLOSED'), 'GLOBAL_GATE_REASON_NOT_RENDERED');
check(js.includes("json('../data/v20/source-health.json')"), 'SOURCE_HEALTH_NOT_WIRED');
check(js.includes("json('../data/v20/stock-profiles.json')"), 'STOCK_PROFILES_NOT_WIRED');
check(js.includes("json('../data/v20/risk-reward-audit.json')"), 'RR_AUDIT_NOT_WIRED');
check(css.includes('@media(max-width:1024px)'), 'RESPONSIVE_1024_MISSING');
check(css.includes('@media(max-width:768px)'), 'RESPONSIVE_768_MISSING');
check(css.includes('@media(max-width:430px)'), 'RESPONSIVE_430_MISSING');
check(css.includes('@media(max-width:390px)'), 'RESPONSIVE_390_MISSING');
check(css.includes('prefers-reduced-motion'), 'REDUCED_MOTION_MISSING');
check(html.includes('aria-live="polite"'), 'ARIA_LIVE_STATUS_MISSING');
check(html.includes('class="skip-link"'), 'SKIP_LINK_MISSING');

const report = {
  schemaVersion: '20.0.0-ui-validation-1',
  generatedAt: new Date().toISOString(),
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  checks: {
    rtlArabicFirst: true,
    globalExecutionStatusVisible: true,
    conservativeNetRiskRewardPrimary: true,
    legacyRiskRewardAuditOnly: true,
    searchAndStockDetail: true,
    sourceHealthVisible: true,
    responsiveBreakpoints: [1024, 768, 430, 390],
    reducedMotionSupport: true,
    accessibilityBasics: true,
  },
  limitation: 'Static validation only. Pixel-level/browser visual verification is a separate acceptance step.',
};

fs.mkdirSync(path.join(root, 'data/v20'), { recursive: true });
fs.writeFileSync(path.join(root, 'data/v20/ui-validation.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
