'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||process.cwd());
function compare(main,quality,coverage,manifest){
 const eligible=Number(quality.v4a_eligible||0),promoted=Number(quality.promoted_count||0);
 const central={researchEvidenceRows:coverage.evidence_rows,distinctSymbols:coverage.distinct_symbols,distinctSymbolSessions:coverage.distinct_symbol_sessions,distinctProviders:coverage.unique_providers,verifiedForTrading:eligible,actuallyPromoted:promoted,manifestRows:manifest.count,quarantineOnly:manifest.trading_eligible===false};
 const local={mapped:main.symbolsMapped,runtimeVerified:main.symbolsRuntimeVerified,complete100:main.symbolsComplete100,officiallyVerified:main.officiallyVerifiedSymbols,crossVerified:main.crossVerifiedSymbols,latestMarketSession:main.latestMarketSession};
 const warnings=[];
 if(central.verifiedForTrading===0)warnings.push('Central evidence is not eligible for trading or strategy input');
 if(local.officiallyVerified===0)warnings.push('Main history has no officially verified symbols per its own summary');
 if(central.distinctSymbols<local.runtimeVerified)warnings.push('Research ledger has narrower symbol coverage than main archive');
 if(main.symbolsComplete100>0)warnings.push('100-session coverage is not equivalent to uninterrupted or independently validated trading candles');
 return {schemaVersion:'egx-central-vs-main-coverage-audit-1',researchOnly:true,localArchive:local,centralEvidence:central,engineInput:'data/history/*.json',centralEvidenceInput:'egx-research-ledger/free_source_evidence.sqlite',automaticMergedPromotion:false,canUseCentralForExecutableBacktest:eligible>0&&promoted>0&&manifest.trading_eligible===true,warnings,conclusion:'CENTRAL_AND_MAIN_ARE_NOT_INTERCHANGEABLE'};
}
if(require.main===module){
 const main=JSON.parse(fs.readFileSync(path.join(root,'data/history-summary.json'),'utf8'));
 const dir=process.env.EGX_LEDGER_REPORT_DIR||path.join(root,'artifacts/central-ledger-reference');
 const quality=JSON.parse(fs.readFileSync(path.join(dir,'evidence_quality_report.json'),'utf8'));
 const coverage=JSON.parse(fs.readFileSync(path.join(dir,'coverage_efficiency_report.json'),'utf8'));
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
 const out=compare(main,quality,coverage,manifest);
 const dest=path.join(root,'data/research/egx-central-vs-main-coverage-audit.json');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify(out,null,2));
}
module.exports={compare};
