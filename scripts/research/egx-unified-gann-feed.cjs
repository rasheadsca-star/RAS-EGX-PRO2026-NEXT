#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd()),read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
function build(scan,review,truth){
 const session=String(scan.sessionDate||''),expected=String(truth.expectedSession||'');
 const current=!!session&&session===expected&&scan.status!=='BOOTSTRAP';
 const passed=review.passed===true&&Number(review.critical||0)===0&&Number(review.major||0)===0;
 const take=x=>(Array.isArray(x)?x:[]).slice(0,10).map(r=>({ticker:r.ticker,score:Number(r.score)||0,
   close:Number(r.close)||null,decision:r.decisionFunnel?.speculative?.decision?.code||'UNKNOWN',
   rankScore:Number(r.decisionFunnel?.speculative?.rankScore)||null,
   entryLow:Number(r.decisionFunnel?.speculative?.levels?.entryLow)||null,
   entryHigh:Number(r.decisionFunnel?.speculative?.levels?.entryHigh)||null,
   stopLoss:Number(r.decisionFunnel?.speculative?.levels?.stopLoss)||null}));
 return {schemaVersion:'egx-unified-gann-research-feed-1',generatedAt:new Date().toISOString(),sourceSession:session||null,
 expectedSession:expected||null,sourceStatus:scan.status||'UNKNOWN',current,reviewPassed:passed,
 executionEligible:false,automaticOrders:false,analyzed:Number(scan.market?.analyzed)||0,
 freshCount:Number(scan.market?.freshCount)||0,actionable:Number(scan.funnelSummary?.speculative?.actionable)||0,
 watch:Number(scan.funnelSummary?.speculative?.watch)||0,mediumActionable:Number(scan.funnelSummary?.medium?.actionable)||0,
 speculative:take(scan.dailyTop),watchRadar:take(scan.watchRadar),weekly:take(scan.weeklyTop),
 publicationState:current&&passed?'CURRENT_RESEARCH_NOT_EXECUTABLE':'HISTORICAL_OR_UNVERIFIED_RESEARCH'};
}
if(require.main===module){try{const out=path.join(root,'unified-console/gann-research.json');
 const result=build(read('gann-fusion-x/data/current.json'),read('gann-fusion-x/data/review.json'),read('data/stable/v15-price-truth.json'));
 fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({session:result.sourceSession,expected:result.expectedSession,analyzed:result.analyzed,actionable:result.actionable,state:result.publicationState}));
 if(!result.current||!result.reviewPassed)process.exitCode=2;
 }catch(e){console.error(e);process.exitCode=2}}
module.exports={build};
