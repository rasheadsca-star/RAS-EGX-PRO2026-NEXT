'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parse,dateFromHeader}=require('../../scripts/research/egx-directfn-exact-session-probe.cjs');
const row=(name,ticker,open,last,high,low,volume)=>'<tr>'+[name,ticker,open,last,high,low,'0','0',volume,'12345'].map(v=>'<td>'+v+'</td>').join('')+'</tr>';
test('explicit source date required and matching exact 26 October row staged',()=>{
 const html='<div>EGX Closed 26 Oct 2026</div><table>'+row('ACAP','ACAP','8.31','8.27','8.41','8.23','201913')+'</table>';
 const r=parse(html,'2026-10-26');
 assert.equal(r.sourceDate,'2026-10-26');
 assert.equal(r.rows[0].ticker,'ACAP');
 assert.equal(r.rows[0].status,'RESEARCH_VALID_CANDLE');
 assert.equal(r.validExactSession,1);
 assert.equal(r.rows[0].promotionApproved,false);
});
test('stale page never becomes exact session truth even with valid OHLCV',()=>{
 const html='<div>EGX Closed 10 Aug 2026</div><table>'+row('BONY','BONY','3.82','3.84','3.86','3.82','1919299')+'</table>';
 const r=parse(html,'2026-10-26');
 assert.equal(r.exactSession,false);
 assert.equal(r.rows[0].status,'STALE_OR_WRONG_SESSION');
 assert.equal(r.validExactSession,0);
});
test('invalid zero opening price must not be labeled validated OHLCV',()=>{
 const h='<div>EGX Closed 26 Oct 2026</div>'+row('KRDI','KRDI','0','0.42','0.43','0.42','52119131');
 assert.equal(parse(h,'2026-10-26').rows[0].status,'INVALID_OHLCV');
});
test('missing source date is never assumed current',()=>{
 const h='<div>EGX</div>'+row('ACAP','ACAP','8.31','8.27','8.41','8.23','201913');
 assert.equal(dateFromHeader(h),null);
 assert.equal(parse(h,'2026-10-26').validExactSession,0);
});
