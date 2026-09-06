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

for (const p of [indexPath, cssPath, appPath, dataPath]) {
  if (!fs.existsSync(p)) throw new Error(`Missing web preview source: ${path.relative(ROOT, p)}`);
}

let html = fs.readFileSync(indexPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
let app = fs.readFileSync(appPath, 'utf8');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

if (data.schemaVersion !== '18.2.0-shadow') throw new Error(`Unexpected schema ${data.schemaVersion}`);
if (data.dataHealth?.status !== 'PASS') throw new Error('Refusing to publish web preview when Data Health is not PASS');
if ((data.dataHealth?.criticalFailureCount || 0) !== 0) throw new Error('Refusing to publish web preview with critical integrity failures');

const minified = Buffer.from(JSON.stringify(data));
const packed = zlib.gzipSync(minified, { level: 9 });
const b64 = packed.toString('base64');

const oldLoader = "if(window.__V18_DATA__)state.data=window.__V18_DATA__;else{const r=await fetch(`data.json?t=${Date.now()}`,{cache:'no-store'});";
const newLoader = "if(window.__V18_DATA__)state.data=window.__V18_DATA__;else if(window.__V18_DATA_LOADER__)state.data=await window.__V18_DATA_LOADER__();else{const r=await fetch(`data.json?t=${Date.now()}`,{cache:'no-store'});";
if (!app.includes(oldLoader)) throw new Error('Could not locate V18.2 data loader contract');
app = app.replace(oldLoader, newLoader);

html = html.replace('<link rel="stylesheet" href="styles.css?v=18.2.0">', `<style>\n${css}\n</style>`);

const loader = `<script>\nwindow.__V18_DATA_GZIP_B64__=${JSON.stringify(b64)};\nwindow.__V18_DATA_LOADER__=async function(){const bin=atob(window.__V18_DATA_GZIP_B64__);const bytes=Uint8Array.from(bin,c=>c.charCodeAt(0));if(typeof DecompressionStream==='undefined')throw new Error('This browser does not support DecompressionStream');const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));const text=await new Response(stream).text();return JSON.parse(text)};\n</script>`;

html = html.replace('<script src="app.js?v=18.2.0"></script>', `${loader}\n<script>\n${app}\n</script>`);
if (html.includes('styles.css?v=18.2.0') || html.includes('app.js?v=18.2.0')) throw new Error('Standalone preview still has local asset dependency');
if (!html.includes('window.__V18_DATA_LOADER__')) throw new Error('Embedded data loader missing');

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
  bytes: fs.statSync(out).size
};
fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(manifest, null, 2));
