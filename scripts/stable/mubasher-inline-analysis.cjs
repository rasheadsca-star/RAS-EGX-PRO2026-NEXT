'use strict';
// Parse only literal arrays emitted by observed Mubasher analysis pages.
// Never execute provider JavaScript and never derive executable OHLCV.
const KEYS={volume:'volumes',liquidity:'liquidityMonitors',supportResistance:'supportRisistance'};
const MONTHS={'يناير':1,'فبراير':2,'مارس':3,'أبريل':4,'ابريل':4,'مايو':5,'يونيو':6,'يوليو':7,'أغسطس':8,'اغسطس':8,'سبتمبر':9,'أكتوبر':10,'اكتوبر':10,'نوفمبر':11,'ديسمبر':12};
function quotedValue(body){
 let value='';
 const escapes={n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v',"'":"'",'"':'"','\\':'\\','/':'/'};
 for(let i=0;i<body.length;i++){
  if(body[i]!=='\\'){value+=body[i];continue;}
  const next=body[++i];
  if(next==='u'||next==='x'){
   const size=next==='u'?4:2,hex=body.slice(i+1,i+1+size);
   if(!new RegExp('^[0-9a-f]{'+size+'}$','i').test(hex))throw Error('INVALID_PROVIDER_STRING_ESCAPE');
   value+=String.fromCharCode(parseInt(hex,16));i+=size;
  }else if(Object.hasOwn(escapes,next)){value+=escapes[next];}
  else throw Error('UNSUPPORTED_PROVIDER_STRING_ESCAPE');
 }
 return value;
}
function providerLiteral(text){
 const json=String(text).replace(/'((?:\\.|[^'\\])*)'/g,(_,body)=>JSON.stringify(quotedValue(body)));
 return JSON.parse(json);
}
function literalArray(html,key){
 const match=new RegExp('window\\.midata\\.'+key+'\\s*=\\s*\\[').exec(String(html));
 if(!match)return [];
 const start=match.index+match[0].length-1;let quote=null,escape=false,depth=0;
 for(let i=start;i<html.length;i++){
  const ch=html[i];
  if(quote){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch===quote)quote=null;continue;}
  if(ch==='"'||ch==="'"){quote=ch;continue;}
  if(ch==='[')depth++;else if(ch===']'&&--depth===0){const value=providerLiteral(html.slice(start,i+1));return Array.isArray(value)?value:[];}
 }
 throw Error('UNTERMINATED_MUBASHER_LITERAL');
}
function explicitSession(value){
 const s=String(value||'').replace(/[٠-٩]/g,c=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
 const iso=s.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s|T|$)/);
 if(iso){const y=Number(iso[1]),m=Number(iso[2]),day=Number(iso[3]),d=new Date(Date.UTC(y,m-1,day));return d.getUTCFullYear()===y&&d.getUTCMonth()===m-1&&d.getUTCDate()===day?d.toISOString().slice(0,10):null;}
 const m=s.match(/^(\d{1,2})\s+([^\s]+)\s+(20\d{2})(?:\s|$)/);
 if(!m||!MONTHS[m[2]])return null;
 const day=Number(m[1]),month=MONTHS[m[2]],year=Number(m[3]);
 const d=new Date(Date.UTC(year,month-1,day));return d.getUTCFullYear()===year&&d.getUTCMonth()===month-1&&d.getUTCDate()===day?d.toISOString().slice(0,10):null;
}
function parseInlineRows(html,group,sourceUrl,expectedSession=null){
 const key=KEYS[group];if(!key)return [];
 return literalArray(html,key).flatMap(raw=>{
  const m=String(raw?.url||'').match(/^\/markets\/EGX\/stocks\/([A-Z0-9._-]+)(?:\/support-resistance)?\/?$/i);if(!m)return [];
  const sessionDate=explicitSession(raw.updatedAt);
  return [{symbol:m[1].toUpperCase(),name:raw.name||m[1],raw,sourceProvider:'MUBASHER',sourceUrl,providerDataset:key,
   sourceSessionText:raw.updatedAt??null,sourceSessionDate:sessionDate,
   sourceSessionStatus:!sessionDate?'EXPLICIT_YEAR_OR_DATE_MISSING':!expectedSession?'EXPLICIT_SESSION_UNCOMPARED':sessionDate!==expectedSession?'SESSION_MISMATCH':'EXPLICIT_SESSION',
   independentSource:false,executionGrade:false,evidenceScope:'SUPPORTING_ANALYSIS_ONLY_NO_OHLCV'}];
 });
}
function selectSupportingRow(previous,next,group){
 if(!previous)return next;
 if(previous.sourceSessionStatus==='CONFLICTING_PROVIDER_ROWS'&&previous.sourceSessionDate===next.sourceSessionDate)return {...previous,conflictingRows:[...(previous.conflictingRows||[]),next.raw]};
 const p=previous.sourceSessionStatus==='EXPLICIT_SESSION',n=next.sourceSessionStatus==='EXPLICIT_SESSION';
 if(p&&!n)return previous;if(n&&!p)return next;
 const fields={volume:['volume','weekAverage','monthAverage'],liquidity:['lastPrice','turnover','inFlow','outFlow','changePercentage'],supportResistance:['lastPrice','l1Support','l2Support','l1Resistance','l2Resistance']}[group]||[];
 if(previous.sourceSessionDate&&previous.sourceSessionDate===next.sourceSessionDate){
  if(JSON.stringify(fields.map(k=>previous.raw?.[k]??null))!==JSON.stringify(fields.map(k=>next.raw?.[k]??null)))
   return {...previous,raw:null,sourceSessionStatus:'CONFLICTING_PROVIDER_ROWS',conflictingRows:[previous.raw,next.raw],executionGrade:false};
  return previous;
 }
 if((previous.sourceSessionDate||'')>(next.sourceSessionDate||''))return previous;
 return next;
}
module.exports={providerLiteral,literalArray,explicitSession,parseInlineRows,selectSupportingRow};
