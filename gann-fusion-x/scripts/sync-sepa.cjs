#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const BASE=process.env.SEPA_X_BASE_URL||'https://sepax-strategy-live.vercel.app';
const EXPECTED_SESSION=process.env.EXPECTED_SESSION||null;
const OUT=path.resolve(__dirname,'../data/sepa-x-snapshot.json');
async function get(route){const r=await fetch(BASE+route,{headers:{accept:'application/json'},cache:'no-store'});if(!r.ok)throw new Error(`${route}: HTTP ${r.status}`);return r.json()}
function dateOf(payload){return payload?.meta?.marketSession||payload?.marketSession||payload?.sessionDate||null}
async function main(){
  const [top5,near,forming,extended,top,verified]=await Promise.all([
    get('/api/top5'),
    get('/api/opportunities?view=near'),
    get('/api/opportunities?view=forming'),
    get('/api/opportunities?view=extended'),
    get('/api/opportunities?view=top'),
    get('/data/verified.json').catch(()=>({records:[]}))
  ]);
  const sessionDate=dateOf(top5);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(sessionDate||''))) throw new Error('SEPA_SESSION_MISSING');
  if(EXPECTED_SESSION&&sessionDate!==EXPECTED_SESSION) throw new Error(`SEPA_SESSION_MISMATCH expected=${EXPECTED_SESSION} actual=${sessionDate}`);
  const rows=top5.rows||top5.data||top5||[];
  if(!Array.isArray(rows)||!rows.length) throw new Error('SEPA_TOP5_EMPTY');
  const snapshot={
    schemaVersion:'gann-fusion-x-sepa-mirror-v2',
    generatedAt:new Date().toISOString(),
    sessionDate,
    meta:{
      ...(top5.meta||{}),
      marketSession:sessionDate,
      sourceUrl:BASE,
      mode:'POST_CLOSE_LIVE_READ_ONLY_MIRROR',
      originalSepaXTouched:false,
      sourceSessionValidated:true,
      expectedSession:EXPECTED_SESSION
    },
    rows,
    views:{
      near:near.rows||near.data||near||[],
      forming:forming.rows||forming.data||forming||[],
      extended:extended.rows||extended.data||extended||[],
      top:top.rows||top.data||top||[]
    },
    verified
  };
  fs.writeFileSync(OUT,JSON.stringify(snapshot,null,2)+'\n');
  console.log(JSON.stringify({ok:true,source:BASE,expectedSession:EXPECTED_SESSION,sessionDate:snapshot.sessionDate,top5:rows.length,near:snapshot.views.near.length,forming:snapshot.views.forming.length,extended:snapshot.views.extended.length,top:snapshot.views.top.length,verified:(verified.records||[]).length,output:path.relative(process.cwd(),OUT)},null,2));
}
main().catch(e=>{console.error(e.stack||e);process.exit(1)});
