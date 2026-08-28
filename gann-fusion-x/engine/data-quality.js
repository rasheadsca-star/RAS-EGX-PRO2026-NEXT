(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.GFXDataQuality=api;})(typeof self!=='undefined'?self:this,function(){'use strict';
function optionalNumber(value){if(value===null||value===undefined||value==='')return null;const n=Number(value);return Number.isFinite(n)?n:null;}
function isKnownBelow(value,threshold){const n=optionalNumber(value);return n!==null&&n<Number(threshold);}
function sanitizeMarketIndex(doc){if(!doc||!Array.isArray(doc.stocks))return doc;for(const stock of doc.stocks){if(optionalNumber(stock.liquidityPercentile)===null)delete stock.liquidityPercentile;}return doc;}
return{optionalNumber,isKnownBelow,sanitizeMarketIndex};
});
