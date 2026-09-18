import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import tfeBridge from '../../../astra/runtime/bridges/tfe-local.cjs';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(__dirname,'../../..');
const {evaluateTfe,health}=tfeBridge;

function first(v){return Array.isArray(v)?v[0]:v}
function send(res,status,payload){
  res.statusCode=status;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  res.end(JSON.stringify(payload));
}
export function readHistory(ticker,limit=260){
  const symbol=String(ticker||'').trim().toUpperCase();
  if(!/^[A-Z0-9._-]{2,12}$/.test(symbol))throw new Error('INVALID_TICKER');
  const n=Math.max(1,Math.min(260,Number(limit)||260));
  const file=path.join(ROOT,'data','history',symbol+'.json');
  if(!fs.existsSync(file))throw new Error('HISTORY_NOT_FOUND');
  const doc=JSON.parse(fs.readFileSync(file,'utf8'));
  const sessions=Array.isArray(doc.sessions)?doc.sessions:[];
  const bars=sessions
    .filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(String(x.date||'').slice(0,10))&&Number(x.close)>0)
    .slice(-n)
    .map(x=>({date:String(x.date).slice(0,10),open:Number(x.open),high:Number(x.high),low:Number(x.low),close:Number(x.close),volume:Math.max(0,Number(x.volume)||0)}));
  return{ok:true,ticker:symbol,bars,source:'LOCAL_VALIDATION_APPROVED_HISTORY'};
}
export function evaluateRequest(body={}){
  const result=evaluateTfe(body);
  return{ok:true,engine:'TFE_V20_FUSION_RC2_INTERNAL',result,productionCutover:false,legacyNetworkCalls:0};
}
export default async function handler(req,res){
  const route=String(first(req.query?.route)||'health').toLowerCase();
  try{
    if(route==='health')return send(res,200,health());
    if(route==='history')return send(res,200,readHistory(first(req.query?.ticker),first(req.query?.limit)));
    if(route==='evaluate'){
      if(String(req.method||'GET').toUpperCase()!=='POST')return send(res,405,{ok:false,error:'METHOD_NOT_ALLOWED'});
      return send(res,200,evaluateRequest(req.body||{}));
    }
    return send(res,404,{ok:false,error:'LOCAL_ROUTE_NOT_FOUND',route});
  }catch(error){
    const code=String(error?.message||error);
    const status=code==='HISTORY_NOT_FOUND'?404:400;
    return send(res,status,{ok:false,error:code});
  }
}
