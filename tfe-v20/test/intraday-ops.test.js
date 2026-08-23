import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeTickerList, mergeIntradayBar, classifyIntradayShadow } from '../api/intraday.js';

const clientSource = readFileSync(new URL('../public/intraday-ops.js', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../api/intraday.js', import.meta.url), 'utf8');

test('intraday ticker batches deduplicate, sanitize, and cap at ten', () => {
  const input = ['copr','FAIT','bad ticker','MPCO','COPR','AIFI','MICH','COMI','ETEL','SWDY','TMGH','ORAS','FWRY'].join(',');
  const rows = normalizeTickerList(input);
  assert.equal(rows.length, 10);
  assert.deepEqual(rows.slice(0, 4), ['COPR','FAIT','MPCO','AIFI']);
  assert.equal(new Set(rows).size, rows.length);
  assert.equal(rows.includes('BAD TICKER'), false);
});

test('intraday provisional bar replaces same-session row without duplicating date', () => {
  const rows = [
    { date:'2026-08-20', open:10, high:11, low:9, close:10.5, volume:100 },
    { date:'2026-08-23', open:11, high:11.4, low:10.8, close:11.1, volume:90 },
  ];
  const quote = { sourceSessionDate:'2026-08-23', open:11, high:12, low:10.7, price:11.8, volume:250, turnover:2950 };
  const merged = mergeIntradayBar(rows, quote);
  assert.equal(merged.length, 2);
  assert.equal(merged.filter((x) => x.date === '2026-08-23').length, 1);
  assert.equal(merged.at(-1).close, 11.8);
  assert.equal(merged.at(-1).volume, 250);
  assert.equal(merged.at(-1).valueTraded, 2950);
});

test('invalid intraday OHLC cannot contaminate historical rows', () => {
  const rows = [{ date:'2026-08-20', open:10, high:11, low:9, close:10.5, volume:100 }];
  const quote = { sourceSessionDate:'2026-08-23', open:11, high:10, low:12, price:11.5, volume:250 };
  assert.deepEqual(mergeIntradayBar(rows, quote), rows);
});

test('quality-only intraday block may become WATCH but never publication', () => {
  const result = classifyIntradayShadow({ quality:{state:'BLOCKED'}, reasonCodes:['QUALITY_BLOCKED'] });
  assert.equal(result.technicalGatePass, true);
  assert.equal(result.state, 'INTRADAY_TECHNICAL_PASS');
  assert.equal(result.publicationAllowed, false);
  assert.equal(result.qualityBlocked, true);
});

test('non-quality hard gate failure remains no-candidate', () => {
  const result = classifyIntradayShadow({ quality:{state:'BLOCKED'}, reasonCodes:['QUALITY_BLOCKED','LIQUIDITY_GATE_FAIL'] });
  assert.equal(result.technicalGatePass, false);
  assert.equal(result.state, 'INTRADAY_NO_CANDIDATE');
  assert.equal(result.publicationAllowed, false);
  assert.deepEqual(result.nonQualityReasons, ['LIQUIDITY_GATE_FAIL']);
});

test('alignment-only provisional state is WAIT and never official recommendation', () => {
  const result = classifyIntradayShadow({ quality:{state:'BLOCKED'}, reasonCodes:['QUALITY_BLOCKED','DO_NOT_CHASE'] });
  assert.equal(result.technicalGatePass, false);
  assert.equal(result.state, 'INTRADAY_ALIGNMENT_WAIT');
  assert.equal(result.publicationAllowed, false);
});

test('intraday API is explicitly provisional, non-mutating, and execution blocked', () => {
  assert.match(apiSource, /provisionalOnly:\s*true/);
  assert.match(apiSource, /recommendationMutationAllowed:\s*false/);
  assert.match(apiSource, /publicationAllowed:\s*false/);
  assert.match(apiSource, /executionAllowed:\s*false/);
  assert.match(apiSource, /automaticOrders:\s*false/);
  assert.equal(/executionAllowed\s*:\s*true/.test(apiSource), false);
  assert.equal(/automaticOrders\s*:\s*true/.test(apiSource), false);
});

test('browser intraday layer rotates full market and prioritizes portfolio every five minutes', () => {
  assert.match(clientSource, /BATCH_SIZE\s*=\s*10/);
  assert.match(clientSource, /BATCH_INTERVAL_MS\s*=\s*45_000/);
  assert.match(clientSource, /PRIORITY_INTERVAL_MS\s*=\s*300_000/);
  assert.match(clientSource, /currentRc2UniverseCandidate\s*===\s*true/);
  assert.match(clientSource, /assessHolding/);
  assert.match(clientSource, /quoteFreshness/);
});

test('live portfolio ADD is gated by the official published recommendation set', () => {
  assert.match(clientSource, /const officialRecommendation =/);
  assert.match(clientSource, /publicationEligible:true/);
  assert.match(clientSource, /publicationEligible:false/);
  assert.match(clientSource, /partialBarNoise = new Set\(\['LIQUIDITY_GATE_FAIL','RESEARCH_SCORE_LOW'\]\)/);
});

test('browser intraday state remains local and has no order or write API path', () => {
  assert.match(clientSource, /localStorage\.setItem/);
  assert.equal(/method\s*:\s*['"]POST['"]/.test(clientSource), false);
  assert.equal(/automaticOrders\s*:\s*true/.test(clientSource), false);
  assert.equal(/executionAllowed\s*:\s*true/.test(clientSource), false);
  assert.equal(/broker|placeOrder|submitOrder|executeTrade/i.test(clientSource), false);
});
