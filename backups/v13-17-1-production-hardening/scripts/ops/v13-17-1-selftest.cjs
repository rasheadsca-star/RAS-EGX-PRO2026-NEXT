'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..', '..');
function mkdir(file) { fs.mkdirSync(path.dirname(file), { recursive: true }); }
function write(file, value) { mkdir(file); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value, null, 2)); }
function read(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function run(cwd, args, env = {}) {
  const result = cp.spawnSync(process.execPath, args, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  return result;
}
function rows(valid) {
  return Array.from({ length: 190 }, (_, i) => {
    const price = Number((10 + i / 100).toFixed(3));
    return valid
      ? { symbol: `T${String(i).padStart(3, '0')}`, price, last: price, open: price - 0.1, high: price + 0.2, low: price - 0.2, previousClose: price - 0.05, volume: 1000 + i }
      : { symbol: `T${String(i).padStart(3, '0')}`, price: 0.2, last: 0.2, open: 21, high: 0.21, low: 0.19, previousClose: 0.2, volume: 1000 + i };
  });
}
function fakeFetcher(payload) {
  return `const fs=require('fs');fs.mkdirSync('data',{recursive:true});const rows=${JSON.stringify(payload)};const now=new Date().toISOString();fs.writeFileSync('data/market.json',JSON.stringify({ok:true,generatedAt:now,updatedAt:now,source:'fixture',rows},null,2));fs.writeFileSync('data/source-fetch-report.json',JSON.stringify({ok:true,realFetch:true,sourceName:'fixture',selected:{url:'fixture://market'}},null,2));fs.writeFileSync('data/fetch-status.json',JSON.stringify({ok:true,realFetch:true,sourceName:'fixture'},null,2));fs.writeFileSync('data/source-health.json',JSON.stringify({ok:true,sourceName:'fixture'},null,2));`;
}

function testParserPatch() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v13171-parser-'));
  write(path.join(dir, 'scripts/ops/v13-17-1-install-source-fix.cjs'), fs.readFileSync(path.join(ROOT, 'scripts/ops/v13-17-1-install-source-fix.cjs'), 'utf8'));
  write(path.join(dir, 'scripts/fetch-market-data.js'), `/* EGX Pro Hub V9.8.6 */\nfunction num(v){return Number(v)}\nfunction normalizeRow(v){return v}\nasync function f(){let plain='',m=[],price=1,symbol='',RUN_AT='',url='';\nconst getAfter=(label)=>{const mm=plain.match(new RegExp(label+"\\\\s+([0-9][0-9,.]*\\\\.?[0-9]*)","i"));return mm?num(mm[1]):null};\nconst row=normalizeRow({symbol,name:m?m[1]:"",price,change:m?m[4]:null,changePct:m?m[5]:null,open:getAfter("Open"),previousClose:getAfter("Previous Close"),high:getAfter("High"),low:getAfter("Low"),volume:getAfter("Volume"),valueTraded:getAfter("Turnover"),updatedAt:RUN_AT},"mubasher_symbol_pages",url);return row}\n`);
  run(dir, ['scripts/ops/v13-17-1-install-source-fix.cjs']);
  const patched = fs.readFileSync(path.join(dir, 'scripts/fetch-market-data.js'), 'utf8');
  assert(patched.includes('V13_17_1_QUOTE_WINDOW_PATCH'));
  assert(patched.includes('plain.slice(lastUpdateAt'));
  assert(!patched.includes('open:getAfter("Open")'));
  run(dir, ['--check', 'scripts/fetch-market-data.js']);
}

function prepareGatewayDir(validRows, withLastGood = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v13171-gateway-'));
  write(path.join(dir, 'scripts/collect-market-gateway.js'), fs.readFileSync(path.join(ROOT, 'scripts/collect-market-gateway.js'), 'utf8'));
  write(path.join(dir, 'scripts/fetch-market-data.js'), fakeFetcher(validRows));
  if (withLastGood) {
    const now = new Date().toISOString();
    write(path.join(dir, 'data/last-good-market.json'), { ok: true, generatedAt: now, updatedAt: now, rows: rows(true), source: 'known-good' });
  }
  return dir;
}

function testGatewayGood() {
  const dir = prepareGatewayDir(rows(true));
  run(dir, ['scripts/collect-market-gateway.js']);
  const report = read(path.join(dir, 'data/market-quality-report.json'));
  assert.equal(report.executionGrade, true);
  assert.equal(report.status, 'accepted_execution_grade');
  assert.equal(report.quality.invalidOhlcRows, 0);
  assert(fs.existsSync(path.join(dir, 'data/last-good-market.json')));
}

function testGatewayRejectsBadAndPreservesLastGood() {
  const dir = prepareGatewayDir(rows(false), true);
  const before = fs.readFileSync(path.join(dir, 'data/last-good-market.json'), 'utf8');
  run(dir, ['scripts/collect-market-gateway.js']);
  const report = read(path.join(dir, 'data/market-quality-report.json'));
  assert.equal(report.executionGrade, false);
  assert.equal(report.fallbackUsed, true);
  assert.equal(report.status, 'degraded_validated_last_good');
  assert.equal(fs.readFileSync(path.join(dir, 'data/last-good-market.json'), 'utf8'), before);
  assert(fs.existsSync(path.join(dir, 'data/quarantine/latest-rejected-market.json')));
}

function testGatewayBlocksWithoutFallback() {
  const dir = prepareGatewayDir(rows(false));
  run(dir, ['scripts/collect-market-gateway.js']);
  const report = read(path.join(dir, 'data/market-quality-report.json'));
  assert.equal(report.ok, false);
  assert.equal(report.status, 'blocked_no_valid_snapshot');
}

testParserPatch();
testGatewayGood();
testGatewayRejectsBadAndPreservesLastGood();
testGatewayBlocksWithoutFallback();
console.log('V13.17.1 permanent production hardening self-tests passed.');
