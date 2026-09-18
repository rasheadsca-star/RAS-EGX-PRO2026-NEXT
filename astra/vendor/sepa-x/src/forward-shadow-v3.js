const finite=v=>Number.isFinite(Number(v));
const round=(v,d=4)=>finite(v)?Number(Number(v).toFixed(d)):null;
const terminal=s=>['TARGET','STOP','EXPIRED','TIME'].includes(s);
const fillPrice=(bar,low,high)=>{if(!bar)return null;const o=Number(bar.open),l=Number(bar.low),h=Number(bar.high);if(o>=low&&o<=high)return o;if(o>high&&l<=high)return high;if(o<low)return null;if(l<=high&&h>=low)return high;return null;};

export function emptyV3Ledger(){return {schemaVersion:'sepa-x-full-structure-v3-forward.1',researchOnly:true,promotionAllowed:false,automaticEligibilityImpact:'NONE',candidateId:'FULL_STRUCTURE_V3',startedAt:new Date().toISOString(),methodology:{prospectiveOnly:true,entryExpirySessions:3,maxHoldSessions:10,sameBarAmbiguity:'STOP_FIRST',target:'planned P1 from frozen V3 signal'},signals:[],summary:{signals:0,waiting:0,open:0,target:0,stop:0,expired:0,time:0,entered:0,hitPct:null}};}

function updateOne(sig,row){const bar=row?.last_session;if(!bar?.date||bar.date<=sig.lastProcessedSession||bar.date<=sig.observedSession)return sig;sig.lastProcessedSession=bar.date;
  if(sig.state==='WAIT_ENTRY'){
    sig.entryObservedSessions=(sig.entryObservedSessions||0)+1;const p=fillPrice(bar,sig.entryLow,sig.entryHigh);
    if(p!=null){sig.state='OPEN';sig.entryDate=bar.date;sig.entryPrice=round(p);sig.holdSessions=1;if(Number(bar.low)<=sig.stopLoss){sig.state='STOP';sig.exitDate=bar.date;sig.exitPrice=sig.stopLoss;}else if(Number(bar.high)>=sig.target){sig.state='TARGET';sig.exitDate=bar.date;sig.exitPrice=sig.target;}}
    else if(sig.entryObservedSessions>=3)sig.state='EXPIRED';
  }else if(sig.state==='OPEN'){
    sig.holdSessions=(sig.holdSessions||0)+1;if(Number(bar.low)<=sig.stopLoss){sig.state='STOP';sig.exitDate=bar.date;sig.exitPrice=sig.stopLoss;}else if(Number(bar.high)>=sig.target){sig.state='TARGET';sig.exitDate=bar.date;sig.exitPrice=sig.target;}else if(sig.holdSessions>=10){sig.state='TIME';sig.exitDate=bar.date;sig.exitPrice=Number(bar.close);}
  }
  if(terminal(sig.state)&&sig.entryPrice){const risk=sig.entryPrice-sig.stopLoss;sig.netPct=round((sig.exitPrice-sig.entryPrice)/sig.entryPrice*100-.6,3);sig.netR=risk>0?round((sig.exitPrice-sig.entryPrice-sig.entryPrice*.006)/risk,3):null;}
  return sig;
}

export function updateV3ForwardLedger(ledger,scan){const out=ledger?.schemaVersion?JSON.parse(JSON.stringify(ledger)):emptyV3Ledger(),rows=new Map((scan?.all||[]).map(x=>[x.symbol,x]));
  out.signals=out.signals.map(s=>terminal(s.state)?s:updateOne(s,rows.get(s.symbol)));
  const existing=new Set(out.signals.map(s=>s.key));
  for(const row of scan?.all||[]){const v3=row?.strategy_lab?.full_structure_v3;if(!v3?.pass)continue;const plan=v3.raw?.plan,z=plan?.entryZone,session=row.last_session?.date;if(!session||!finite(z?.from)||!finite(z?.to)||!finite(plan?.stopLoss)||!finite(plan?.precisionTarget?.price))continue;const source=v3.raw?.sourceSignal?.reclaimDate||session,key=`${row.symbol}:${source}`;if(existing.has(key))continue;out.signals.push({key,symbol:row.symbol,sourceReclaimDate:source,observedAt:scan.generatedAt,observedSession:session,lastProcessedSession:session,state:'WAIT_ENTRY',entryObservedSessions:0,entryLow:Number(z.from),entryHigh:Number(z.to),referenceEntry:Number(plan.referenceEntry),stopLoss:Number(plan.stopLoss),target:Number(plan.precisionTarget.price),riskPct:Number(plan.riskPct),frozenDefinition:v3.raw.definition,marketRegime:row.market_regime??null});existing.add(key);}
  const counts={signals:out.signals.length,waiting:0,open:0,target:0,stop:0,expired:0,time:0,entered:0,hitPct:null};for(const s of out.signals){if(s.state==='WAIT_ENTRY')counts.waiting++;else if(s.state==='OPEN'){counts.open++;counts.entered++;}else if(s.state==='TARGET'){counts.target++;counts.entered++;}else if(s.state==='STOP'){counts.stop++;counts.entered++;}else if(s.state==='EXPIRED')counts.expired++;else if(s.state==='TIME'){counts.time++;counts.entered++;}}const closedEntered=counts.target+counts.stop+counts.time;counts.hitPct=closedEntered?round(counts.target/closedEntered*100,1):null;out.summary=counts;out.updatedAt=new Date().toISOString();return out;}
