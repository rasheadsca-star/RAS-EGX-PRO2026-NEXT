(function(w){'use strict';
const KEY='egx-v4-official-import-v1';
const clean=x=>String(x||'').replace(/\s+/g,' ').trim();
const val=x=>{const n=Number(clean(x).replace(/,/g,''));return Number.isFinite(n)?n:NaN};
function parseRows(pages,session){
 const rows=[],rejected=[];
 for(const page of pages){
  const a=page.items.filter(t=>t.text).sort((x,y)=>x.y-y.y);
  const ids=a.filter(t=>t.x<45&&/^\d{1,3}(?:\s|$)/.test(t.text)&&t.y>160&&t.y<1020);
  for(let i=0;i<ids.length;i++){
   const m=ids[i].text.match(/^(\d{1,3})(?:\s+(.*))?$/);if(!m||Number(m[1])>400)continue;
   const top=Math.max(310,((ids[i-1]?.y??ids[i].y-35)+ids[i].y)/2);
   const end=Math.min(1100,((ids[i+1]?.y??ids[i].y+40)+ids[i].y)/2);
   const own=a.filter(t=>t.y>=top&&t.y<end);
   const curr=own.filter(t=>t.x>175&&t.x<227&&/^(EGP|USD)$/.test(t.text));
   if(curr.length!==1)continue;
   const line=own.filter(t=>Math.abs(t.y-curr[0].y)<5.2);
   const cell=(lo,hi)=>val(line.filter(t=>t.x>=lo&&t.x<hi).map(t=>t.text).join(''));
   const name=clean([m[2]||'',...own.filter(t=>t.x>=40&&t.x<189).sort((x,y)=>x.y-y.y||x.x-y.x).map(t=>t.text)].join(' '));
   const row={rowNumber:Number(m[1]),name,date:session,currency:curr[0].text,open:cell(228,285),high:cell(285,337),low:cell(337,382),close:cell(475,532),volume:cell(678,755),page:page.number,source:'USER_SUPPLIED_EGX_DAILY_PDF'};
   if(name.length>2&&row.low>0&&row.low<=Math.min(row.open,row.close)&&row.high>=Math.max(row.open,row.close)&&row.volume>=0&&[row.open,row.high,row.low,row.close,row.volume].every(Number.isFinite))rows.push(row);
   else rejected.push({rowNumber:row.rowNumber,page:page.number,reason:'INVALID_OHLCV'});
  }
 }
 const unique=new Map();for(const r of rows){if(unique.has(r.rowNumber))rejected.push({rowNumber:r.rowNumber,reason:'DUPLICATE_ROW'});else unique.set(r.rowNumber,r)}
 return {rows:[...unique.values()].sort((a,b)=>a.rowNumber-b.rowNumber),rejected};
}
async function importPdf(file,onPage){
 if(!file||!/\.pdf$/i.test(file.name)||file.size>30*1024*1024)throw Error('اختر تقرير PDF بحجم أقل من 30 MB');
 if(!w.pdfjsLib)throw Error('تعذر تحميل مكتبة PDF');
 const bytes=new Uint8Array(await file.arrayBuffer());
 const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
 const sha256=[...digest].map(x=>x.toString(16).padStart(2,'0')).join('');
 const doc=await pdfjsLib.getDocument({data:bytes}).promise;
 if(doc.numPages<10||doc.numPages>120)throw Error('عدد صفحات التقرير غير متوقع');
 const pages=[];let date=null,issued=false,official=false;
 for(let i=1;i<=doc.numPages;i++){
  onPage?.(i,doc.numPages);
  const page=await doc.getPage(i),tc=await page.getTextContent(),height=page.view[3];
  const items=tc.items.filter(t=>typeof t.str==='string').map(t=>({x:t.transform[4],y:height-t.transform[5],text:clean(t.str)}));
  const text=items.map(t=>t.text).join(' ');
  if(i<=4){
   const match=text.match(/Trading Date:\s*(\d{2})\/(\d{2})\/(\d{4})/i);
   if(match)date=match[3]+'-'+match[2]+'-'+match[1];
   issued=issued||/Issued at\s*\d{2}\/\d{2}\/\d{4}/i.test(text);
   official=official||/The Egyptian Exchange|Daily Report|Market Indices/i.test(text);
  }
  pages.push({number:i,items});
 }
 if(!date||!issued||!official)throw Error('لم ينجح التحقق من شكل التقرير وتاريخ جلسة التداول');
 const parsed=parseRows(pages,date);
 if(parsed.rows.length<80)throw Error('تغطية الأسعار غير كافية: '+parsed.rows.length+'؛ لم تُحفظ البيانات');
 const result={schemaVersion:'1.0',session:date,filename:file.name,sha256,importedAt:new Date().toISOString(),mode:'LOCAL_RESEARCH_ONLY',rows:parsed.rows,rejected:parsed.rejected,identityVerified:false,sourceAuthenticated:false,centralDatabaseUpdated:false,recommendationsGenerated:false};
 localStorage.setItem(KEY,JSON.stringify(result));return result;
}
function read(){try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch(_){return null}}
w.EGXOfficialImport={importPdf,read,KEY};
})(window);
