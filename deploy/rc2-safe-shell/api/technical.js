const SOURCE='https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/c77f184110a3d238b4a964382566c7e554a27ad9/tfe-v20/public/technical-analysis-tools.js';
export default async function handler(req,res){
  try{
    const response=await fetch(SOURCE,{headers:{accept:'text/plain'}});
    if(!response.ok)throw new Error(`GitHub ${response.status}`);
    const text=await response.text();
    res.statusCode=200;
    res.setHeader('content-type','application/javascript; charset=utf-8');
    res.setHeader('cache-control','public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800');
    res.end(text);
  }catch(error){
    res.statusCode=502;
    res.setHeader('content-type','application/javascript; charset=utf-8');
    res.end(`console.warn(${JSON.stringify('Technical visualization asset unavailable')});`);
  }
}
