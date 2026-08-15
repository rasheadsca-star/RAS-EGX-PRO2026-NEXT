#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(process.env.GITHUB_WORKSPACE || '.');
const P = rel => path.join(root, rel);

function replaceExact(rel, from, to, marker = to) {
  const file = P(rel);
  let text = fs.readFileSync(file, 'utf8');
  if (text.includes(marker)) return { rel, state: 'ALREADY_APPLIED' };
  if (!text.includes(from)) throw new Error(`${rel}: expected liquidity-upgrade anchor not found`);
  text = text.replace(from, to);
  fs.writeFileSync(file, text, 'utf8');
  return { rel, state: 'APPLIED' };
}

const policyPath = 'data/v20/decision-intelligence-policy.json';
const policy = JSON.parse(fs.readFileSync(P(policyPath), 'utf8'));
const expectedWeights = {
  legacyOpportunity: 10,
  dataEvidence: 18,
  liquidity: 30,
  supportResistance: 12,
  netRiskReward: 15,
  tradePlanAlignment: 10,
  currentTechnical: 5,
};
for (const [key, value] of Object.entries(expectedWeights)) {
  if (Number(policy.componentWeightsPct?.[key]) !== value) {
    throw new Error(`V20 liquidity upgrade policy mismatch: ${key} must be ${value}%`);
  }
}
const weightTotal = Object.values(expectedWeights).reduce((a, b) => a + b, 0);
if (weightTotal !== 100) throw new Error('V20 liquidity upgrade weights must sum to 100');
if (policy.status !== 'SHADOW_RESEARCH_ONLY_UNCALIBRATED') throw new Error('V20 liquidity upgrade must remain shadow/research only');
if (policy.scoreCanOpenExecutionGate !== false || policy.scoreCanDriveProductionAllocation !== false || policy.scoreCanChangeChampion !== false) {
  throw new Error('V20 liquidity upgrade attempted to cross production governance boundary');
}
if (policy.liquidityScoring?.researchWeightPct !== 30 || policy.liquidityScoring?.binaryEligibilityFallbackAllowed !== false) {
  throw new Error('V20 liquidity scoring contract missing or invalid');
}

const rel = 'scripts/v20/build-stock-profiles.cjs';
const results = [];

results.push(replaceExact(
  rel,
  "const decisionPolicy = read('data/v20/decision-intelligence-policy.json', null);\nconst gate = read('data/v17/resilient-session-status.json', {});",
  "const decisionPolicy = read('data/v20/decision-intelligence-policy.json', null);\nconst liquidityGate = read('data/v17/liquidity-gate.json', { rows: [] });\nconst gate = read('data/v17/resilient-session-status.json', {});",
  "const liquidityGate = read('data/v17/liquidity-gate.json', { rows: [] });"
));

results.push(replaceExact(
  rel,
  "const technicalMap = new Map((technical.symbols || []).map(row => [row.ticker, row]));",
  "const technicalMap = new Map((technical.symbols || []).map(row => [row.ticker, row]));\nconst liquidityMap = new Map((liquidityGate.rows || []).map(row => [String(row.symbol || row.ticker || '').trim().toUpperCase(), row]));",
  "const liquidityMap = new Map((liquidityGate.rows || []).map"
));

results.push(replaceExact(
  rel,
  "function decisionSrScore(sr) {\n  if (!sr) return null;\n  const statusScore = sr.sessionAligned !== true ? 25 : sr.executionEligible === true ? 100 : 65;\n  const confRaw = finite(sr.confidence);\n  const confPct = confRaw === null ? null : clamp(confRaw <= 1 ? confRaw * 100 : confRaw);\n  return avg([statusScore, confPct]);\n}\nfunction decisionDataScore(profile) {",
  "function decisionSrScore(sr) {\n  if (!sr) return null;\n  const statusScore = sr.sessionAligned !== true ? 25 : sr.executionEligible === true ? 100 : 65;\n  const confRaw = finite(sr.confidence);\n  const confPct = confRaw === null ? null : clamp(confRaw <= 1 ? confRaw * 100 : confRaw);\n  return avg([statusScore, confPct]);\n}\nfunction decisionLiquidityScore(liquidity) {\n  if (!liquidity || liquidity.evidenceAvailable !== true) return null;\n  const raw = clamp(liquidity.liquidityScore);\n  if (raw === null) return null;\n  if (liquidity.sessionAligned !== true) return Math.min(raw, 25);\n  return raw;\n}\nfunction decisionDataScore(profile) {",
  "function decisionLiquidityScore(liquidity) {"
));

results.push(replaceExact(
  rel,
  "function technicalProfile(ticker) {",
  "function liquidityProfile(ticker) {\n  const symbol = String(ticker || '').trim().toUpperCase();\n  const item = liquidityMap.get(symbol);\n  const sessionAligned = liquidityGate.sessionAligned === true && liquidityGate.referenceSessionDate === current.sessionDate;\n  if (!item) {\n    return {\n      available: false, evidenceAvailable: false, sessionAligned, liquidityScore: null, liquidityDecision: 'NO_EVIDENCE',\n      executionEligible: false, conditionalEligible: false, currentTurnover: null, avg20Turnover: null,\n      currentVolume: null, avg20Volume: null, trades: null, historicalSessionsUsed: null,\n      scoringContract: liquidityGate.sourceLineage?.scoringContract || null, evidenceSource: 'data/v17/liquidity-gate.json',\n    };\n  }\n  return {\n    available: item.evidenceAvailable === true, evidenceAvailable: item.evidenceAvailable === true, sessionAligned,\n    liquidityScore: finite(item.liquidityScore), liquidityDecision: item.liquidityDecision || null,\n    executionEligible: item.executionLiquidityOk === true, conditionalEligible: item.conditionalLiquidityOk === true,\n    currentTurnover: finite(item.currentTurnover), avg20Turnover: finite(item.avg20Turnover),\n    currentVolume: finite(item.currentVolume), avg20Volume: finite(item.avg20Volume), trades: finite(item.trades),\n    historicalSessionsUsed: finite(item.historicalSessionsUsed), reason: item.reason || null,\n    scoringContract: liquidityGate.sourceLineage?.scoringContract || null, evidenceSource: 'data/v17/liquidity-gate.json',\n  };\n}\n\nfunction technicalProfile(ticker) {",
  "function liquidityProfile(ticker) {"
));

results.push(replaceExact(
  rel,
  "    liquidity: decisionComponent('LIQUIDITY_EVIDENCE', weights.liquidity, profile.liquidity?.executionEligible === true ? 100 : 30, 'data/v17/liquidity-gate.json', { executionEligible: profile.liquidity?.executionEligible === true }),",
  "    liquidity: decisionComponent('LIQUIDITY_EVIDENCE', weights.liquidity, decisionLiquidityScore(profile.liquidity), 'data/v17/liquidity-gate.json', {\n      liquidityScore: finite(profile.liquidity?.liquidityScore), liquidityDecision: profile.liquidity?.liquidityDecision || null,\n      evidenceAvailable: profile.liquidity?.evidenceAvailable === true, sessionAligned: profile.liquidity?.sessionAligned === true,\n      executionEligible: profile.liquidity?.executionEligible === true, conditionalEligible: profile.liquidity?.conditionalEligible === true,\n      currentTurnover: finite(profile.liquidity?.currentTurnover), avg20Turnover: finite(profile.liquidity?.avg20Turnover),\n      currentVolume: finite(profile.liquidity?.currentVolume), avg20Volume: finite(profile.liquidity?.avg20Volume),\n      trades: finite(profile.liquidity?.trades), historicalSessionsUsed: finite(profile.liquidity?.historicalSessionsUsed),\n      scoringContract: profile.liquidity?.scoringContract || null, binaryEligibilityFallbackUsed: false,\n    }),",
  "binaryEligibilityFallbackUsed: false"
));

results.push(replaceExact(
  rel,
  "  const ta = technicalProfile(row.ticker);\n  const strengths = [",
  "  const ta = technicalProfile(row.ticker);\n  const liq = liquidityProfile(row.ticker);\n  const strengths = [",
  "  const liq = liquidityProfile(row.ticker);"
));

results.push(replaceExact(
  rel,
  "    row.liquidityExecutionEligible === true ? 'LIQUIDITY_GATE_ELIGIBLE' : null,",
  "    liq.executionEligible === true ? 'LIQUIDITY_GATE_ELIGIBLE' : null,",
  "    liq.executionEligible === true ? 'LIQUIDITY_GATE_ELIGIBLE' : null,"
));

results.push(replaceExact(
  rel,
  "    liquidity: { executionEligible: row.liquidityExecutionEligible === true, evidenceSource: 'data/v17/liquidity-gate.json' },",
  "    liquidity: {\n      ...liq,\n      currentDecisionExecutionEligible: row.liquidityExecutionEligible === true,\n      consistentWithCurrentDecision: liq.executionEligible === (row.liquidityExecutionEligible === true),\n    },",
  "      consistentWithCurrentDecision: liq.executionEligible === (row.liquidityExecutionEligible === true),"
));

results.push(replaceExact(
  rel,
  "    usedForChampionSelection: false,\n    medianResearchDecisionScore: medianDecisionScore === null ? null : round(medianDecisionScore, 1),",
  "    usedForChampionSelection: false,\n    liquidityComponentWeightPct: decisionPolicy.componentWeightsPct.liquidity,\n    liquidityScoringContract: decisionPolicy.liquidityScoring?.scoringContract || null,\n    liquidityUsesNumericV17Score: true,\n    liquidityComponentAvailableCount: profiles.filter(p => p.decisionIntelligence.components.liquidity.available).length,\n    medianResearchDecisionScore: medianDecisionScore === null ? null : round(medianDecisionScore, 1),",
  "    liquidityUsesNumericV17Score: true,"
));

const patched = fs.readFileSync(P(rel), 'utf8');
for (const marker of [
  "decisionLiquidityScore(profile.liquidity)",
  "const liquidityGate = read('data/v17/liquidity-gate.json'",
  "const liquidityMap = new Map",
  "schemaVersion: '20.0.0-stock-profiles-3'",
  "liquidityUsesNumericV17Score: true",
]) {
  if (!patched.includes(marker)) throw new Error(`Liquidity upgrade verification failed: missing ${marker}`);
}

console.log(JSON.stringify({
  schemaVersion: '20.0.0-liquidity-decision-upgrade-2',
  status: 'APPLIED_OR_ALREADY_PRESENT',
  researchOnly: true,
  liquidityWeightPct: 30,
  supportResistanceWeightPct: 12,
  totalWeightPct: 100,
  liquidityScoreSource: 'data/v17/liquidity-gate.json::liquidityScore',
  stockProfilesSchemaPreserved: '20.0.0-stock-profiles-3',
  binaryEligibilityFallbackUsed: false,
  sessionMisalignmentScoreCap: 25,
  results,
}, null, 2));
