(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  if(root) root.V169PositionAdvisoryCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const num=v=>Number.isFinite(Number(v))?Number(v):null;
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,Number(v)||0));
  const mean=a=>a.length?a.reduce((s,v)=>s+v,0)/a.length:null;
  const pct=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&b!==0?(a/b-1)*100:null;

  function sessionsOf(data){
    const rows=Array.isArray(data)?data:Array.isArray(data?.sessions)?data.sessions:Array.isArray(data?.rows)?data.rows:Array.isArray(data?.history)?data.history:[];
    return rows.filter(r=>[r?.open,r?.high,r?.low,r?.close].every(v=>num(v)!==null)).map(r=>({
      date:String(r.date||r.sessionDate||r.session||''),open:+r.open,high:+r.high,low:+r.low,close:+r.close,volume:Math.max(0,num(r.volume)||0)
    })).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.date)).sort((a,b)=>a.date.localeCompare(b.date));
  }

  function mergeQuote(rows,quote){
    const out=sessionsOf(rows),date=String(quote?.sourceSessionDate||''),open=num(quote?.open),high=num(quote?.high),low=num(quote?.low),close=num(quote?.price),volume=Math.max(0,num(quote?.volume)||0);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||![open,high,low,close].every(v=>v!==null&&v>0)||high<Math.max(open,close)||low>Math.min(open,close)||high<low)return out;
    const filtered=out.filter(r=>r.date!==date);filtered.push({date,open,high,low,close,volume});return filtered.sort((a,b)=>a.date.localeCompare(b.date));
  }

  function emaSeries(values,period){
    const out=Array(values.length).fill(null);if(values.length<period)return out;const k=2/(period+1);let cur=mean(values.slice(0,period));out[period-1]=cur;
    for(let i=period;i<values.length;i++){cur=values[i]*k+cur*(1-k);out[i]=cur}return out;
  }
  function ema(values,period){return [...emaSeries(values,period)].reverse().find(Number.isFinite)??null}
  function sma(values,period){return values.length>=period?mean(values.slice(-period)):null}
  function rsi(values,period=14){if(values.length<=period)return null;let gains=0,losses=0;for(let i=values.length-period;i<values.length;i++){const d=values[i]-values[i-1];if(d>=0)gains+=d;else losses-=d}if(losses===0)return 100;const rs=(gains/period)/(losses/period);return 100-100/(1+rs)}
  function atr(rows,period=14){if(rows.length<=period)return null;const tr=[];for(let i=1;i<rows.length;i++)tr.push(Math.max(rows[i].high-rows[i].low,Math.abs(rows[i].high-rows[i-1].close),Math.abs(rows[i].low-rows[i-1].close)));return tr.length>=period?mean(tr.slice(-period)):null}
  function macd(values){const a=emaSeries(values,12),b=emaSeries(values,26),line=values.map((_,i)=>Number.isFinite(a[i])&&Number.isFinite(b[i])?a[i]-b[i]:null),valid=line.filter(Number.isFinite);if(valid.length<9)return{line:null,signal:null,hist:null};const signal=ema(valid,9),latest=[...line].reverse().find(Number.isFinite);return{line:latest,signal,hist:Number.isFinite(latest)&&Number.isFinite(signal)?latest-signal:null}}
  function volumeRatio(rows,period=20){if(rows.length<period+1)return null;const values=rows.slice(-(period+1)).map(r=>r.volume),avg=mean(values.slice(0,-1));return avg>0?values.at(-1)/avg:null}
  function slopePct(values,period=20){if(values.length<period)return null;const y=values.slice(-period),xb=(period-1)/2,yb=mean(y);let n=0,d=0;for(let i=0;i<period;i++){n+=(i-xb)*(y[i]-yb);d+=(i-xb)**2}return d&&yb?n/d/yb*100:null}

  function swingLevels(rows,price){
    const d=rows.slice(-120),sup=[],res=[];for(let i=2;i<d.length-2;i++){
      if(d[i].low<=d[i-1].low&&d[i].low<=d[i-2].low&&d[i].low<=d[i+1].low&&d[i].low<=d[i+2].low)sup.push(d[i].low);
      if(d[i].high>=d[i-1].high&&d[i].high>=d[i-2].high&&d[i].high>=d[i+1].high&&d[i].high>=d[i+2].high)res.push(d[i].high);
    }
    const cluster=values=>{const out=[];for(const v of [...values].sort((a,b)=>a-b)){const last=out.at(-1);if(!last||Math.abs(v-last.level)/Math.max(last.level,.001)>.012)out.push({level:v,touches:1});else{last.level=(last.level*last.touches+v)/(last.touches+1);last.touches++}}return out};
    return{supports:cluster(sup).filter(x=>x.level<price).sort((a,b)=>b.level-a.level).slice(0,3),resistances:cluster(res).filter(x=>x.level>price).sort((a,b)=>a.level-b.level).slice(0,3)};
  }

  function fibonacci(rows){
    const d=rows.slice(-100);if(d.length<20)return null;let hi=-Infinity,lo=Infinity,hiI=-1,loI=-1;d.forEach((r,i)=>{if(r.high>hi){hi=r.high;hiI=i}if(r.low<lo){lo=r.low;loI=i}});if(!(hi>lo))return null;const rg=hi-lo,up=loI<hiI;
    return up?{direction:'UP',high:hi,low:lo,r382:hi-.382*rg,r500:hi-.5*rg,r618:hi-.618*rg,e1272:hi+.272*rg,e1618:hi+.618*rg}:{direction:'DOWN',high:hi,low:lo,r382:lo+.382*rg,r500:lo+.5*rg,r618:lo+.618*rg,e1272:lo-.272*rg,e1618:lo-.618*rg};
  }

  function isoWeekKey(date){
    const d=new Date(`${date}T12:00:00Z`);if(Number.isNaN(d.getTime()))return date;const day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day+3);const first=new Date(Date.UTC(d.getUTCFullYear(),0,4));const week=1+Math.round(((d-first)/86400000-3+((first.getUTCDay()+6)%7))/7);return `${d.getUTCFullYear()}-${String(week).padStart(2,'0')}`;
  }
  function weeklyTrend(rows){
    const map=new Map();for(const r of rows){const k=isoWeekKey(r.date),cur=map.get(k)||{date:r.date,close:r.close};cur.date=r.date;cur.close=r.close;map.set(k,cur)}
    const closes=[...map.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(x=>x.close);if(closes.length<6)return{ready:false,bias:'UNKNOWN',ema4:null,ema10:null,return4:null};const e4=ema(closes,4),e10=ema(closes,Math.min(10,closes.length)),ret4=closes.length>4?pct(closes.at(-1),closes.at(-5)):null;return{ready:true,bias:e4>e10&&ret4>0?'UP':e4<e10&&ret4<0?'DOWN':'SIDE',ema4:e4,ema10:e10,return4:ret4};
  }

  function stateAt(rows,end){
    if(end<54)return null;const d=rows.slice(0,end+1),c=d.map(r=>r.close),price=c.at(-1),e20=ema(c,20),e50=ema(c,50),rr=rsi(c),mm=macd(c),aa=atr(d),vr=volumeRatio(d),r5=c.length>5?pct(price,c.at(-6)):0,r20=c.length>20?pct(price,c.at(-21)):0,sl=slopePct(c,20);if(![price,e20,e50,rr,aa].every(Number.isFinite))return null;
    return{priceEma20:pct(price,e20),emaGap:pct(e20,e50),rsi:rr,macd:Number.isFinite(mm.hist)?mm.hist/price*100:0,vol:Number.isFinite(vr)?vr:1,ret5:r5||0,ret20:r20||0,atr:aa/price*100,slope:Number.isFinite(sl)?sl:0};
  }
  function distance(a,b){const p=[[a.priceEma20,b.priceEma20,5,.17],[a.emaGap,b.emaGap,4,.16],[a.rsi,b.rsi,22,.15],[a.macd,b.macd,1.6,.13],[a.vol,b.vol,1.2,.08],[a.ret5,b.ret5,9,.09],[a.ret20,b.ret20,18,.09],[a.atr,b.atr,3,.06],[a.slope,b.slope,.8,.07]];return p.reduce((s,[x,y,scale,w])=>s+w*clamp(Math.abs(x-y)/scale,0,2.2),0)}
  function classify(ret,atrPct,h){const threshold=Math.max(h===1?.8:h===3?1.35:1.8,.48*atrPct*Math.sqrt(h));return ret>threshold?'bull':ret<-threshold?'bear':'side'}
  function calibrate(rows){
    if(rows.length<70)return{ready:false,reason:`السجل ${rows.length} جلسة فقط`,matches:0,quality:0,horizons:[]};const cur=stateAt(rows,rows.length-1);if(!cur)return{ready:false,reason:'تعذر تكوين البصمة الحالية',matches:0,quality:0,horizons:[]};
    const candidates=[];for(let i=54;i<=rows.length-6;i++){const s=stateAt(rows,i);if(!s)continue;const sim=Math.exp(-1.55*distance(cur,s));candidates.push({i,s,sim})}candidates.sort((a,b)=>b.sim-a.sim);let matches=candidates.filter(x=>x.sim>=.18).slice(0,24);if(matches.length<10)matches=candidates.slice(0,14);if(matches.length<8)return{ready:false,reason:`الحالات المشابهة ${matches.length} فقط`,matches:matches.length,quality:0,horizons:[]};
    const horizon=h=>{let w=0,bull=.55,side=.55,bear=.55,ret=0,n=0;for(const x of matches){if(x.i+h>=rows.length)continue;const rr=pct(rows[x.i+h].close,rows[x.i].close);if(!Number.isFinite(rr))continue;const k=classify(rr,x.s.atr,h);if(k==='bull')bull+=x.sim;else if(k==='bear')bear+=x.sim;else side+=x.sim;w+=x.sim;ret+=x.sim*rr;n++}const den=w+1.65;return{h,n,bull:bull/den*100,side:side/den*100,bear:bear/den*100,expected:w?ret/w:null}};
    const horizons=[horizon(1),horizon(3),horizon(5)],similarity=mean(matches.map(x=>x.sim))*100,quality=clamp((similarity/100)*clamp(matches.length/18,0,1),0,1);return{ready:true,matches:matches.length,similarity,quality,horizons};
  }

  function evidence(rows,price){
    const closes=rows.map(r=>r.close),e20=ema(closes,20),e50=ema(closes,50),s200=sma(closes,200),rr=rsi(closes),mm=macd(closes),aa=atr(rows),vr=volumeRatio(rows),r5=closes.length>5?pct(price,closes.at(-6)):null,r20=closes.length>20?pct(price,closes.at(-21)):null,sl=slopePct(closes,20),lv=swingLevels(rows,price),fib=fibonacci(rows),wk=weeklyTrend(rows),items=[];
    const add=(name,w,state,why)=>items.push({name,w,state:clamp(state,-1,1),why});
    if(e20)add('السعر/EMA20',12,price>e20?1:-1,price>e20?'فوق EMA20':'تحت EMA20');
    if(e20&&e50)add('EMA20/EMA50',13,e20>e50?1:-1,e20>e50?'ترتيب صاعد':'ترتيب هابط');
    if(s200)add('SMA200',7,price>s200?.7:-.7,price>s200?'فوق الاتجاه الطويل':'تحت الاتجاه الطويل');
    if(Number.isFinite(mm.hist))add('MACD',11,mm.hist>0?1:-1,mm.hist>0?'Histogram موجب':'Histogram سالب');
    if(Number.isFinite(rr)){const state=rr>=52&&rr<=68?.9:rr>78?-.4:rr<38?-.85:rr>=45&&rr<52?-.15:rr>68?.2:0;add('RSI14',10,state,`RSI ${rr.toFixed(1)}`)}
    if(Number.isFinite(vr)){const dir=Math.sign(r5||0);add('الحجم',7,vr>=1.2?dir*.75:dir*.15,`${vr.toFixed(2)}× متوسط 20`)}
    if(Number.isFinite(r5))add('Momentum5',7,clamp(r5/7,-1,1),`${r5.toFixed(2)}%`);
    if(Number.isFinite(r20))add('Momentum20',9,clamp(r20/14,-1,1),`${r20.toFixed(2)}%`);
    if(Number.isFinite(sl))add('Slope20',5,clamp(sl/.8,-1,1),`${sl.toFixed(3)}%/جلسة`);
    if(wk.ready)add('Weekly',9,wk.bias==='UP'?.8:wk.bias==='DOWN'?-.8:0,`اتجاه أسبوعي ${wk.bias}`);
    const s=lv.supports[0]?.level,r=lv.resistances[0]?.level;if(s&&r){const dn=(price/s-1)*100,up=(r/price-1)*100;add('دعم/مقاومة',10,up/Math.max(dn,.3)>1.5?.7:up/Math.max(dn,.3)<.7?-.7:0,`للمقاومة ${up.toFixed(1)}% · للدعم ${dn.toFixed(1)}%`)}
    let bull=22,side=28,bear=22;for(const x of items){bull+=x.w*Math.max(x.state,0);bear+=x.w*Math.max(-x.state,0);side+=x.w*(1-Math.abs(x.state))*.5}const total=bull+side+bear;bull=bull/total*100;side=side/total*100;bear=bear/total*100;
    const score=clamp(50+(bull-bear)*.65,0,100);return{items,bull,side,bear,score,ema20:e20,ema50:e50,sma200:s200,rsi14:rr,macd:mm,atr14:aa,volumeRatio:vr,ret5:r5,ret20:r20,slope20:sl,supports:lv.supports,resistances:lv.resistances,fib,weekly:wk};
  }

  function analyze(data,quote=null){
    let rows=sessionsOf(data);if(quote)rows=mergeQuote(rows,quote);if(rows.length<30)return{ready:false,reason:`السجل المتاح ${rows.length} جلسة`,bars:rows};const last=rows.at(-1),live=num(quote?.price),price=live>0?live:last.close,ev=evidence(rows,price),cal=calibrate(rows);let bull=ev.bull,side=ev.side,bear=ev.bear,alpha=0;
    if(cal.ready){alpha=clamp(.25+.35*cal.quality,.25,.55);const mix=k=>.2*cal.horizons[0][k]+.35*cal.horizons[1][k]+.45*cal.horizons[2][k];bull=ev.bull*(1-alpha)+mix('bull')*alpha;side=ev.side*(1-alpha)+mix('side')*alpha;bear=ev.bear*(1-alpha)+mix('bear')*alpha;const t=bull+side+bear;bull=bull/t*100;side=side/t*100;bear=bear/t*100}
    const ordered=[['bull',bull],['side',side],['bear',bear]].sort((a,b)=>b[1]-a[1]),spread=ordered[0][1]-ordered[1][1],dataScore=clamp(rows.length/180*100,25,100),calScore=cal.ready?clamp(cal.quality*100,0,100):30,indicatorCount=ev.items.length,confidenceScore=Math.round(.38*dataScore+.37*calScore+.25*clamp(indicatorCount/10*100,0,100));const confidence=confidenceScore>=72&&spread>=10?'مرتفع':confidenceScore>=52?'متوسط':'منخفض';
    return{ready:true,bars:rows,session:last.date,price,quoteUsed:live>0,evidence:ev,calibration:cal,final:{bull,side,bear,alpha,confidence,confidenceScore,stance:ordered[0][0]},barsAnalyzed:rows.length};
  }

  function normalizePortfolio(rows){
    const list=Array.isArray(rows)?rows:[],groups=new Map();for(const row of list){const ticker=String(row?.ticker||'').trim().toUpperCase(),q=num(row?.quantity??row?.qty),avg=num(row?.averagePrice??row?.avgCost??row?.entry),stop=num(row?.stop??row?.stopLoss),target=num(row?.target??row?.target1);if(!ticker||!(q>0&&avg>0))continue;const cur=groups.get(ticker)||{ticker,quantity:0,cost:0,stop:null,target:null,name:row.name||row.companyNameAr||'',sourceRows:[]};cur.quantity+=q;cur.cost+=q*avg;cur.stop=stop>0?Math.max(cur.stop||0,stop):cur.stop;cur.target=target>0?Math.max(cur.target||0,target):cur.target;cur.sourceRows.push(row);groups.set(ticker,cur)}
    return[...groups.values()].map(x=>({ticker:x.ticker,quantity:x.quantity,averagePrice:x.cost/x.quantity,stop:x.stop,target:x.target,name:x.name,sourceRows:x.sourceRows}));
  }

  function nextTechnicalTarget(analysis,price,target1,stop,entryHigh){
    const candidates=[];for(const r of analysis?.evidence?.resistances||[])if(num(r.level)>price*1.003)candidates.push(num(r.level));const fib=analysis?.evidence?.fib;if(num(fib?.e1272)>price)candidates.push(num(fib.e1272));if(num(fib?.e1618)>price)candidates.push(num(fib.e1618));const risk=Math.max(.001,(num(entryHigh)||price)-(num(stop)||price*.95));if(num(target1)>0)candidates.push(target1+Math.max(risk*.75,(num(analysis?.evidence?.atr14)||0)*1.2));else candidates.push(price+Math.max(risk,(num(analysis?.evidence?.atr14)||price*.02)*1.5));return Math.min(...candidates.filter(v=>Number.isFinite(v)&&v>price*1.003));
  }

  function advisory({holding=null,recommendation=null,analysis=null,quote=null}){
    const price=num(quote?.price)??num(analysis?.price),held=holding&&num(holding.quantity)>0,avg=num(holding?.averagePrice),entryLow=num(recommendation?.entryLow),entryHigh=num(recommendation?.entryHigh),officialStop=num(recommendation?.stopLoss),userStop=num(holding?.stop),stop=userStop>0?userStop:officialStop>0?officialStop:num(analysis?.evidence?.supports?.[0]?.level)*.985,target1=num(recommendation?.target1)??num(holding?.target),high=num(quote?.high),ev=analysis?.evidence||{},fin=analysis?.final||{},bull=num(fin.bull)||0,bear=num(fin.bear)||0,side=num(fin.side)||0,ema20=num(ev.ema20),ema50=num(ev.ema50),atr14=num(ev.atr14),recommended=Boolean(recommendation),targetTouched=target1>0&&((price||0)>=target1||(high||0)>=target1),bearish=bear>bull+8||(ema20>0&&ema50>0&&price<ema20&&ema20<ema50),bullish=bull>bear+8&&(!ema20||price>=ema20)&&(!ema50||ema20>=ema50*.985),nextTarget=price>0?nextTechnicalTarget(analysis,price,target1,stop,entryHigh):null,pnlPct=held&&avg>0&&price>0?pct(price,avg):null;
    const common={price,stop,target1,nextTarget,pnlPct,recommended,held,confidence:fin.confidence||'منخفض',confidenceScore:num(fin.confidenceScore),bull,side,bear,automaticOrder:false,advisoryOnly:true};
    if(!(price>0)||!analysis?.ready)return{...common,code:'WAIT_DATA',labelAr:'انتظر تحديث البيانات',tone:'neutral',reasonAr:'لا توجد قراءة سعر/تاريخ كافية لإصدار إدارة فنية محدثة.',reasons:['فشل اكتمال السعر أو التاريخ.']};
    if(held&&stop>0&&price<=stop)return{...common,code:'SELL_EXIT',labelAr:'بيع / خروج',tone:'danger',reasonAr:'السعر عند أو أسفل وقف الحماية للمركز.',reasons:[`السعر ${price.toFixed(3)} ≤ الوقف ${stop.toFixed(3)}`,'الأولوية لحماية رأس المال قبل أي هدف جديد.']};
    if(held&&targetTouched){
      if(bearish)return{...common,code:'TAKE_PROFIT_REDUCE',labelAr:'جني ربح / خفف بقوة',tone:'profit',reasonAr:'الهدف الأول تحقق لكن الزخم الحالي لا يدعم تمديد المركز كاملًا.',reasons:['T1 تم لمسه.',`الترجيح الهابط ${bear.toFixed(1)}% مقابل الصاعد ${bull.toFixed(1)}%.`]};
      if(nextTarget>price)return{...common,code:'PARTIAL_HOLD_NEXT',labelAr:'جني جزئي واحتفظ للباقي',tone:'profit',reasonAr:'تم لمس الهدف الأول بينما الاتجاه ما زال داعمًا؛ ثبّت جزءًا من الربح وانتظر الهدف الفني التالي بالباقي.',reasons:['T1 تحقق.',`الهدف الفني التالي التقريبي ${nextTarget.toFixed(3)}.`,'لا تحوّل الهدف الفني إلى أمر تلقائي.']};
      return{...common,code:'TAKE_PROFIT',labelAr:'جني ربح',tone:'profit',reasonAr:'الهدف الحالي تحقق ولا يظهر امتداد فني واضح أعلى السعر.',reasons:['T1 تحقق.']};
    }
    if(held&&recommended){
      if(entryHigh>0&&price>entryHigh){
        if(bullish)return{...common,code:'HOLD_NO_ADD',labelAr:'احتفظ — لا تزود',tone:'hold',reasonAr:'المركز قائم والاتجاه ما زال داعمًا، لكن السعر أعلى نطاق الدخول؛ احتفظ ولا تطارد بزيادة.',reasons:[`السعر فوق Entry High ${entryHigh.toFixed(3)}.`,'الوقف لم يُكسر والاتجاه الفني ما زال داعمًا.',target1>price?`انتظار T1 ${target1.toFixed(3)}.`:''] .filter(Boolean)};
        return{...common,code:'REDUCE_CAUTION',labelAr:'احتفاظ بحذر / خفف',tone:'warning',reasonAr:'السهم أعلى نطاق الدخول لكن الزخم فقد جزءًا من الدعم؛ لا تزود وراجع حجم المركز.',reasons:[`الترجيح الصاعد ${bull.toFixed(1)}% مقابل الهابط ${bear.toFixed(1)}%.`]};
      }
      if(entryLow>0&&entryHigh>0&&price>=entryLow&&price<=entryHigh)return{...common,code:bullish?'HOLD_TO_TARGET':'HOLD_CAUTION',labelAr:bullish?'احتفظ وانتظر الهدف':'احتفظ بحذر',tone:bullish?'hold':'warning',reasonAr:bullish?'السعر داخل نطاق الخطة والاتجاه يدعم استمرار المركز نحو الهدف الحالي.':'السعر داخل النطاق لكن التأكيد الفني متوسط؛ احتفظ دون زيادة حتى يتحسن الزخم.',reasons:[target1>price?`الهدف الحالي ${target1.toFixed(3)}.`:'',`ثقة التحليل ${fin.confidence||'منخفض'}.`].filter(Boolean)};
      if(entryLow>0&&price<entryLow&&stop>0&&price>stop)return{...common,code:bearish?'REDUCE_CAUTION':'HOLD_CAUTION',labelAr:bearish?'خفف / راقب الوقف':'احتفظ بحذر',tone:'warning',reasonAr:'السعر أصبح أسفل نطاق الدخول لكنه لم يكسر الوقف؛ لا تزود وراقب الدعم/الوقف.',reasons:[`Entry Low ${entryLow.toFixed(3)} · Stop ${stop.toFixed(3)}.`]};
      return{...common,code:'HOLD',labelAr:'احتفظ',tone:'hold',reasonAr:'المركز ما زال فوق الوقف ولم يتحقق هدف الخروج.',reasons:[target1>0?`انتظار الهدف ${target1.toFixed(3)}.`:'الهدف الرسمي غير متاح.']};
    }
    if(held){
      const support=num(ev.supports?.[0]?.level);if(support>0&&price<support)return{...common,code:'REDUCE_BREAK_SUPPORT',labelAr:'خفف / خروج فني',tone:'danger',reasonAr:'السهم خارج توصيات اليوم وكسر أقرب دعم فني ظاهر.',reasons:[`الدعم ${support.toFixed(3)} تم كسره.`]};
      if(bearish)return{...common,code:'REDUCE',labelAr:'خفف المركز',tone:'warning',reasonAr:'السهم ليس ضمن توصيات اليوم والترجيح الفني الحالي هابط.',reasons:[`هابط ${bear.toFixed(1)}% مقابل صاعد ${bull.toFixed(1)}%.`]};
      return{...common,code:'HOLD_TECHNICAL',labelAr:'احتفاظ فني',tone:'hold',reasonAr:'السهم خارج توصيات اليوم لكن الاتجاه الفني لا يعطي إشارة خروج قوية حاليًا.',reasons:[`صاعد ${bull.toFixed(1)}% · عرضي ${side.toFixed(1)}% · هابط ${bear.toFixed(1)}%.`]};
    }
    if(recommended){
      if(stop>0&&price<=stop)return{...common,code:'CANCEL_ENTRY',labelAr:'إلغاء / لا تدخل',tone:'danger',reasonAr:'السعر عند/أسفل وقف الخطة قبل تكوين مركز.',reasons:[]};
      if(entryLow>0&&entryHigh>0&&price>=entryLow&&price<=entryHigh)return{...common,code:bullish?'WATCH_ENTRY':'WAIT_CONFIRM',labelAr:bullish?'منطقة دخول للمراجعة':'انتظر تأكيدًا',tone:bullish?'reentry':'warning',reasonAr:bullish?'السعر داخل نطاق الدخول مع دعم فني نسبي.':'السعر داخل النطاق لكن التأكيد الفني غير كافٍ.',reasons:[]};
      if(entryHigh>0&&price>entryHigh)return{...common,code:'DO_NOT_CHASE',labelAr:'لا تطارد السعر',tone:'watch',reasonAr:'السعر أعلى نطاق الدخول؛ انتظر عودة مناسبة بدل الدخول المتأخر.',reasons:[]};
      return{...common,code:'WAIT_ENTRY',labelAr:'انتظر منطقة الدخول',tone:'watch',reasonAr:'التوصية قائمة لكن السعر ليس داخل نطاق تنفيذ مناسب حاليًا.',reasons:[]};
    }
    return{...common,code:'WATCH_ONLY',labelAr:'مراقبة فقط',tone:'neutral',reasonAr:'لا يوجد مركز ولا توصية V16.9 حالية على السهم.',reasons:[]};
  }

  return{num,clamp,mean,pct,sessionsOf,mergeQuote,emaSeries,ema,sma,rsi,atr,macd,volumeRatio,swingLevels,fibonacci,weeklyTrend,calibrate,analyze,normalizePortfolio,nextTechnicalTarget,advisory};
});
