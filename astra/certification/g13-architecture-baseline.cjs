'use strict';

const fs=require('fs');
const path=require('path');

const ROOT=path.resolve(process.cwd());
const BOUNDARY_PATH='docs/astra/ARCHITECTURE_BOUNDARIES.json';
const GATES_PATH='04_ACCEPTANCE_GATES.json';
const G12_PATH='docs/astra/G12_CERTIFICATION.json';

const SOURCE_EXTENSIONS=new Set(['.js','.cjs','.mjs']);
const EXCLUDED_PARTS=['/node_modules/','/.git/','/test/','/tests/'];
const ACTIVE_ROOTS=[
  'astra/contracts',
  'astra/pipeline',
  'astra/strategies',
  'astra/data-health',
  'astra/runtime',
  'astra/migration',
  'astra/parity',
  'astra/certification',
  'deploy/rc2-safe-shell/api',
  'gann-fusion-x/scripts/sync-sepa.cjs'
];

const ZONES=[
  {id:'shared-contracts',prefix:'astra/contracts/',modules:[],kind:'shared-contract'},
  {id:'decision-pipeline-shared',prefix:'astra/pipeline/',modules:['market-regime','signal-normalizer','evidence-engine','agreement-engine','ranking-engine','risk-engine','basket-engine','position-sizing','diagnostics'],kind:'shared-target-implementation'},
  {id:'strategy-registry',exact:'astra/strategies/strategy-registry.cjs',modules:['strategy-registry'],kind:'target-module'},
  {id:'strategy-runner',exact:'astra/strategies/strategy-runner.cjs',modules:['strategy-runner'],kind:'target-module'},
  {id:'strategy-core-private',prefix:'astra/strategies/',modules:[],kind:'private-implementation'},
  {id:'data-health',prefix:'astra/data-health/',modules:['data-health'],kind:'target-module'},
  {id:'migration',prefix:'astra/migration/',modules:['migration'],kind:'target-module'},
  {id:'certification',prefix:'astra/certification/',modules:['certification'],kind:'target-module'},
  {id:'parity-control',prefix:'astra/parity/',modules:[],kind:'control-plane'},
  {id:'runtime-adapter',prefix:'astra/runtime/bridges/',modules:[],kind:'active-unregistered-layer'},
  {id:'ui-runtime',prefix:'astra/runtime/v18/',modules:[],kind:'active-unregistered-layer'},
  {id:'api-runtime',prefix:'deploy/rc2-safe-shell/api/',modules:[],kind:'active-unregistered-layer'},
  {id:'integration-adapter',exact:'gann-fusion-x/scripts/sync-sepa.cjs',modules:[],kind:'active-unregistered-layer'},
  {id:'vendor-sepa',prefix:'astra/vendor/sepa-x/',modules:[],kind:'vendored-isolated-source'}
];

function rel(p){return path.relative(ROOT,p).split(path.sep).join('/')}
function readJson(p){return JSON.parse(fs.readFileSync(path.join(ROOT,p),'utf8'))}
function walk(entry,out=[]){
  const abs=path.join(ROOT,entry);
  if(!fs.existsSync(abs))return out;
  const st=fs.statSync(abs);
  if(st.isFile()){out.push(abs);return out}
  for(const name of fs.readdirSync(abs)){
    const p=path.join(abs,name);
    const r=rel(p);
    if(EXCLUDED_PARTS.some(x=>('/'+r+'/').includes(x)))continue;
    const s=fs.statSync(p);
    if(s.isDirectory())walk(r,out);
    else out.push(p);
  }
  return out;
}
function zoneFor(file){
  const p=typeof file==='string'?file:rel(file);
  return ZONES.find(z=>z.exact===p||(z.prefix&&p.startsWith(z.prefix)))||{id:'unmapped-active',modules:[],kind:'active-unregistered-layer'};
}
function sourceFiles(){
  const seen=new Set(),out=[];
  for(const r of ACTIVE_ROOTS){
    for(const f of walk(r)){
      const p=rel(f);
      if(seen.has(p))continue;
      seen.add(p);
      if(SOURCE_EXTENSIONS.has(path.extname(p)))out.push(p);
    }
  }
  return out.sort();
}
function importsFrom(text){
  const out=[];
  const regs=[
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\bimport\s+(?:[^'"]+?\s+from\s+)?['"]([^'"]+)['"]/g
  ];
  for(const re of regs){let m;while((m=re.exec(text)))out.push(m[1])}
  return [...new Set(out)];
}
function resolveImport(fromFile,spec){
  if(!spec.startsWith('.'))return null;
  const base=path.resolve(ROOT,path.dirname(fromFile),spec);
  const candidates=[base,...['.js','.cjs','.mjs'].map(x=>base+x),...['index.js','index.cjs','index.mjs'].map(x=>path.join(base,x))];
  for(const p of candidates)if(fs.existsSync(p)&&fs.statSync(p).isFile())return rel(p);
  return rel(base);
}
function boundaryMap(bounds){return new Map(bounds.modules.map(m=>[m.module,m]))}
function pushIssue(issues,issue){issues.push({severity:'MEDIUM',...issue})}

function scan(root=ROOT){
  if(path.resolve(root)!==ROOT)throw new Error('G13 baseline scanner currently requires repository root cwd');
  const bounds=readJson(BOUNDARY_PATH);
  const gates=readJson(GATES_PATH);
  const g12=readJson(G12_PATH);
  const bmap=boundaryMap(bounds);
  const files=sourceFiles();
  const graph={nodes:[],edges:[]};
  const issues=[];
  const zoneStats=new Map();

  for(const file of files){
    const z=zoneFor(file);
    const text=fs.readFileSync(path.join(ROOT,file),'utf8');
    graph.nodes.push({file,zone:z.id,kind:z.kind,logicalModules:z.modules});
    const zs=zoneStats.get(z.id)||{zone:z.id,kind:z.kind,files:0,logicalModules:z.modules};
    zs.files++;zoneStats.set(z.id,zs);

    if(z.kind==='active-unregistered-layer'){
      pushIssue(issues,{severity:'HIGH',code:'UNREGISTERED_ACTIVE_LAYER',file,zone:z.id,detail:'Active source is outside the 30 registered target module boundaries.'});
    }
    if(z.kind==='shared-target-implementation'&&z.modules.length>1){
      pushIssue(issues,{severity:'HIGH',code:'PHYSICAL_BOUNDARY_COLLAPSE',file,zone:z.id,logicalModules:z.modules,detail:'One physical source file belongs to a zone implementing multiple logical architecture modules.'});
    }

    const directIo=/\b(?:readFileSync|writeFileSync|readFile|writeFile|appendFileSync|createReadStream|createWriteStream)\s*\(/.test(text);
    if(directIo&&['decision-pipeline-shared','strategy-core-private','runtime-adapter','ui-runtime','api-runtime','integration-adapter'].includes(z.id)){
      pushIssue(issues,{severity:'HIGH',code:'DIRECT_FILE_IO_BYPASS',file,zone:z.id,detail:'Active decision/runtime layer performs direct filesystem I/O instead of going through an owned data contract.'});
    }
    if(/\bfetch\s*\(/.test(text)&&!['certification','parity-control'].includes(z.id)){
      pushIssue(issues,{severity:'HIGH',code:'DIRECT_NETWORK_ACCESS',file,zone:z.id,detail:'Active layer contains a direct fetch() call; requires contract/service-boundary review.'});
    }
    if(/(?:data\/stable|docs\/astra|data\/archive|raw_legacy|canonical_history)/.test(text)&&['decision-pipeline-shared','strategy-core-private','runtime-adapter','ui-runtime','api-runtime','integration-adapter'].includes(z.id)){
      pushIssue(issues,{severity:'HIGH',code:'DIRECT_DATA_PATH_COUPLING',file,zone:z.id,detail:'Active decision/runtime source references persistence/evidence paths directly.'});
    }

    for(const spec of importsFrom(text)){
      const target=resolveImport(file,spec);
      const edge={from:file,fromZone:z.id,spec,target,targetZone:null,classification:'external-or-builtin'};
      if(target){
        const tz=zoneFor(target);edge.targetZone=tz.id;edge.targetLogicalModules=tz.modules;edge.classification='relative-static-import';
        if(z.kind==='target-module'&&tz.modules.length){
          const sourceModule=z.modules[0],allowed=new Set(bmap.get(sourceModule)?.allowedImports||[]);
          const disallowed=tz.modules.filter(m=>m!==sourceModule&&!allowed.has(m));
          if(disallowed.length){
            pushIssue(issues,{severity:'HIGH',code:'FORBIDDEN_LOGICAL_IMPORT',file,zone:z.id,sourceModule,target,targetZone:tz.id,targetLogicalModules:tz.modules,disallowed,detail:`${sourceModule} imports implementation containing module(s) outside allowedImports.`});
          }
        }
        const privateStrategyTarget=tz.kind==='private-implementation';
        const privateStrategyOwner=z.id==='strategy-registry'||z.id==='strategy-runner'||z.id==='parity-control';
        if(privateStrategyTarget&&!privateStrategyOwner){
          pushIssue(issues,{severity:'HIGH',code:'DIRECT_INTERNAL_IMPLEMENTATION_ACCESS',file,zone:z.id,target,targetZone:tz.id,detail:'Active non-owner layer imports private strategy implementation instead of the public strategy-registry/strategy-runner boundary.'});
        }
        if(['runtime-adapter','ui-runtime','api-runtime','integration-adapter'].includes(z.id)&&['decision-pipeline-shared','data-health','migration'].includes(tz.id)){
          pushIssue(issues,{severity:'HIGH',code:'DIRECT_INTERNAL_IMPLEMENTATION_ACCESS',file,zone:z.id,target,targetZone:tz.id,detail:'Adapter/UI/runtime layer imports an internal implementation file directly instead of a registered public contract/facade.'});
        }
        if(z.id==='data-health'&&['decision-pipeline-shared','strategy-core-private','strategy-runner'].includes(tz.id)){
          pushIssue(issues,{severity:'HIGH',code:'DATA_HEALTH_DECISION_COUPLING',file,zone:z.id,target,targetZone:tz.id,detail:'Data-health is coupled directly to decision/strategy implementation.'});
        }
      }
      graph.edges.push(edge);
    }
  }

  const mapped=new Map(bounds.modules.map(m=>[m.module,[]]));
  for(const n of graph.nodes)for(const m of n.logicalModules||[])if(mapped.has(m))mapped.get(m).push(n.file);
  const moduleIsolation=bounds.modules.map(m=>{
    const impl=[...new Set(mapped.get(m.module)||[])];
    const dedicated=impl.filter(f=>{const z=zoneFor(f);return z.kind==='target-module'&&z.modules.length===1&&z.modules[0]===m.module});
    let status='NO_PHYSICAL_MAPPING';
    if(dedicated.length)status='DEDICATED_ZONE';
    else if(impl.length)status='SHARED_PHYSICAL_ZONE';
    return{module:m.module,status,implementationFiles:impl,dedicatedFiles:dedicated,allowedImports:m.allowedImports};
  });
  for(const m of moduleIsolation){
    if(m.status==='NO_PHYSICAL_MAPPING')pushIssue(issues,{severity:'MEDIUM',code:'NO_DEDICATED_IMPLEMENTATION_BOUNDARY',module:m.module,detail:'Contract exists, but the baseline cannot map this logical module to a dedicated target source boundary. This does not by itself mean functionality is absent.'});
  }

  const gateMap=new Map(gates.gates.map(g=>[g.id,g.status]));
  const hard=issues.filter(x=>x.severity==='HIGH').length;
  const medium=issues.filter(x=>x.severity==='MEDIUM').length;
  const counts={};
  for(const i of issues)counts[i.code]=(counts[i.code]||0)+1;

  return{
    schemaVersion:'astra-g13-architecture-baseline-1',
    generatedAt:new Date().toISOString(),
    sourceHead:process.env.G13_SOURCE_HEAD||process.env.GITHUB_SHA||'UNKNOWN',
    gateStatus:'PENDING',
    productionCutover:false,
    priorGateBoundary:{
      g01ThroughG12Green:[...Array(12)].every((_,i)=>gateMap.get('G'+String(i+1).padStart(2,'0'))==='GREEN'),
      g12Status:gateMap.get('G12'),
      runtimeLegacyDependencyCount:g12.runtimeLegacyDependencyCount,
      dependenciesClosed:g12.dependencyClosure?.closed+'/'+g12.dependencyClosure?.total,
      productionCutover:g12.productionCutover
    },
    contract:{logicalModuleCount:bounds.modules.length,globalRules:bounds.globalRules},
    scanScope:{activeRoots:ACTIVE_ROOTS,sourceFiles:files.length,zones:[...zoneStats.values()].sort((a,b)=>a.zone.localeCompare(b.zone))},
    dependencyGraph:{nodeCount:graph.nodes.length,edgeCount:graph.edges.length},
    moduleIsolation,
    findings:{total:issues.length,high:hard,medium,byCode:counts,items:issues},
    interpretation:{
      zeroFindingRequiredForG13Green:true,
      baselineOnly:true,
      noRuntimeRemediationPerformed:true,
      notes:[
        'NO_PHYSICAL_MAPPING means isolation cannot yet be proven; it is not a claim that business functionality is absent.',
        'PHYSICAL_BOUNDARY_COLLAPSE identifies source zones that implement multiple logical modules in one physical boundary.',
        'Adapter/UI layers outside the 30-module registry are reported separately so they can be assigned an explicit public contract or isolated facade.'
      ]
    },
    graph
  };
}
function md(r){
  const lines=[
    '# G13 Architecture Isolation Baseline',
    '',
    `Source HEAD: \`${r.sourceHead}\``,
    '',
    '**Gate status: PENDING.** This is a baseline only; no runtime remediation or production cutover was performed.',
    '',
    '## Boundary preservation',
    '',
    `- G01→G12 GREEN: ${r.priorGateBoundary.g01ThroughG12Green}`,
    `- G12 runtime legacy dependencies: ${r.priorGateBoundary.runtimeLegacyDependencyCount}`,
    `- G12 dependencies closed: ${r.priorGateBoundary.dependenciesClosed}`,
    `- productionCutover: ${r.productionCutover}`,
    '',
    '## Baseline summary',
    '',
    `- Logical architecture modules: ${r.contract.logicalModuleCount}`,
    `- Scanned active source files: ${r.scanScope.sourceFiles}`,
    `- Static dependency edges: ${r.dependencyGraph.edgeCount}`,
    `- HIGH findings: ${r.findings.high}`,
    `- MEDIUM findings: ${r.findings.medium}`,
    '',
    '## Finding classes',
    ''
  ];
  for(const [k,v] of Object.entries(r.findings.byCode).sort())lines.push(`- ${k}: ${v}`);
  lines.push('','## Module physical-isolation map','');
  for(const m of r.moduleIsolation)lines.push(`- ${m.module}: ${m.status}${m.implementationFiles.length?` — ${m.implementationFiles.join(', ')}`:''}`);
  lines.push('','## Interpretation','','G13 cannot be certified from this baseline while HIGH findings remain or logical modules cannot be proven isolated behind their declared contracts. Remediation must proceed one issue family at a time, followed by G01→G12 regression and a final G13 certification.','');
  return lines.join('\n');
}
function writeOutputs(r){
  const graphDoc={schemaVersion:'astra-g13-dependency-graph-1',generatedAt:r.generatedAt,sourceHead:r.sourceHead,nodes:r.graph.nodes,edges:r.graph.edges};
  fs.writeFileSync(path.join(ROOT,'docs/astra/G13_ARCHITECTURE_BASELINE.json'),JSON.stringify({...r,graph:undefined},null,2)+'\n');
  fs.writeFileSync(path.join(ROOT,'docs/astra/G13_DEPENDENCY_GRAPH.json'),JSON.stringify(graphDoc,null,2)+'\n');
  fs.writeFileSync(path.join(ROOT,'docs/astra/G13_ARCHITECTURE_BASELINE.md'),md(r)+'\n');
  for(const p of ['05_WORK_STATE.json','docs/astra/WORK_STATE.json']){
    const full=path.join(ROOT,p);if(!fs.existsSync(full))continue;
    const s=JSON.parse(fs.readFileSync(full,'utf8'));
    s.current_phase='G13_BASELINE_CAPTURED_REMEDIATION_PENDING';
    s.current_gate='G13';
    s.last_green_gate='G12';
    s.g13_baseline={status:'PENDING_REMEDIATION',sourceCommit:r.sourceHead,logicalModules:r.contract.logicalModuleCount,scannedSourceFiles:r.scanScope.sourceFiles,dependencyEdges:r.dependencyGraph.edgeCount,highFindings:r.findings.high,mediumFindings:r.findings.medium,productionCutover:false};
    s.blocking_issues=[`G13 architecture isolation baseline has ${r.findings.high} HIGH and ${r.findings.medium} MEDIUM findings; remediation/certification not started.`];
    s.next_action='Remediate G13 architecture-isolation findings one issue family at a time. Do not reopen G12 and do not cut over production.';
    s.last_updated=r.generatedAt;
    fs.writeFileSync(full,JSON.stringify(s,null,2)+'\n');
  }
}
if(require.main===module){
  const r=scan();
  if(process.argv.includes('--write'))writeOutputs(r);
  process.stdout.write('ASTRA_G13_BASELINE '+JSON.stringify({sourceHead:r.sourceHead,modules:r.contract.logicalModuleCount,files:r.scanScope.sourceFiles,edges:r.dependencyGraph.edgeCount,high:r.findings.high,medium:r.findings.medium,g13:r.gateStatus,productionCutover:r.productionCutover})+'\n');
}
module.exports={scan,importsFrom,resolveImport,zoneFor,ZONES,ACTIVE_ROOTS};
