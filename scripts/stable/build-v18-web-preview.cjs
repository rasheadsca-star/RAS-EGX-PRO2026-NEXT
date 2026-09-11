#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const srcDir = path.join(ROOT, 'preview-v18');
const outDir = path.join(ROOT, 'preview-v18-web');

const indexPath = path.join(srcDir, 'index.html');
const cssPath = path.join(srcDir, 'styles.css');
const appPath = path.join(srcDir, 'app.js');
const dataPath = path.join(srcDir, 'data.json');
const commonChartPath = path.join(srcDir, 'common-chart.js');
const multiTargetUiPath = path.join(srcDir, 'multi-target-ui.js');

for (const p of [indexPath, cssPath, appPath, dataPath, commonChartPath, multiTargetUiPath]) {
  if (!fs.existsSync(p)) throw new Error(`Missing web preview source: ${path.relative(ROOT, p)}`);
}

let html = fs.readFileSync(indexPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
let app = fs.readFileSync(appPath, 'utf8');
const commonChart = fs.readFileSync(commonChartPath, 'utf8');
const multiTargetUi = fs.readFileSync(multiTargetUiPath, 'utf8');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

if (data.schemaVersion !== '18.2.0-shadow') throw new Error(`Unexpected schema ${data.schemaVersion}`);
if (data.dataHealth?.status !== 'PASS') throw new Error('Refusing to publish web preview when Data Health is not PASS');
if ((data.dataHealth?.criticalFailureCount || 0) !== 0) throw new Error('Refusing to publish web preview with critical integrity failures');
if (!commonChart.includes('V18_COMMON_CHART_PLUGIN')) throw new Error('Common chart plugin marker missing');
if (!multiTargetUi.includes('V18_MULTI_TARGET_UI_PLUGIN')) throw new Error('Multi-target UI plugin marker missing');
const top20=data.allCandidates.slice().sort((a,b)=>(a.evidenceRank??a.rank??9999)-(b.evidenceRank??b.rank??9999)).slice(0,20);
if(top20.length!==20)throw new Error('Top 20 recommendations missing');
for(const row of top20){const p=row.execution?.multiTargetPlan;if(!p||![p.entryLow,p.entryHigh,p.stopLoss,p.target1,p.target2,p.target3].every(v=>Number.isFinite(Number(v))))throw new Error(`Multi-target levels missing for ${row.ticker}`);}

const minified = Buffer.from(JSON.stringify(data));
const packed = zlib.gzipSync(minified, { level: 9 });
const b64 = packed.toString('base64');

const oldLoader = "if(window.__V18_DATA__)state.data=window.__V18_DATA__;else{const r=await fetch(`data.json?t=${Date.now()}`,{cache:'no-store'});";
const newLoader = "if(window.__V18_DATA__)state.data=window.__V18_DATA__;else if(window.__V18_DATA_LOADER__)state.data=await window.__V18_DATA_LOADER__();else{const r=await fetch(`data.json?t=${Date.now()}`,{cache:'no-store'});";
if (!app.includes(oldLoader)) throw new Error('Could not locate V18.2 data loader contract');
app = app.replace(oldLoader, newLoader);
if (!app.includes('V18_COMMON_CHART_PLUGIN')) app += `\n\n${commonChart}\n`;
if (!app.includes('V18_MULTI_TARGET_UI_PLUGIN')) app += `\n\n${multiTargetUi}\n`;

html = html.replace('<link rel="stylesheet" href="styles.css?v=18.2.0">', `<style>\n${css}\n</style>`);

const liveJsonUrl = 'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/v18-global-strategy-ensemble-20260906/preview-v18/data.json';
const liveManifestUrl = 'https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/v18-global-strategy-ensemble-20260906/preview-v18-web/manifest.json';
const loader = `<script>\nwindow.__V18_LIVE_DATA_SOURCE__=${JSON.stringify(liveJsonUrl)};\nwindow.__V18_LIVE_MANIFEST_SOURCE__=${JSON.stringify(liveManifestUrl)};\nwindow.__V18_LIVE_LOADER_VERSION__='github-live-v2';\nwindow.__V18_AUTO_REFRESH_VERSION__='github-live-watch-v2';\nwindow.__V18_AUTO_REFRESH_INTERVAL_MS__=60000;\nwindow.__V18_DATA_GZIP_B64__=${JSON.stringify(b64)};\nwindow.__V18_PARSE_AND_VALIDATE__=function(live){if(live?.schemaVersion!=='18.2.0-shadow')throw new Error('Live V18 schema mismatch');if(live?.dataHealth?.status!=='PASS'||Number(live?.dataHealth?.criticalFailureCount||0)!==0)throw new Error('Live V18 data-health gate failed');if(!live?.sessionId)throw new Error('Live V18 session is missing');if(!Array.isArray(live?.allCandidates)||!live.allCandidates.length)throw new Error('Live V18 candidates are missing');return live};\nwindow.__V18_MARK_ACTIVE_DATA__=function(live,source){window.__V18_ACTIVE_SESSION__=String(live.sessionId||'');window.__V18_DATA_SOURCE_USED__=source;return live};\nwindow.__V18_DECODE_GZIP_B64__=async function(encoded){const bin=atob(encoded);const bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));if(typeof DecompressionStream==='undefined')throw new Error('This browser does not support DecompressionStream');const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));return new Response(stream).text()};\nwindow.__V18_EMBEDDED_DATA_LOADER__=async function(){const text=await window.__V18_DECODE_GZIP_B64__(window.__V18_DATA_GZIP_B64__);return window.__V18_MARK_ACTIVE_DATA__(window.__V18_PARSE_AND_VALIDATE__(JSON.parse(text)),'embedded-fallback')};\nwindow.__V18_DATA_LOADER__=async function(){try{const controller=typeof AbortController!=='undefined'?new AbortController():null;const timer=controller?setTimeout(()=>controller.abort(),15000):null;try{const mr=await fetch(window.__V18_LIVE_MANIFEST_SOURCE__+'?live='+Date.now(),{cache:'no-store',signal:controller?.signal});if(mr.ok){const m=await mr.json();if(m?.schemaVersion==='18.2.0-shadow'&&m?.sessionId&&m?.dataHealth==='PASS'&&Number(m?.criticalFailureCount||0)===0&&typeof m?.liveDataGzipB64==='string'&&m.liveDataGzipB64.length>100){const text=await window.__V18_DECODE_GZIP_B64__(m.liveDataGzipB64);const live=window.__V18_PARSE_AND_VALIDATE__(JSON.parse(text));if(live.sessionId!==m.sessionId)throw new Error('Live manifest/data session mismatch');return window.__V18_MARK_ACTIVE_DATA__(live,'github-live-manifest-gzip')}}const r=await fetch(window.__V18_LIVE_DATA_SOURCE__+'?live='+Date.now(),{cache:'no-store',signal:controller?.signal});if(!r.ok)throw new Error('Live V18 JSON HTTP '+r.status);const live=window.__V18_PARSE_AND_VALIDATE__(await r.json());return window.__V18_MARK_ACTIVE_DATA__(live,'github-live-json')}finally{if(timer)clearTimeout(timer)}}catch(err){console.warn('V18 live source unavailable; using embedded verified snapshot.',err);return window.__V18_EMBEDDED_DATA_LOADER__()}};\nwindow.__V18_CHECK_FOR_NEW_SESSION__=async function(){if(document.visibilityState==='hidden')return;try{const r=await fetch(window.__V18_LIVE_MANIFEST_SOURCE__+'?watch='+Date.now(),{cache:'no-store'});if(!r.ok)return;const m=await r.json();if(m?.schemaVersion!=='18.2.0-shadow'||m?.dataHealth!=='PASS'||Number(m?.criticalFailureCount||0)!==0||!m?.sessionId)return;const active=String(window.__V18_ACTIVE_SESSION__||'');const target=String(m.sessionId);if(!active||target===active)return;const key='v18-reload-'+target;const last=Number(sessionStorage.getItem(key)||0);if(Date.now()-last<120000)return;sessionStorage.setItem(key,String(Date.now()));location.reload()}catch(err){console.warn('V18 live-session watch retrying later.',err)}};\nwindow.addEventListener('focus',()=>window.__V18_CHECK_FOR_NEW_SESSION__());\ndocument.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')window.__V18_CHECK_FOR_NEW_SESSION__()});\nsetInterval(()=>window.__V18_CHECK_FOR_NEW_SESSION__(),window.__V18_AUTO_REFRESH_INTERVAL_MS__);\n</script>`;

html = html.replace('<script src="app.js?v=18.2.0"></script>', `${loader}\n<script>\n${app}\n</script>`);
html = html.replace('</body>', '<!-- Rank 1–20 · data-validated Entry Zone / Target 1 / Target 2 / Target 3 / Stop Loss · V18_LIVE_GITHUB_SOURCE_V1 · V18_AUTO_REFRESH_WATCH_V2 -->\n</body>');
if (html.includes('styles.css?v=18.2.0') || html.includes('app.js?v=18.2.0')) throw new Error('Standalone preview still has local asset dependency');
if (!html.includes('window.__V18_DATA_LOADER__')) throw new Error('Live data loader missing');
if (!html.includes('window.__V18_EMBEDDED_DATA_LOADER__')) throw new Error('Embedded fallback loader missing');
if (!html.includes('window.__V18_CHECK_FOR_NEW_SESSION__')) throw new Error('Live session watcher missing');
if (!html.includes('V18_LIVE_GITHUB_SOURCE_V1')) throw new Error('Live GitHub source marker missing');
if (!html.includes('V18_AUTO_REFRESH_WATCH_V2')) throw new Error('Auto-refresh watcher marker missing');
if (!html.includes('V18_COMMON_CHART_PLUGIN')) throw new Error('Global common chart was not bundled');
if (!html.includes('V18_MULTI_TARGET_UI_PLUGIN')) throw new Error('Multi-target UI plugin was not bundled');
if (!html.includes('Fibonacci') || !html.includes('Trend Channel') || !html.includes('MA20')) throw new Error('Technical chart overlays missing');
if (!html.includes('Target 3') || !html.includes('Stop Loss') || !html.includes('منطقة الدخول')) throw new Error('Multi-target execution labels missing');
if (!html.includes('Rank 1–20')) throw new Error('Top 20 publish marker missing');

fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'index.html');
fs.writeFileSync(out, html, 'utf8');

const manifest = {
  schemaVersion: data.schemaVersion,
  sessionId: data.sessionId,
  generatedAt: new Date().toISOString(),
  dataHealth: data.dataHealth?.status,
  criticalFailureCount: data.dataHealth?.criticalFailureCount || 0,
  canonicalUniverse: data.universeScreener?.length || 0,
  candidates: data.allCandidates?.length || 0,
  features: data.featureManifest?.length || 0,
  tabs: data.uiContract?.tabs?.length || 0,
  dashboardRecommendations: Math.min(20, data.allCandidates?.length || 0),
  globalCommonChart: true,
  chartOverlays: ['MA20','MA50','TREND_CHANNEL','FIBONACCI'],
  multiTargetExecution: true,
  executionLevels: ['ENTRY_ZONE','TARGET1','TARGET2','TARGET3','STOP_LOSS'],
  liveDataSource: liveJsonUrl,
  liveManifestSource: liveManifestUrl,
  liveLoaderVersion: 'github-live-v2',
  autoRefreshVersion: 'github-live-watch-v2',
  autoRefreshIntervalMs: 60000,
  embeddedVerifiedFallback: true,
  liveDataEncoding: 'gzip-base64-in-manifest',
  liveDataGzipBytes: packed.length,
  uncompressedDataBytes: minified.length,
  liveDataGzipB64: b64,
  bytes: fs.statSync(out).size
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({...manifest,liveDataGzipB64:`<${b64.length} chars>`}, null, 2));