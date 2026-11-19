/* EGX manual-PDF importer. Local research preview only: never writes remote data.
   PDF.js extraction coordinates are in native PDF units (original EGX page is 1525x1078).
   Version 0.1: fail closed on ambiguity and insufficient coverage. */
"use strict";
const RANKS=["50/30/20","20/40/40","30/30/40","60/20/20","50/20/30","40/40/20","40/30/30","30/40/30","33/33/34"];
const MASTER={
  FWRY:["Fawry For Banking Technology And Electronic Payment","Fawry For Banking"],
  ZEOT:["Extracted Oils"],
  MOSC:["Misr Oils & Soap"],
  EFID:["Edita Food Industries"],
  AJWA:["AJWA for Food Industries company Egypt","AJWA For Food"],
  HRHO:["EFG Holding"],
  COSG:["Cairo Oils & Soap"],
  RAYA:["Raya Holding For Financial Investments"],
  NIPH:["El-Nile Co. For Pharmaceuticals","El-Nile Pharmaceuticals","Nile Pharmaceuticals"],
  MPCI:["Memphis Pharmaceuticals","Memphis For Pharmaceuticals"],
  GTWL:["Golden Textiles & Clothes Wool"],
  ATQA:["Misr National Steel - Ataqa","Misr National Steel"],
  COMI:["Commercial International Bank"],
  EMFD:["Emaar Misr for Development"],
  CIRA:["Cairo For Investment And Real Estate Developments"],
  SAUD:["Al Baraka Bank Egypt"],
  SVCE:["South Valley Cement"],
  TALM:["Taaleem Management Services"],
  INFI:["Ismailia National Food Industries"],
  ARAB:["Arab Developers Holding"]
};
const COLS={
  ref:[230,284],high:[286,333],low:[335,385],
  close:[476,533],change:[532,566],value:[565,643],volume:[680,750]
};
function number(s){const v=String(s||"").replace(/,/g,"").replace(/\s/g,"");return /^-?\d+(?:\.\d+)?$/.test(v)?Number(v):null}
const cleanName=s=>String(s||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
function ticker(name) {
  const n=cleanName(name);
  let matches=[];
  for (const [code,aliases] of Object.entries(MASTER))
    if(aliases.some(a=>n===cleanName(a))) matches.push(code);
  return matches.length===1?matches[0]:null;
}
function dateOf(s){
  const hits=[...s.matchAll(/Trading\s*Date\s*:?\s*(\d{2})\s*\/\s*(\d{2})\s*\/\s*(20\d{2})/gi)];
  const days=[...new Set(hits.map(m=>m[3]+"-"+m[2]+"-"+m[1]))];
  return days.length===1?days[0]:null;
}
function fromPage(page,num){
  const height=page.view[3];
  return page.getTextContent().then(content=>{
    const tokens=[];
    for(const t of content.items){
      const s=String(t.str||"").trim();
      if(!s)continue;
      const x=t.transform[4],y=height-t.transform[5];
      for(const piece of s.split(/\s+/)){
        if(piece)tokens.push({s:piece,x,y});
      }
    }
    const anchors=[];
    for(const w of tokens){
      if(w.x<18||w.x>38||w.y<60||w.y>1065||!/^\d{1,3}$/.test(w.s))continue;
      const curr=tokens.find(u=>u.x>180&&u.x<225&&Math.abs(u.y-w.y)<5&&/^(EGP|USD)$/.test(u.s));
      if(curr&&!anchors.some(a=>Math.abs(a.y-w.y)<1)) anchors.push({rank:Number(w.s),y:w.y,currency:curr.s});
    }
    anchors.sort((a,b)=>a.y-b.y);
    return anchors.map((a,i)=>{
      const lower=i?(anchors[i-1].y+a.y)/2:a.y-18;
      const upper=i+1<anchors.length?(anchors[i+1].y+a.y)/2:a.y+20;
      const names=tokens.filter(t=>t.x>=41&&t.x<185&&t.y>=lower&&t.y<upper)
        .sort((a,b)=>Math.round(a.y/6)-Math.round(b.y/6)||a.x-b.x);
      const name=names.map(t=>t.s).join(" ").trim();
      const row={rank:a.rank,name,currency:a.currency,page:num,symbol:ticker(name)};
      for(const [k,range] of Object.entries(COLS)){
        const parts=tokens.filter(t=>t.x>=range[0]&&t.x<range[1]&&Math.abs(t.y-a.y)<5).sort((a,b)=>a.x-b.x);
        row[k]=number(parts.map(x=>x.s).join(""));
      }
      const issues=[];
      if(!name)issues.push("NAME_MISSING");
      if(!Number.isFinite(row.high)||!Number.isFinite(row.low)||!Number.isFinite(row.close)||row.low<=0||row.high<row.low||row.close<row.low-0.0001||row.close>row.high+0.0001)issues.push("PRICE_INVALID");
      if(!Number.isFinite(row.value)||row.value<=0||!Number.isFinite(row.volume)||row.volume<=0)issues.push("LIQUIDITY_INVALID");
      if(!Number.isFinite(row.change))issues.push("CHANGE_INVALID");
      row.issues=issues;
      return row;
    });
  });
}
async function parse(file,update){
  if(file.size<20_000||file.size>30_000_000)throw Error("حجم الملف غير مقبول");
  const bytes=await file.arrayBuffer();
  if(new TextDecoder().decode(bytes.slice(0,5))!=="%PDF-")throw Error("توقيع PDF غير صحيح");
  const h=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(x=>x.toString(16).padStart(2,"0")).join("");
  const lib=await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs");
  lib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs";
  const pdf=await lib.getDocument({data:new Uint8Array(bytes)}).promise;
  if(pdf.numPages<15||pdf.numPages>120)throw Error("عدد صفحات PDF غير معتاد");
  let header="";
  for(let n=1;n<=Math.min(4,pdf.numPages);n++)header+=(await (await pdf.getPage(n)).getTextContent()).items.map(x=>x.str).join(" ")+" ";
  const session=dateOf(header);
  if(!session)throw Error("لا يمكن التحقق من تاريخ جلسة واحد");
  const rows=[];
  let active=false;
  for(let n=1;n<=pdf.numPages;n++){
    const page=await pdf.getPage(n);
    const t=(await page.getTextContent()).items.map(x=>x.str||"").join(" ");
    if(t.includes("Main Market Stocks Indicators sorted by Value Traded")) active=true;
    if(!active)continue;
    const chunk=await fromPage(page,n);
    if(rows.length&&(!chunk.length||chunk[0].rank<=rows[rows.length-1].rank))break;
    rows.push(...chunk);
    update?.("تحليل صفحة "+n+" — الأسهم "+rows.length);
    if(rows.length>350)throw Error("تم تجاوز عدد صفوف غير معتاد");
  }
  const ranks=rows.map(r=>r.rank);
  const full=rows.length>0 && ranks[0]===1 && ranks.every((n,i)=>n===i+1);
  const eligible=rows.filter(r=>r.currency==="EGP"&&r.issues.length===0);
  if(!full||rows.length<200)throw Error("فشل اكتمال جدول السوق — "+rows.length+" صفًا، يرجى رفع التقرير الرسمي الكامل");
  if(eligible.length<190){
    const counts={};for(const r of rows)for(const k of r.issues)counts[k]=(counts[k]||0)+1;
    const summary=Object.entries(counts).map(([k,n])=>k+"="+n).join("، ");
    throw Error("عدد صفوف الأسعار السليمة "+eligible.length+" من "+rows.length+
      " | أسباب الرفض: "+(summary||"غير محددة")+
      " | لا تغيّر التوصيات حتى يتم تصحيح الاستيراد");
  }
  const mapped=eligible.filter(r=>r.symbol);
  const distinct=new Set(mapped.map(r=>r.symbol));
  if(distinct.size!==mapped.length)throw Error("تكرار في رموز الشركات المطابقة");
  return {session,hash,pages:pdf.numPages,rows,eligible,mapped,full,
    quality:"LOCAL_PRICE_VALIDATION_ONLY",centralDbUpdated:false,certified:false};
}
function rank(all,weights){
  const pct=(field,asc=false)=>{
    const sorted=[...all].sort((a,b)=>a[field]-b[field]),v=new Map();
    sorted.forEach((s,i)=>v.set(s.rank,100*(i+1)/sorted.length));
    return v;
  };
  const change=pct("change"),position=pct("position"),liquidity=pct("value");
  const [a,b,c]=weights.split("/").map(Number);
  return all.map(x=>({...x,score:(a*change.get(x.rank)+b*position.get(x.rank)+c*liquidity.get(x.rank))/100}))
    .sort((x,y)=>y.score-x.score).slice(0,5);
}
function compute(data) {
  const universe=data.eligible.filter(r=>r.high>r.low).map(r=>({...r,position:(r.close-r.low)/(r.high-r.low)}));
  const rankings={};
  for(const w of RANKS)rankings[w]=rank(universe,w).map(r=>{
    const entry=+(r.high+.01).toFixed(2),stop=+(r.low-.01).toFixed(2),risk=entry-stop;
    return {symbol:r.symbol||"UNVERIFIED",name:r.name,close:r.close,change:r.change,score:r.score,entry,stop,t1:+(entry+risk).toFixed(2),t2:+(entry+2*risk).toFixed(2),riskPct:+(100*risk/entry).toFixed(2),identityVerified:false,sourcePage:r.page};
  });
  return rankings;
}
function outcomes(data,prev){
  if(!prev||!(prev.rankings||prev.weights))return [];
  const plans=(prev.rankings||prev.weights)["30/40/30"]||[];
  const bySymbol=new Map(data.mapped.map(r=>[r.symbol,r]));
  return plans.map(p=>{
    const r=bySymbol.get(p.symbol);
    if(!r)return {symbol:p.symbol,state:"IDENTITY_OR_PRICE_UNAVAILABLE"};
    const high=r.high,low=r.low,entry=p.entry,stop=p.stop,target=p.target1??p.t1;
    if(!Number.isFinite(entry)||!Number.isFinite(stop)||!Number.isFinite(target))return {symbol:p.symbol,state:"PLAN_MISSING"};
    let state="NO_ENTRY";
    if(high>=entry&&low<=entry)state=(low<=stop&&high>=target)?"ORDER_UNKNOWN":low<=stop?"STOP_SEQUENCE_UNKNOWN":high>=target?"TARGET_SEQUENCE_UNKNOWN":"ENTRY_TOUCHED_ONLY";
    return {symbol:p.symbol,close:r.close,high,low,state,executed:false};
  });
}
export {parse,compute,outcomes,RANKS,fromPage,COLS};
