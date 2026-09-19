import tfeBridge from '../../../astra/runtime/bridges/tfe-local.cjs';
import historyStore from '../../../astra/runtime/io/local-history-store.cjs';

const {evaluateTfe,health}=tfeBridge;
const {readHistory}=historyStore;

function first(v){return Array.isArray(v)?v[0]:v}
function send(res,status,payload){
  res.statusCode=status;
  res.setHeader('content-type','application/json; charset=utf-8');
  res.setHeader('cache-control','no-store');
  res.end(JSON.stringify(payload));
}
export {readHistory};
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
