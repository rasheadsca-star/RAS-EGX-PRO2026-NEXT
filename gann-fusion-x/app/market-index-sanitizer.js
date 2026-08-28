(function(){'use strict';
if(typeof window==='undefined'||!window.fetch||!window.GFXDataQuality)return;
const nativeFetch=window.fetch.bind(window);
window.fetch=async function(input,init){const response=await nativeFetch(input,init);try{const url=typeof input==='string'?input:(input&&input.url)||'';if(!url.includes('data/quant/market-search-index-v13-17.json'))return response;const clone=response.clone(),doc=await clone.json();window.GFXDataQuality.sanitizeMarketIndex(doc);return new Response(JSON.stringify(doc),{status:response.status,statusText:response.statusText,headers:response.headers});}catch(e){return response;}};
})();
