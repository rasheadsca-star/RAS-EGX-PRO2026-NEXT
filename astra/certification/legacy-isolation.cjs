'use strict';
const fs=require('fs');
const path=require('path');

const RULES=Object.freeze([
  {id:'OLD_EGX_DEPLOYMENT',category:'old-deployment-request',re:/https?:\/\/[^\s"'\`]*(?:egxpro|egx-pro|RAS-EGX0\.1)[^\s"'\`]*/i},
  {id:'QUANT_EDGE_REMOTE',category:'uncontrolled-remote-strategy',re:/quant-edge-shadow(?:-[a-z0-9-]+)?\.vercel\.app/i},
  {id:'SEPA_X_REMOTE',category:'uncontrolled-remote-strategy',re:/sepax-strategy-stable\.vercel\.app/i},
  {id:'TFE_RC2_REMOTE',category:'legacy-proxy-route',re:/egx-tfe-v20-fusion-rc2[^/\s"'\`]*\.vercel\.app/i},
  {id:'V18_REMOTE_BRANCH',category:'legacy-remote-loader',re:/raw\.githubusercontent\.com\/rasheadsca-star\/RAS-EGX-PRO2026-NEXT\/v18-global-strategy-ensemble-20260906/i},
  {id:'LEGACY_CDN_BRANCH',category:'legacy-remote-loader',re:/cdn\.jsdelivr\.net\/gh\/rasheadsca-star\/RAS-EGX-PRO2026-NEXT@(?:v18-global-strategy-ensemble-20260906|v19-egx-chat-gpt)/i},
  {id:'LEGACY_ENGINE_IMPORT',category:'legacy-runtime-import',re:/(?:require|import)\s*\(?[^;\n]*(?:gann-fusion-x|scripts\/v19|scripts\/v20|scripts\/stable\/v16|sepa-x)/i},
  {id:'LEGACY_PROXY_IMPLEMENTATION',category:'legacy-proxy-route',re:/(?:_proxy|proxyPass|rewrites?\s*[:(])/i},
  {id:'IFRAME_RUNTIME',category:'iframe-scraping-path',re:/<iframe\b|createElement\(\s*['"]iframe['"]\s*\)/i},
  {id:'LEGACY_DECISION_FALLBACK',category:'persisted-legacy-live-fallback',re:/data\/(?:stable\/v16-main-app-current|v19\/native-challenger|v20\/native-current)\.json/i},
  {id:'REMOTE_STRATEGY_FETCH',category:'uncontrolled-remote-strategy',re:/fetch\s*\(\s*['"]https?:\/\/[^'"]+(?:vercel\.app|raw\.githubusercontent\.com|cdn\.jsdelivr\.net)/i},
  {id:'CROSS_BRANCH_RUNTIME_BUILD',category:'cross-branch-build-dependency',re:/ref:\s*develop\/sepax-isolated-v1|\.sepax-pages-source/i}
]);

const DEPENDENCIES=Object.freeze([
  {dependencyId:'R01_V18_REMOTE_SHELL_RAW',locations:['v18-live/index.html'],re:/raw\.githubusercontent\.com\/rasheadsca-star\/RAS-EGX-PRO2026-NEXT\/v18-global-strategy-ensemble-20260906\/preview-v18-web\/index\.html/i},
  {dependencyId:'R02_V18_REMOTE_SHELL_JSDELIVR',locations:['v18-live'],re:/cdn\.jsdelivr\.net\/gh\/rasheadsca-star\/RAS-EGX-PRO2026-NEXT@v18-global-strategy-ensemble-20260906\/preview-v18-web\/index\.html/i},
  {dependencyId:'R03_V19_REMOTE_CHALLENGER',locations:['scripts/stable/v16-main-app-consensus.cjs','scripts/stable/v16-main-app-v19v6-consensus-enricher.cjs','scripts/stable/v16-main-app-independent-consensus-audit.cjs'],re:/(?:raw\.githubusercontent\.com\/rasheadsca-star\/RAS-EGX-PRO2026-NEXT\/v19-egx-chat-gpt|cdn\.jsdelivr\.net\/gh\/rasheadsca-star\/RAS-EGX-PRO2026-NEXT@v19-egx-chat-gpt)/i},
  {dependencyId:'R04_V20_NATIVE_PAGES',locations:['scripts/stable/v16-main-app-consensus.cjs'],re:/(?:rasheadsca-star\.github\.io\/RAS-EGX0\.1\/data\/v20\/native-current\.json|raw\.githubusercontent\.com\/rasheadsca-star\/RAS-EGX0\.1\/main\/data\/v20\/native-current\.json|cdn\.jsdelivr\.net\/gh\/rasheadsca-star\/RAS-EGX0\.1@main\/data\/v20\/native-current\.json)/i},
  {dependencyId:'R05_QUANT_EDGE_API',locations:['scripts/stable/v16-main-app-consensus.cjs'],re:/quant-edge-shadow(?:-[a-z0-9-]+)?\.vercel\.app\/api\/run/i},
  {dependencyId:'R06_SEPA_X_STABLE_API',locations:['gann-fusion-x/scripts/sync-sepa.cjs'],re:/sepax-strategy-stable\.vercel\.app/i},
  {dependencyId:'R07_RC2_VERCEL_PROXY',locations:['deploy/rc2-safe-shell'],re:/(?:egx-tfe-v20-fusion-rc2[^/\s"'\`]*\.vercel\.app|raw\.githubusercontent\.com\/rasheadsca-star\/RAS-EGX-PRO2026-NEXT\/c77f184110a3d238b4a964382566c7e554a27ad9\/tfe-v20\/public\/technical-analysis-tools\.js)/i},
  {dependencyId:'R08_SEPA_BRANCH_BUILD_IMPORT',locations:['.github/workflows/static.yml'],re:/ref:\s*develop\/sepax-isolated-v1|\.sepax-pages-source/i}
]);

function scanText(text,file='(memory)'){
  const violations=[];
  for(const rule of RULES){const m=String(text).match(rule.re);if(m)violations.push({ruleId:rule.id,category:rule.category,file,match:m[0]})}
  return violations;
}
function walk(target){
  const out=[];
  if(!fs.existsSync(target))return out;
  const stat=fs.statSync(target);
  if(stat.isFile())return /\.(?:js|cjs|mjs|ts|tsx|jsx|json|html|md|yml|yaml)$/i.test(target)?[target]:[];
  for(const e of fs.readdirSync(target,{withFileTypes:true})){
    const f=path.join(target,e.name);
    if(e.isDirectory())out.push(...walk(f));
    else if(/\.(?:js|cjs|mjs|ts|tsx|jsx|json|html|md|yml|yaml)$/i.test(e.name))out.push(f);
  }
  return out;
}
function scanTargetRuntime(root,relative='astra/runtime'){
  const target=path.resolve(root,relative),files=walk(target),violations=[];
  for(const file of files)violations.push(...scanText(fs.readFileSync(file,'utf8'),path.relative(root,file)));
  return{target:path.relative(root,target),scannedFiles:files.length,violations,clean:violations.length===0};
}
function scanLegacyDependencies(root){
  const matches=[];
  const scanned=new Set();
  for(const dep of DEPENDENCIES){
    for(const relative of dep.locations){
      const target=path.resolve(root,relative);
      for(const file of walk(target)){
        scanned.add(path.relative(root,file));
        const text=fs.readFileSync(file,'utf8');
        const m=text.match(dep.re);
        if(m)matches.push({dependencyId:dep.dependencyId,file:path.relative(root,file),match:m[0]});
      }
    }
  }
  const dependencyIds=[...new Set(matches.map(x=>x.dependencyId))].sort();
  const expectedIds=DEPENDENCIES.map(x=>x.dependencyId).sort();
  const missingFromScan=expectedIds.filter(x=>!dependencyIds.includes(x));
  return{
    scanMode:'G12_DECLARED_PRODUCTION_SURFACES',
    scannedFiles:[...scanned].sort(),
    scannedFileCount:scanned.size,
    matches,
    dependencyIds,
    runtimeLegacyDependencyCount:dependencyIds.length,
    expectedDependencyCount:DEPENDENCIES.length,
    missingFromScan,
    clean:dependencyIds.length===0
  };
}
if(require.main===module){
  const root=path.resolve(process.argv[2]||process.cwd());
  const full=process.argv.includes('--full');
  const result=full?scanLegacyDependencies(root):scanTargetRuntime(root,process.argv[3]||'astra/runtime');
  process.stdout.write(`${JSON.stringify(result,null,2)}\n`);
  process.exitCode=result.clean?0:1;
}
module.exports={RULES,DEPENDENCIES,scanText,scanTargetRuntime,scanLegacyDependencies};
