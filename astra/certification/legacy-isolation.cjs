'use strict';
const fs=require('fs');const path=require('path');
const RULES=Object.freeze([
{id:'OLD_EGX_DEPLOYMENT',category:'old-deployment-request',re:/https?:\/\/[^\s"'`]*(?:egxpro|egx-pro|RAS-EGX0\.1)[^\s"'`]*/i},
{id:'QUANT_EDGE_REMOTE',category:'uncontrolled-remote-strategy',re:/quant-edge-shadow\.vercel\.app/i},
{id:'SEPA_X_REMOTE',category:'uncontrolled-remote-strategy',re:/sepax-strategy-stable\.vercel\.app/i},
{id:'TFE_RC2_REMOTE',category:'legacy-proxy-route',re:/egx-tfe-v20-fusion-rc2[^/\s"'`]*\.vercel\.app/i},
{id:'V18_REMOTE_BRANCH',category:'legacy-remote-loader',re:/raw\.githubusercontent\.com\/rasheadsca-star\/RAS-EGX-PRO2026-NEXT\/v18-global-strategy-ensemble-20260906/i},
{id:'LEGACY_CDN_BRANCH',category:'legacy-remote-loader',re:/cdn\.jsdelivr\.net\/gh\/rasheadsca-star\/RAS-EGX-PRO2026-NEXT@(?:v18-global-strategy-ensemble-20260906|v19-egx-chat-gpt)/i},
{id:'LEGACY_ENGINE_IMPORT',category:'legacy-runtime-import',re:/(?:require|import)\s*\(?[^;\n]*(?:gann-fusion-x|scripts\/v19|scripts\/v20|scripts\/stable\/v16|sepa-x)/i},
{id:'LEGACY_PROXY_IMPLEMENTATION',category:'legacy-proxy-route',re:/(?:_proxy|proxyPass|rewrites?\s*[:(])/i},
{id:'IFRAME_RUNTIME',category:'iframe-scraping-path',re:/<iframe\b|createElement\(\s*['"]iframe['"]\s*\)/i},
{id:'LEGACY_DECISION_FALLBACK',category:'persisted-legacy-live-fallback',re:/data\/(?:stable\/v16-main-app-current|v19\/native-challenger|v20\/native-current)\.json/i},
{id:'REMOTE_STRATEGY_FETCH',category:'uncontrolled-remote-strategy',re:/fetch\s*\(\s*['"]https?:\/\/[^'"]+(?:vercel\.app|raw\.githubusercontent\.com|cdn\.jsdelivr\.net)/i}
]);
function scanText(text,file='(memory)'){const violations=[];for(const rule of RULES){const m=String(text).match(rule.re);if(m)violations.push({ruleId:rule.id,category:rule.category,file,match:m[0]})}return violations}
function walk(dir){const out=[];if(!fs.existsSync(dir))return out;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())out.push(...walk(f));else if(/\.(?:js|cjs|mjs|ts|tsx|jsx|json|html|md|yml|yaml)$/i.test(e.name))out.push(f)}return out}
function scanTargetRuntime(root,relative='astra/runtime'){const target=path.resolve(root,relative);const files=walk(target),violations=[];for(const file of files)violations.push(...scanText(fs.readFileSync(file,'utf8'),path.relative(root,file)));return{target:path.relative(root,target),scannedFiles:files.length,violations,clean:violations.length===0}}
if(require.main===module){const root=path.resolve(process.argv[2]||process.cwd());const result=scanTargetRuntime(root,process.argv[3]||'astra/runtime');process.stdout.write(`${JSON.stringify(result,null,2)}\n`);process.exitCode=result.clean?0:1}
module.exports={RULES,scanText,scanTargetRuntime};
