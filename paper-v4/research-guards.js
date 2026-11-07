/* Research-only data guards. No prices or strategy returns are computed here. */
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 root.EGXResearchGuards=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const isDate=x=>/^\d{4}-\d{2}-\d{2}$/.test(String(x||''));
 const isCurrentReport=(report,expected)=>
  Boolean(report&&isDate(report.session)&&report.session===expected&&Array.isArray(report.quotes)&&report.quotes.length>0);
 // A name-based join is not independent identity evidence. Treat even exact token matches as research-only.
 const nameMatched=q=>Boolean(q&&['EXACT_NAME_TOKENS','EXACT_SHORT_NAME'].includes(q.matching)&&q.ticker&&Number(q.close)>0);
 const provisional=q=>Boolean(q&&['MANUAL_PROVISIONAL','EVIDENCE_SUGGESTED_UNVERIFIED'].includes(q.matching));
 const eligible=q=>Boolean(q&&q.identityVerified===true&&q.verifiedIsin&&q.verifiedIsin===q.isin&&q.ohlcvStatus==='PASS_ARITHMETIC'&&!provisional(q));
 const researchRows=report=>(report?.quotes||[]).filter(q=>q.currency==='EGP'&&nameMatched(q));
 const quarantinedRows=report=>(report?.quotes||[]).filter(q=>provisional(q)||q.matching==='UNRESOLVED');
 // Never fabricate a daily candle from a separate report. Immutable historical rows only.
 const datedHistory=(sessions,session)=>Array.isArray(sessions)?sessions.filter(q=>isDate(q.date)&&q.date<=session&&Number(q.close)>0).slice().sort((a,b)=>a.date.localeCompare(b.date)):[];
 return Object.freeze({isCurrentReport,nameMatched,provisional,eligible,researchRows,quarantinedRows,datedHistory});
});
