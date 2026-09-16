'use strict';
const fs = require('fs');
const path = require('path');
const Module = require('module');

const ROOT = path.resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const filename = path.join(ROOT, 'astra/data-health/g11-data-health.cjs');
let src = fs.readFileSync(filename, 'utf8');
const needle = "marketUniverseEvaluated:pipeline.decisionSnapshot?.marketUniverseEvaluated||0,productionCutover:false";
const replacement = "marketUniverseEvaluated:pipeline.decisionSnapshot?.marketUniverseEvaluated||0,decisionSnapshot:pipeline.decisionSnapshot||null,productionCutover:false";
if (!src.includes(needle)) throw new Error('G11 decision dump patch point unavailable');
src = src.replace(needle, replacement);
const m = new Module(filename, module);
m.filename = filename;
m.paths = Module._nodeModulePaths(path.dirname(filename));
m._compile(src, filename);
const h = m.exports.buildHealth();
const d = h.pipeline.decisionSnapshot;
if (!d) throw new Error('G11 shadow DecisionSnapshot unavailable');
const out = {
  generatedAt: h.evaluatedAt,
  session: h.sessionIntegrity.latestExpectedSession,
  activeUniverse: h.universe.activeUniverseCount,
  currentCanonicalUniverse: h.metrics.currentCanonicalSecurities.numerator,
  decisionReadyUniverse: h.metrics.decisionPipeline.pipelineReadySecurities,
  regimeReadyUniverse: h.metrics.regimeInputs.analyzed,
  regimeStatus: h.metrics.regimeInputs.status,
  decisionSnapshotId: d.decisionSnapshotId || null,
  semanticDecisionHash: d.semanticDecisionHash || null,
  marketUniverseEvaluated: d.marketUniverseEvaluated || 0,
  opportunities: Array.isArray(d.top5) ? d.top5.length : 0,
  top5: d.top5 || [],
  basketPlan: d.basketPlan || null,
  riskPlan: d.riskPlan || null,
  regime: d.regime || null,
  diagnostics: d.diagnostics || [],
  legacyNetworkCalls: d.legacyNetworkCalls || 0,
  productionCutover: false,
};
const target = process.argv[2];
if (target) fs.writeFileSync(target, JSON.stringify(out, null, 2) + '\n', 'utf8');
else process.stdout.write(JSON.stringify(out, null, 2) + '\n');
