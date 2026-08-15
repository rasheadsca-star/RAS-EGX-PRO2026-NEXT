#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r);
const read=(r,f=null)=>{try{return JSON.parse(fs.readFileSync(P(r),'utf8'))}catch(e){return f}};
const write=(r,v)=>{const f=P(r);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,`${JSON.stringify(v,null,2)}\n`,'utf8')};
const n=v=>{if(v===null||v===undefined||v==='')return null;const x=Number(v);return Number.isFinite(x)?x:null};
const round=(v,d=4)=>n(v)===null?null:Math.round(n(v)*10**d)/10**d;
const sym=v=>String(v||'').trim().toUpperCase().replace(/\.CA$/,'').replace(/[^A-Z0-9.]/g,'');
const policy={initialCapital:100000,maxTotalAllocationPct:50,maxOpenPositions:4,maxSinglePositionPct:12.5,roundTripTransactionCostPct:0.6,entryFeePct:0.3,exitFeePct:0.3,slippagePct:0,noCapitalReuseSameSession:true,sameCandleTargetStopPolicy:'CONSERVATIVE_STOP',automaticBrokerExecution:false};
const decision=read('data/v20/final-decision-contract.json');if(!decision)throw Error('Final decision contract missing');
const market=read('data/v20/market-explorer.json',{rows:[]});
const previous=read('data/v20/funded-nav.json',{schemaVersion:'20.0.0-funded-nav-1',policy,timeline:[]});
const date=decision.sessionDate,marketMap=new Map((market.rows||[]).map(r=>[sym(r.ticker),r]));
const historical=(previous.timeline||[]).filter(x=>String(x.date)<date).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
const prior=historical.at(-1)||null;
const startingCash=n(prior?.endingCash)??policy.initialCapital,startingEquity=n(prior?.endingEquity)??policy.initialCapital;
const positionsAtOpen=(prior?.positionsAtClose||[]).map(x=>({...x}));
let cash=startingCash,realizedPnL=0,totalFees=0,totalSlippage=0;
const exits=[],survivors=[];
for(const pos of positionsAtOpen){
 const m=marketMap.get(sym(pos.symbol)),low=n(m?.low),high=n(m?.high),mark=n(m?.price),stop=n(pos.stop),target=n(pos.target1),qty=n(pos.quantity),basis=n(pos.costBasis);
 if(!(qty>0&&basis>=0)){continue}
 const stopTouched=low!==null&&stop!==null&&low<=stop,targetTouched=high!==null&&target!==null&&high>=target;
 let exitPrice=null,reason=null,ambiguous=false;
 if(stopTouched&&targetTouched){exitPrice=stop;reason='SAME_CANDLE_TARGET_STOP_AMBIGUOUS_CONSERVATIVE_STOP';ambiguous=true}
 else if(stopTouched){exitPrice=stop;reason='STOP_TOUCHED'}
 else if(targetTouched){exitPrice=target;reason='TARGET1_TOUCHED'}
 if(exitPrice!==null){const gross=qty*exitPrice,fee=gross*policy.exitFeePct/100,slippage=gross*policy.slippagePct/100,net=gross-fee-slippage,pnl=net-basis;cash+=net;realizedPnL+=pnl;totalFees+=fee;totalSlippage+=slippage;exits.push({symbol:pos.symbol,quantity:qty,entryDate:pos.entryDate,exitDate:date,exitPrice:round(exitPrice),reason,ambiguous,grossProceeds:round(gross,2),fees:round(fee,2),slippage:round(slippage,2),netProceeds:round(net,2),realizedPnL:round(pnl,2)});}
 else survivors.push({...pos,markPrice:mark,marketValue:mark!==null?round(qty*mark,2):null,unrealizedPnL:mark!==null?round(qty*mark-basis,2):null});
}
const cashAvailableForNewEntries=startingCash; // exits above are deliberately excluded from same-session entry funding.
const openingExposureValue=positionsAtOpen.reduce((s,p)=>{const m=marketMap.get(sym(p.symbol));return s+(n(m?.price)!==null&&n(p.quantity)>0?n(m.price)*n(p.quantity):0)},0);
let allocationCapacity=Math.max(0,startingEquity*policy.maxTotalAllocationPct/100-openingExposureValue),entryCashBudget=Math.max(0,cashAvailableForNewEntries),slots=Math.max(0,policy.maxOpenPositions-survivors.length);
const acceptedEntries=[],rejectedEntries=[];
const candidates=(decision.rows||[]).filter(r=>r.governance?.finalDecisionState==='ACTIONABLE').sort((a,b)=>(n(a.v20Native?.discoveryRank)??9999)-(n(b.v20Native?.discoveryRank)??9999)||sym(a.identity?.symbol).localeCompare(sym(b.identity?.symbol)));
if(decision.sessionStatus!=='EXECUTION_GRADE'&&candidates.length)throw Error('Non-execution session contains ACTIONABLE candidates');
for(const row of candidates){
 const symbol=sym(row.identity?.symbol),entryHigh=n(row.tradePlan?.entryHigh),stop=n(row.tradePlan?.stop),target1=n(row.tradePlan?.target1),alreadyOpen=survivors.some(p=>sym(p.symbol)===symbol);
 if(alreadyOpen){rejectedEntries.push({symbol,reason:'ALREADY_OPEN'});continue}
 if(slots<=0){rejectedEntries.push({symbol,reason:'MAX_OPEN_POSITIONS'});continue}
 if(!(entryHigh>0&&stop>0&&stop<entryHigh&&target1>entryHigh)){rejectedEntries.push({symbol,reason:'INVALID_TRADE_PLAN'});continue}
 const perPositionNotional=Math.min(startingEquity*policy.maxSinglePositionPct/100,allocationCapacity,entryCashBudget/(1+policy.entryFeePct/100));
 const qty=Math.floor(perPositionNotional/entryHigh);
 if(qty<=0){rejectedEntries.push({symbol,reason:'INSUFFICIENT_AVAILABLE_STARTING_CASH_OR_ALLOCATION'});continue}
 const notional=qty*entryHigh,fee=notional*policy.entryFeePct/100,slippage=notional*policy.slippagePct/100,totalDebit=notional+fee+slippage;
 if(totalDebit>entryCashBudget+1e-8){rejectedEntries.push({symbol,reason:'STARTING_CASH_BUDGET_EXCEEDED'});continue}
 cash-=totalDebit;entryCashBudget-=totalDebit;allocationCapacity-=notional;slots--;totalFees+=fee;totalSlippage+=slippage;
 const position={symbol,quantity:qty,entryDate:date,avgEntryPrice:round(entryHigh),costBasis:round(totalDebit,2),stop:round(stop),target1:round(target1),target2:n(row.tradePlan?.target2),sourceDecisionState:'ACTIONABLE',v20NativeRank:n(row.v20Native?.discoveryRank),v17ExecutionEligible:row.v17?.executionEligible===true};
 survivors.push(position);acceptedEntries.push({...position,notional:round(notional,2),fees:round(fee,2),slippage:round(slippage,2)});
}
let unrealizedPnL=0,closeMarketValue=0;const positionsAtClose=survivors.map(pos=>{const m=marketMap.get(sym(pos.symbol)),mark=n(m?.price)??n(pos.markPrice)??n(pos.avgEntryPrice),mv=mark*n(pos.quantity),upnl=mv-n(pos.costBasis);closeMarketValue+=mv;unrealizedPnL+=upnl;return{...pos,markPrice:round(mark),marketValue:round(mv,2),unrealizedPnL:round(upnl,2)}});
const endingCash=cash,endingEquity=endingCash+closeMarketValue,dailyReturn=startingEquity>0?(endingEquity-startingEquity)/startingEquity*100:0,priorPeak=n(prior?.peakEquity)??startingEquity,peakEquity=Math.max(priorPeak,endingEquity),drawdown=peakEquity>0?(endingEquity/peakEquity-1)*100:0,grossExposure=endingEquity>0?closeMarketValue/endingEquity*100:0,cashPct=endingEquity>0?endingCash/endingEquity*100:0;
const row={date,startingCash:round(startingCash,2),startingEquity:round(startingEquity,2),positionsAtOpen,acceptedEntries,rejectedEntries,exits,fees:round(totalFees,2),slippage:round(totalSlippage,2),realizedPnL:round(realizedPnL,2),unrealizedPnL:round(unrealizedPnL,2),endingCash:round(endingCash,2),endingEquity:round(endingEquity,2),grossExposure:round(grossExposure,2),cashPct:round(cashPct,2),dailyReturn:round(dailyReturn,4),peakEquity:round(peakEquity,2),drawdown:round(drawdown,4),positionsAtClose,sessionStatus:decision.sessionStatus,productionActionableCount:Number(decision.summary?.productionActionableCount||0),capitalReuseFromSameSessionExits:false};
const timeline=[...historical,row];
const out={schemaVersion:'20.0.0-funded-nav-1',generatedAt:new Date().toISOString(),status:'FUNDED_NAV_DECISION_SUPPORT_SIMULATION_NOT_BROKER_EXECUTION',policy,governance:{source:'data/v20/final-decision-contract.json',v17ExecutionGateAbsolute:true,closedGateNoNewEntries:true,previousOpenPositionsAreMonitoredNotForcedLiquidated:true,automaticBrokerExecution:false,unusedAllocationRemainsCash:true},timeline,current:row};
write('data/v20/funded-nav.json',out);console.log(JSON.stringify({ok:true,date,startingEquity:row.startingEquity,acceptedEntries:acceptedEntries.length,rejectedEntries:rejectedEntries.length,exits:exits.length,endingEquity:row.endingEquity,grossExposure:row.grossExposure,cashPct:row.cashPct,drawdown:row.drawdown,sessionStatus:row.sessionStatus},null,2));
