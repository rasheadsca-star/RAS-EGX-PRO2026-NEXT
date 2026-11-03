'use strict';
// R1 research-only quote rounding consistency; no price or threshold mutation.
const TICK=0.01;
function roundingBand(close,previousClose,tick=TICK){
 const h=tick/2;
 if(!(close>0)||!(previousClose>0)||!(previousClose-h>0))return null;
 return {lo:((close-h)/(previousClose+h)-1)*100,hi:((close+h)/(previousClose-h)-1)*100};
}
function changeConsistent({close,previousClose,reportedChangePct,tolerancePct=3,tick=TICK}){
 const reported=Number.isFinite(Number(reportedChangePct))&&reportedChangePct!==null&&reportedChangePct!==undefined?Number(reportedChangePct):null;
 const implied=previousClose>0&&close>0?(close/previousClose-1)*100:null;
 if(implied===null||reported===null)return true;
 if(Math.abs(implied-reported)<=tolerancePct)return true;
 const band=roundingBand(close,previousClose,tick);
 return Boolean(band)&&reported>=band.lo-0.01&&reported<=band.hi+0.01;
}
module.exports={roundingBand,changeConsistent,TICK};
