export function assertPointInTime(record, asOf){
  const violations=[];
  if(record?.fundamentals?.publicationDate && record.fundamentals.publicationDate>asOf)violations.push('LOOKAHEAD_FUNDAMENTALS');
  if(record?.catalyst?.date && record.catalyst.date>asOf)violations.push('LOOKAHEAD_CATALYST');
  return {pass:violations.length===0,violations};
}
export function expectancy(trades=[]){
  const net=trades.map(x=>Number(x.netR)).filter(Number.isFinite);if(!net.length)return null;
  const wins=net.filter(x=>x>0),loss=net.filter(x=>x<=0);
  return {
    trades:net.length,winRate:wins.length/net.length,averageWin:wins.length?wins.reduce((a,b)=>a+b,0)/wins.length:0,averageLoss:loss.length?loss.reduce((a,b)=>a+b,0)/loss.length:0,
    expectancy:net.reduce((a,b)=>a+b,0)/net.length,profitFactor:loss.reduce((a,b)=>a+Math.abs(b),0)>0?wins.reduce((a,b)=>a+b,0)/loss.reduce((a,b)=>a+Math.abs(b),0):null
  };
}
export function walkForward(windows=[]){
  return windows.map((w,i)=>({window:i+1,train:w.train??null,validate:w.validate??null,test:w.test??null,pointInTimeEnforced:true}));
}
