import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYahooResearchPayload,parseMubasherStockPage,parseMubasherVolumeStatistics,bindMubasherSession,reconcileResearchObservations } from '../src/research-live-adapters.js';

const yahooPayload={chart:{result:[{meta:{symbol:'ABUK.CA',currency:'EGP',exchangeName:'CAI',fullExchangeName:'Egyptian Exchange'},timestamp:[1788116400],indicators:{quote:[{open:[79.4],high:[80.9],low:[78.26],close:[79.98],volume:[1882974]}],adjclose:[{adjclose:[79.98]}]}}],error:null}};

test('Yahoo payload becomes research-only OHLCV observation',()=>{const r=parseYahooResearchPayload(yahooPayload,{ticker:'ABUK',sourceUrl:'https://query1.finance.yahoo.com/test',fetchedAt:'2026-08-31T15:00:00Z'});assert.equal(r.state,'READY');assert.equal(r.sessions.length,1);assert.equal(r.sessions[0].sourceId,'YAHOO_RESEARCH');assert.equal(r.sessions[0].productionAuthority,false);assert.equal(r.sessions[0].close,79.98)});

test('Yahoo identity mismatch is blocked',()=>{const bad=structuredClone(yahooPayload);bad.chart.result[0].meta.symbol='FAKE.CA';const r=parseYahooResearchPayload(bad,{ticker:'ABUK'});assert.equal(r.state,'BLOCKED');assert.ok(r.reasons.some(x=>x.startsWith('YAHOO_SYMBOL_MISMATCH:')))});

const stockHtml='<h1>Abou Kir Fertilizers (ABUK)</h1><div>Last update: 01:29 PM market time.</div><div>79.98</div><div>Open 79.40</div><div>Previous Close 79.40</div><div>High 80.90</div><div>Low 78.26</div><div>Volume 1,882,974</div><div>Turnover 149,807,824.00</div>';
const statsHtml='<h2>Volume Statistics</h2><table><tr><td>Last Update</td><td>31 August 2026</td></tr><tr><td>Volume</td><td>1,882,974</td></tr></table>';

test('Mubasher stock page requires explicit dated volume evidence before session binding',()=>{const stock=parseMubasherStockPage(stockHtml,{ticker:'ABUK'});assert.equal(stock.state,'READY_WITHOUT_SESSION');const stats=parseMubasherVolumeStatistics(statsHtml);assert.equal(stats.session,'2026-08-31');const bound=bindMubasherSession(stock,stats);assert.equal(bound.state,'READY');assert.equal(bound.observation.sourceId,'MUBASHER_RESEARCH');assert.equal(bound.observation.session,'2026-08-31')});

test('Mubasher volume mismatch blocks session evidence',()=>{const stock=parseMubasherStockPage(stockHtml,{ticker:'ABUK'}),stats=parseMubasherVolumeStatistics(statsHtml);stats.volume=1;const bound=bindMubasherSession(stock,stats);assert.equal(bound.state,'BLOCKED');assert.ok(bound.reasons.some(x=>x.startsWith('MUBASHER_VOLUME_EVIDENCE_MISMATCH:')))});

test('same-session Yahoo and Mubasher crosscheck research without granting production',()=>{const y={...parseYahooResearchPayload(yahooPayload,{ticker:'ABUK'}).sessions[0],session:'2026-08-31'},m=bindMubasherSession(parseMubasherStockPage(stockHtml,{ticker:'ABUK'}),parseMubasherVolumeStatistics(statsHtml)).observation;const r=reconcileResearchObservations({ticker:'ABUK',yahooObservation:y,mubasherObservation:m});assert.equal(r.state,'READY_RESEARCH');assert.equal(r.authoritativeResearch.productionAuthority,false);assert.equal(r.authoritativeResearch.verificationState,'YAHOO_MUBASHER_CROSSCHECK')});

test('material same-session close disagreement is quarantined',()=>{const y={...parseYahooResearchPayload(yahooPayload,{ticker:'ABUK'}).sessions[0],session:'2026-08-31'},m={...bindMubasherSession(parseMubasherStockPage(stockHtml,{ticker:'ABUK'}),parseMubasherVolumeStatistics(statsHtml)).observation,close:70};const r=reconcileResearchObservations({ticker:'ABUK',yahooObservation:y,mubasherObservation:m});assert.equal(r.state,'DATA_CONFLICT');assert.equal(r.authoritativeResearch.researchState,'QUARANTINED_RESEARCH')});

test('different sessions do not create false price conflict',()=>{const y={...parseYahooResearchPayload(yahooPayload,{ticker:'ABUK'}).sessions[0],session:'2026-08-31'},m={...bindMubasherSession(parseMubasherStockPage(stockHtml,{ticker:'ABUK'}),parseMubasherVolumeStatistics(statsHtml)).observation,session:'2026-08-30'};const r=reconcileResearchObservations({ticker:'ABUK',yahooObservation:y,mubasherObservation:m});assert.equal(r.state,'READY_RESEARCH');assert.equal(r.authoritativeResearch.session,'2026-08-31');assert.ok(r.reasons.some(x=>x.startsWith('SESSION_MISMATCH:')))});
