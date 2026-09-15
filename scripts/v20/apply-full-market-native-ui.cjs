#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path');
const root=path.resolve(process.env.GITHUB_WORKSPACE||'.'),P=r=>path.join(root,r);
function patch(rel,marker,from,to){
  const file=P(rel);
  let text=fs.readFileSync(file,'utf8');
  if(text.includes(marker))return{rel,state:'ALREADY_APPLIED'};
  if(!text.includes(from))throw new Error(`${rel}: expected current UI integration anchor not found (${marker})`);
  text=text.replace(from,to);
  fs.writeFileSync(file,text,'utf8');
  return{rel,state:'APPLIED'};
}
const results=[];

// Keep the compatibility entrypoint loaded from the canonical app. The loader is
// intentionally research/display-only and must never own the production decision board.
results.push(patch(
  'v20/app.js',
  'FULL_MARKET_NATIVE_UI_INTEGRATED',
  `    if (!document.querySelector('link[data-v20-stock-workbench]')) {\n      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = './stock-detail.css'; link.dataset.v20StockWorkbench = 'true'; document.head.appendChild(link);\n    }`,
  `    if (!document.querySelector('link[data-v20-stock-workbench]')) {\n      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = './stock-detail.css'; link.dataset.v20StockWorkbench = 'true'; document.head.appendChild(link);\n    }\n    // FULL_MARKET_NATIVE_UI_INTEGRATED\n    if (!document.querySelector('script[data-v20-native-research]')) {\n      const nativeScript = document.createElement('script'); nativeScript.src = './native-research.js'; nativeScript.dataset.v20NativeResearch = 'true'; nativeScript.defer = true; document.body.appendChild(nativeScript);\n    }`
));

// A missing externally verified session date is a deliberate fail-closed state, not
// a date mismatch. Only compare dates when the upstream gate says the session is verified.
results.push(patch(
  'scripts/v20/validate-ui.cjs',
  'PRICE_SESSION_VERIFICATION_AWARE_UI_CONTRACT',
  `check(gate.priceTruth?.verifiedSessionDate === current.sessionDate, 'HEALTH_GATE_PRICE_SESSION_MISMATCH');`,
  `// PRICE_SESSION_VERIFICATION_AWARE_UI_CONTRACT\nif (gate.priceTruth?.sourceSessionVerified === true) {\n  check(gate.priceTruth?.verifiedSessionDate === current.sessionDate, 'HEALTH_GATE_PRICE_SESSION_MISMATCH');\n} else {\n  check(gate.priceTruth?.verifiedSessionDate == null, 'HEALTH_UNVERIFIED_PRICE_SESSION_MUST_NOT_CLAIM_DATE');\n  check(gate.executionGrade === false, 'HEALTH_UNVERIFIED_PRICE_SESSION_MUST_BLOCK_EXECUTION');\n  check(gate.executionInputs?.sourceSession?.verified === false, 'HEALTH_UNVERIFIED_PRICE_SESSION_GATE_DRIFT');\n}`
));

// The product was intentionally migrated from the obsolete standalone Native-primary
// panel to a V17-centric Decision Board with a research-only consensus/native overlay.
// Validate the current architecture instead of resurrecting the removed panel/tabs.
results.push(patch(
  'scripts/v20/validate-ui.cjs',
  'V17_CENTRIC_NATIVE_CONSENSUS_UI_CONTRACT',
  `check(js.includes('marketPageSize: 25'), 'MARKET_PAGINATION_SIZE_POLICY_MISSING');`,
  `check(js.includes('marketPageSize: 25'), 'MARKET_PAGINATION_SIZE_POLICY_MISSING');\n// V17_CENTRIC_NATIVE_CONSENSUS_UI_CONTRACT\nconst nativeResearchJs = read('v20/native-research.js');\nconst consensusOverlayJs = read('v20/consensus-overlay.js');\nconst consensusOverlayCss = read('v20/consensus-overlay.css');\nconst decisionBoardJs = read('v20/decision-board.js');\nconst crossVersionConsensus = json('data/v20/cross-version-consensus.json');\ncheck(js.includes(\"nativeScript.src = './native-research.js'\"), 'NATIVE_COMPAT_SCRIPT_NOT_WIRED');\ncheck(html.includes('src=\"./decision-board.js\"') && html.includes('data-v20-decision-board-direct=\"true\"'), 'V17_CENTRIC_DECISION_BOARD_DIRECT_ENTRY_MISSING');\ncheck(nativeResearchJs.includes('Compatibility loader only.'), 'NATIVE_COMPAT_LOADER_ROLE_MISSING');\ncheck(nativeResearchJs.includes(\"script.src = './consensus-overlay.js'\"), 'CONSENSUS_OVERLAY_LOADER_NOT_WIRED');\ncheck(!nativeResearchJs.includes(\"script.src = './decision-board.js'\"), 'NATIVE_COMPAT_LOADER_MUST_NOT_INJECT_DECISION_BOARD');\ncheck(consensusOverlayJs.includes('../data/v20/cross-version-consensus.json'), 'CONSENSUS_EVIDENCE_NOT_WIRED');\ncheck(consensusOverlayJs.includes('consensusOverlayPanel'), 'CONSENSUS_OVERLAY_SURFACE_MISSING');\ncheck(consensusOverlayJs.includes(\"dataset.executionAuthority='none'\"), 'CONSENSUS_OVERLAY_EXECUTION_AUTHORITY_DRIFT');\ncheck(consensusOverlayJs.includes('v20NativeDiscovered'), 'NATIVE_DISCOVERY_NOT_EXPOSED_IN_CONSENSUS');\ncheck(consensusOverlayJs.includes('displayPriorityOnly') && consensusOverlayJs.includes('changesFinalDecision') && consensusOverlayJs.includes('changesExecutionPermission') && consensusOverlayJs.includes('v17RemainsProductionAuthority'), 'CONSENSUS_GOVERNANCE_GUARDS_NOT_RENDERED');\ncheck(consensusOverlayCss.includes('#consensusOverlayPanel') || consensusOverlayCss.includes('.consensus-overlay'), 'CONSENSUS_OVERLAY_STYLES_MISSING');\ncheck(decisionBoardJs.includes('decisionBoardPanel'), 'V17_CENTRIC_DECISION_BOARD_SURFACE_MISSING');\ncheck(crossVersionConsensus.schemaVersion === '20.0.0-cross-version-consensus-1', 'CONSENSUS_SCHEMA_DRIFT');\ncheck(crossVersionConsensus.sessionDate === current.sessionDate, 'CONSENSUS_SESSION_MISMATCH');\ncheck(crossVersionConsensus.scoreDefinition?.independentModelCount === 2, 'CONSENSUS_INDEPENDENT_MODEL_COUNT_DRIFT');\ncheck(crossVersionConsensus.scoreDefinition?.historicalPerformanceUsedInScore === false, 'CONSENSUS_HISTORY_MUST_NOT_AFFECT_SCORE');\ncheck(crossVersionConsensus.governance?.displayPriorityOnly === true, 'CONSENSUS_DISPLAY_PRIORITY_POLICY_DRIFT');\ncheck(crossVersionConsensus.governance?.changesFinalDecision === false, 'CONSENSUS_FINAL_DECISION_AUTHORITY_DRIFT');\ncheck(crossVersionConsensus.governance?.changesExecutionPermission === false, 'CONSENSUS_EXECUTION_PERMISSION_AUTHORITY_DRIFT');\ncheck(crossVersionConsensus.governance?.v17RemainsProductionAuthority === true, 'CONSENSUS_V17_AUTHORITY_DRIFT');\ntry { new Function(nativeResearchJs); new Function(consensusOverlayJs); new Function(decisionBoardJs); } catch { failures.push('V17_CENTRIC_NATIVE_CONSENSUS_JS_SYNTAX_INVALID'); }`
));

console.log(JSON.stringify({
  schemaVersion:'20.0.0-v17-centric-native-consensus-ui-integration-1',
  architecture:'V17_CENTRIC_DECISION_BOARD_WITH_RESEARCH_ONLY_NATIVE_CONSENSUS_OVERLAY',
  obsoleteStandaloneNativePrimaryAcceptanceRemoved:true,
  verificationAwareHealthGate:true,
  results
},null,2));
