#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = (rel) => path.join(root, rel);
const registryPath = 'data/v20/engine-methodology-freeze.json';
const registry = JSON.parse(fs.readFileSync(P(registryPath), 'utf8'));
const failures = [];
const check = (ok, code, detail = null) => { if (!ok) failures.push({ code, detail }); };

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function remoteRef(branch) {
  return `refs/remotes/origin/${branch}`;
}

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  }).trim();
}

function readRemoteJson(branch, rel) {
  return JSON.parse(git(['show', `${remoteRef(branch)}:${rel}`]));
}

function blobAt(branch, rel) {
  return git(['rev-parse', `${remoteRef(branch)}:${rel}`]);
}

check(registry?.policy?.immutablePerEngineVersion === true, 'GLOBAL_FREEZE_POLICY_MISSING');
check(registry?.policy?.sessionRefreshMayChangeDataAndRecommendationsOnly === true, 'SESSION_REFRESH_POLICY_MISSING');
check(registry?.policy?.methodologyChangeRequiresNewEngineVersion === true, 'VERSION_BUMP_POLICY_MISSING');
check(registry?.policy?.silentRetuneForbidden === true, 'SILENT_RETUNE_GUARD_MISSING');
check(registry?.policy?.failClosedOnMethodologyDrift === true, 'FAIL_CLOSED_POLICY_MISSING');

// Bind validation to the latest upstream engine branches. Data may refresh; methodology may not.
git([
  'fetch', '--no-tags', 'origin',
  'main:refs/remotes/origin/main',
  'develop/v17-rebuild:refs/remotes/origin/develop/v17-rebuild',
  'v19-egx-chat-gpt:refs/remotes/origin/v19-egx-chat-gpt',
]);

// The freeze registry itself cannot be retuned under the same engine version.
try {
  const previous = JSON.parse(git(['show', `HEAD^:${registryPath}`]));
  for (const [engineId, current] of Object.entries(registry.engines || {})) {
    const prior = previous?.engines?.[engineId];
    if (!prior || prior.version !== current.version) continue;
    const priorLock = {
      sourceBlobs: prior.sourceBlobs || null,
      expectedMethodology: prior.expectedMethodology || null,
      expectedEngine: prior.expectedEngine || null,
      expectedFreeze: prior.expectedFreeze || null,
    };
    const currentLock = {
      sourceBlobs: current.sourceBlobs || null,
      expectedMethodology: current.expectedMethodology || null,
      expectedEngine: current.expectedEngine || null,
      expectedFreeze: current.expectedFreeze || null,
    };
    check(stable(priorLock) === stable(currentLock), 'FREEZE_REGISTRY_CHANGED_WITHOUT_VERSION_BUMP', engineId);
  }
} catch (error) {
  // Initial installation has no previous registry. All later updates are guarded above.
  if (!String(error?.message || '').includes('does not exist in')) {
    const status = Number(error?.status);
    if (status !== 128) failures.push({ code: 'PREVIOUS_FREEZE_REGISTRY_READ_ERROR', detail: status || null });
  }
}

for (const [engineId, spec] of Object.entries(registry.engines || {})) {
  for (const [rel, expectedBlob] of Object.entries(spec.sourceBlobs || {})) {
    let actual = null;
    try { actual = blobAt(spec.branch, rel); } catch (error) {
      failures.push({ code: 'METHODOLOGY_SOURCE_MISSING', detail: { engineId, branch: spec.branch, path: rel } });
      continue;
    }
    check(actual === expectedBlob, 'METHODOLOGY_SOURCE_DRIFT', { engineId, path: rel, expectedBlob, actualBlob: actual });
  }
}

// V16.9: same frozen ranking/basket technique; only session data and resulting names may change.
try {
  const spec = registry.engines.V16_9_EQUAL_WEIGHT_BASKET;
  const artifact = readRemoteJson(spec.branch, spec.artifactPath);
  check(artifact.schemaVersion === spec.version, 'V169_ENGINE_VERSION_DRIFT', artifact.schemaVersion);
  check(stable(artifact.methodology) === stable(spec.expectedMethodology), 'V169_METHODOLOGY_DRIFT');
} catch (error) {
  failures.push({ code: 'V169_FREEZE_VALIDATION_ERROR', detail: Number(error?.status) || String(error?.message || error) });
}

// V17: production authority remains the same frozen V16.9 selection method under this V17 version.
try {
  const spec = registry.engines.V17_PRODUCTION_DECISION_LAYER;
  const artifact = readRemoteJson(spec.branch, spec.artifactPath);
  const actual = {
    id: artifact?.engine?.id,
    version: artifact?.engine?.version,
    singleProductionEngine: artifact?.engine?.singleProductionEngine,
    selectionMethodFrozen: artifact?.engine?.selectionMethodFrozen,
  };
  check(actual.version === spec.version, 'V17_ENGINE_VERSION_DRIFT', actual.version);
  check(stable(actual) === stable(spec.expectedEngine), 'V17_SELECTION_METHOD_DRIFT', actual);
} catch (error) {
  failures.push({ code: 'V17_FREEZE_VALIDATION_ERROR', detail: Number(error?.status) || String(error?.message || error) });
}

// V19: v6 methodology and all inherited v2/v4 selection sources are locked to the v6 version.
try {
  const spec = registry.engines.V19_CHAT_GPT_NATIVE_CHALLENGER_V6;
  const artifact = readRemoteJson(spec.branch, spec.artifactPath);
  check(artifact.schemaVersion === spec.version, 'V19_ENGINE_VERSION_DRIFT', artifact.schemaVersion);
  check(artifact.engineId === 'V19_CHAT_GPT_NATIVE_CHALLENGER_V6', 'V19_ENGINE_ID_DRIFT', artifact.engineId);
  check(stable(artifact.methodology) === stable(spec.expectedMethodology), 'V19_METHODOLOGY_DRIFT');
} catch (error) {
  failures.push({ code: 'V19_FREEZE_VALIDATION_ERROR', detail: Number(error?.status) || String(error?.message || error) });
}

// V20 already has a full native model freeze; bind the integration layer to that exact V1 contract.
try {
  const spec = registry.engines.V20_FULL_MARKET_NATIVE_SELECTION_V1;
  const artifact = JSON.parse(fs.readFileSync(P(spec.artifactPath), 'utf8'));
  const actual = {
    freezeId: artifact.freezeId,
    engineId: artifact.engineId,
    modelVersion: artifact.modelVersion,
    rulesetHash: artifact.rulesetHash,
    weightsHash: artifact.weightsHash,
    compositeModelDigest: artifact.compositeModelDigest,
    rankingContract: artifact.rankingContract,
  };
  check(artifact.modelVersion === spec.version, 'V20_MODEL_VERSION_DRIFT', artifact.modelVersion);
  check(stable(actual) === stable(spec.expectedFreeze), 'V20_NATIVE_METHOD_FREEZE_DRIFT', actual);
  check(artifact?.governance?.immutableMethodology === true, 'V20_IMMUTABLE_METHODOLOGY_GUARD_MISSING');
  check(artifact?.governance?.methodologyChangeRequiresNewVersion === true, 'V20_VERSION_BUMP_GUARD_MISSING');
  check(artifact?.governance?.retuneV1Forbidden === true, 'V20_V1_RETUNE_GUARD_MISSING');
} catch (error) {
  failures.push({ code: 'V20_FREEZE_VALIDATION_ERROR', detail: String(error?.message || error) });
}

const result = {
  schemaVersion: registry.schemaVersion,
  ok: failures.length === 0,
  failedCount: failures.length,
  failures,
  policy: registry.policy,
  engines: Object.fromEntries(Object.entries(registry.engines || {}).map(([id, x]) => [id, { branch: x.branch, version: x.version }]))
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
