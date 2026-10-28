'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process');
const adapter=require.resolve('../../scripts/stable/v16-market-second-source-resolver.cjs');
test('provider session label remains Oct27 across Cairo and UTC hosts',()=>{
 const html='<tr><td>Oct 27, 2026</td><td>10</td><td>12</td><td>9</td><td>11</td><td>11</td><td>2%</td><td>1,234</td></tr>';
 for(const TZ of ['Africa/Cairo','UTC','America/New_York']){
  const result=cp.spawnSync(process.execPath,['-e',`const p=require(${JSON.stringify(adapter)});process.stdout.write(JSON.stringify(p.parseStockAnalysisRows(${JSON.stringify(html)})));`],{env:{...process.env,TZ},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);const rows=JSON.parse(result.stdout);assert.equal(rows[0].date,'2026-10-27',TZ);assert.equal(rows[0].volume,1234);
 }
});

test('volume comes from the volume column even when adjusted close exceeds1000',()=>{
 const {parseStockAnalysisRows}=require(adapter);
 const row=parseStockAnalysisRows('<tr><td>Oct 27, 2026</td><td>2000</td><td>2010</td><td>1990</td><td>2001</td><td>2001</td><td>0.1%</td><td>8,765</td></tr>')[0];
 assert.equal(row.volume,8765);
});
