import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RANKS,compute,outcomes,fromPage,COLS} from './manual-importer.mjs';
const row=(rank,symbol,change,close,value)=>({rank,symbol,name:symbol,change,close,high:close+1,low:close-1,value,currency:'EGP',issues:[],page:17});
const mock={
  eligible:[row(1,'FWRY',5,20,1000000),row(2,'ZEOT',2,10,3000000),row(3,'HRHO',1,30,500000)],
  mapped:[row(1,'FWRY',5,20,1000000),row(2,'ZEOT',2,10,3000000),row(3,'HRHO',1,30,500000)]
};
test('nine weight sets are complete and unique',()=>{assert.equal(RANKS.length,9);assert.equal(new Set(RANKS).size,9)});
test('nine ranking outputs contain bounded price plans',()=>{
  const ranks=compute(mock);
  assert.deepEqual(Object.keys(ranks),RANKS);
  for(const v of Object.values(ranks)){assert.equal(v.length,3);for(const s of v){assert(s.entry>s.stop);assert(s.t1>s.entry);assert(s.t2>s.t1);assert(s.riskPct>0);assert.equal(s.identityVerified,false)}}
});
test('previous plans not entered are not executed losses',()=>{
  const prev={rankings:{'30/40/30':[{symbol:'FWRY',entry:99,stop:90,target1:105}]}};
  const row=outcomes(mock,prev)[0];assert.equal(row.state,'NO_ENTRY');assert.equal(row.executed,false);
});
test('unknown stock not counted as a paper trade',()=>{
  const prev={weights:{'30/40/30':[{symbol:'MISSING',entry:10,stop:8,t1:12}]}};
  assert.equal(outcomes(mock,prev)[0].state,'IDENTITY_OR_PRICE_UNAVAILABLE');
});

test('actual EGX 19-Nov value column starts at x=575, not 577, and yields valid liquidity', async()=>{
  const H=1078,y=323.93;
  const item=(x,yt,str)=>({str,transform:[1,0,0,1,x,H-yt]});
  const tokens=[
   item(30.3,y,'1'),item(42.3,317.2,'Alexandria'),item(98.6,317.2,'New'),
   item(124.2,317.2,'Medical'),item(42.3,330.6,'Center'),
   item(192.2,y,'EGP'),item(244.4,y,'39.500'),item(310.4,y,'40.5'),
   item(348.3,y,'37.52'),item(490.9,y,'38.590'),item(536.1,y,'-2.30'),
   item(575.1,y,'321,260,726'),item(644.7,y,'5.5%'),item(695.7,y,'8,265,248'),
   item(754.6,y,'10,101')
  ];
  const page={view:[0,0,1525,H],getTextContent:async()=>({items:tokens})};
  const [r]=await fromPage(page,17);
  assert.equal(r.rank,1);assert.equal(r.name,'Alexandria New Medical Center');
  assert.equal(r.value,321260726);assert.equal(r.volume,8265248);
  assert.equal(r.close,38.59);assert.deepEqual(r.issues,[]);
});
test('EGX 18-Nov wider page remains valid, and trades column is not counted as volume',async()=>{
  const H=1086,y=357.68;
  const item=(x,str)=>({str,transform:[1,0,0,1,x,H-y]});
  const tokens=[item(30.3,'2'),item(42.3,'EFG'),item(68,'Holding'),item(192.2,'EGP'),
    item(239,'24.090'),item(300,'25.5'),item(345,'23.84'),item(484.9,'25.300'),
    item(536.1,'5.02'),item(579.1,'280,912,743'),item(648.7,'4.4%'),item(700,'11,245,018'),item(763,'2,454')];
  const page={view:[0,0,1536,H],getTextContent:async()=>({items:tokens})};
  const [r]=await fromPage(page,17);
  assert.equal(r.value,280912743);assert.equal(r.volume,11245018);assert.deepEqual(r.issues,[]);
});
