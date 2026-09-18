'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {scanText,RULES,DEPENDENCIES,scanTargetRuntime,scanLegacyDependencies}=require('../../astra/certification/legacy-isolation.cjs');

test('legacy isolation generic rules detect prohibited classes',()=>{
  const fixtures=[
    "fetch('https://quant-edge-shadow.vercel.app/api/run')",
    "const BASE='https://sepax-strategy-stable.vercel.app'",
    "<iframe src='https://old.example'></iframe>",
    "const x=require('../gann-fusion-x/engine/fusion.js')",
    "const p='data/stable/v16-main-app-current.json'",
    "rewrites: [{source:'/core/:path*',destination:'https://egx-tfe-v20-fusion-rc2.vercel.app/:path*'}]",
    "ref: develop/sepax-isolated-v1"
  ];
  const categories=new Set(fixtures.flatMap(x=>scanText(x).map(v=>v.category)));
  for(const required of['uncontrolled-remote-strategy','iframe-scraping-path','legacy-runtime-import','persisted-legacy-live-fallback','legacy-proxy-route','cross-branch-build-dependency'])
    assert.equal(categories.has(required),true,`missing detection for ${required}`);
});

test('original G06 compatibility scanner remains callable but is not the G12 full scan',()=>{
  assert.ok(RULES.length>=11);
  const result=scanTargetRuntime(process.cwd(),'astra/runtime');
  assert.equal(Array.isArray(result.violations),true);
});

test('G12 declared dependency scanner can distinguish all R01-R08 families',()=>{
  assert.equal(DEPENDENCIES.length,8);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'g12-fixture-'));
  const put=(p,s)=>{const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,s)};
  put('v18-live/index.html',`
    https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/v18-global-strategy-ensemble-20260906/preview-v18-web/index.html
    https://cdn.jsdelivr.net/gh/rasheadsca-star/RAS-EGX-PRO2026-NEXT@v18-global-strategy-ensemble-20260906/preview-v18-web/index.html`);
  put('scripts/stable/v16-main-app-consensus.cjs',`
    https://raw.githubusercontent.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT/v19-egx-chat-gpt/data/v19/native-challenger-v6.json
    https://rasheadsca-star.github.io/RAS-EGX0.1/data/v20/native-current.json
    https://quant-edge-shadow.vercel.app/api/run`);
  put('gann-fusion-x/scripts/sync-sepa.cjs',"https://sepax-strategy-stable.vercel.app");
  put('deploy/rc2-safe-shell/api/_proxy.js',"https://egx-tfe-v20-fusion-rc2-abc-steverabin38-1168s-projects.vercel.app");
  put('.github/workflows/static.yml',"ref: develop/sepax-isolated-v1\npath: .sepax-pages-source");
  const result=scanLegacyDependencies(root);
  assert.equal(result.runtimeLegacyDependencyCount,8);
  assert.deepEqual(result.dependencyIds,DEPENDENCIES.map(x=>x.dependencyId).sort());
  fs.rmSync(root,{recursive:true,force:true});
});

test('G12 baseline evidence preserves the pre-removal count without claiming G12 green',()=>{
  const b=JSON.parse(fs.readFileSync(path.join(__dirname,'../../docs/astra/G12_BASELINE_ISOLATION.json'),'utf8'));
  assert.equal(b.runtimeLegacyDependencyCount,8);
  assert.equal(b.targetRuntimeLegacyDependencyCount,0);
  assert.equal(b.g12Status,'PENDING');
  assert.equal(b.productionCutover,false);
});
