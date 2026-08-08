#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.');
const base=path.join(root,'data/v17/historical-recovery/long-history');
const store=path.join(root,'data/v17/historical-recovery/history');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(name,value)=>fs.writeFileSync(path.join(base,name),JSON.stringify(value,null,2)+'\n');
const canonical=new Set((read(path.join(root,'data/symbols.json')).symbols||[]).map(x=>String(x.symbol).toUpperCase().replace(/\.CA$/,'')));
const docs=fs.readdirSync(store).filter(x=>x.endsWith('.json')&&canonical.has(path.basename(x,'.json').toUpperCase())).map(x=>read(path.join(store,x)));
const ok=docs.filter(x=>x.sessionCount>0),counts=a=>a.reduce((m,x)=>(m[x]=(m[x]||0)+1,m),{});
const reasonCounts=counts(docs.flatMap(x=>x.dataQualityReasons||[]).map(x=>String(x).split(':')[0]));
const coverage=ok.map(x=>x.sessionCount).sort((a,b)=>a-b),q=p=>coverage[Math.floor((coverage.length-1)*p)]||0;
const coverageReport={schemaVersion:'17.2.0-canonical-coverage-report-1',generatedAt:new Date().toISOString(),canonicalOrdinaryEquities:canonical.size,mappedSymbols:docs.length,retrievedSymbols:ok.length,failedSymbols:docs.length-ok.length,statusCounts:counts(docs.map(x=>x.dataQualityStatus)),reasonCounts,sessionDistribution:{minimum:coverage[0]||0,p25:q(.25),median:q(.5),p75:q(.75),maximum:coverage.at(-1)||0},horizonCoverage:{week52:ok.filter(x=>x.sessionCount>=200).length,year3:ok.filter(x=>x.sessionCount>=650).length,year5:ok.filter(x=>x.sessionCount>=1100).length,tenYearWindow:ok.filter(x=>x.sessionCount>=2200).length},failedTickers:docs.filter(x=>!x.sessionCount).map(x=>x.ticker).sort()};
write('coverage-report.json',coverageReport);
const sourceAudit={schemaVersion:'17.1.0-source-audit-1',generatedAt:new Date().toISOString(),selectedSource:'YAHOO_CHART_API',selectedRequest:{range:'10y',interval:'1d'},representativeSymbols:['COMI','EAST','SWDY','FWRY','ABUK','TMGH','EGSA','FAITA','EGBE','ORAS'],findings:{explicit10Year:'Provides daily observations where listed and retrievable.',rangeMax:'Rejected because older histories were silently coarsened to weekly or monthly observations.',adjustedClose:'Source-provided with complete coverage for successful representative requests, but not authoritative evidence of EGX corporate actions.',fallback:'No silent raw-price fallback is permitted.',identityFailures:['EGSA','FAITA','EGBE']},provenancePolicy:{officialCorporateActionEvidence:false,suspiciousAdjustedDiscontinuities:'CORPORATE_ACTION_REVIEW_REQUIRED',sharedHistoryStore:'READ_ONLY'}};
write('source-audit.json',sourceAudit);
console.log(JSON.stringify({sourceAudit,coverageReport},null,2));
