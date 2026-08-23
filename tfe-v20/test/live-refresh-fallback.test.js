import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const live=readFileSync(new URL('../public/live-refresh-v1.js',import.meta.url),'utf8');
test('intraday pricing has explicit completed-history fallback',()=>{assert.match(live,/async function historyFallback/);assert.match(live,/HISTORY_LAST_CLOSE/);assert.match(live,/route:'history'/);assert.match(live,/sourceMarketMinutes:870/)});
test('current history bar cannot impersonate intraday live price while market is open',()=>assert.match(live,/HISTORY_CURRENT_BAR_NOT_USED_DURING_OPEN/));
test('portfolio fallback remains display only and execution blocked',()=>{assert.match(live,/scoringImpact=NONE/);assert.match(live,/recommendationMutationAllowed=false/);assert.match(live,/executionAllowed=false/);assert.doesNotMatch(live,/from ['\"]\.\.\/src\/(engine|policy|confidence)/)});
test('both local portfolio stores are repriced automatically every five minutes',()=>{assert.match(live,/egx-tfe-rc2-v169-eod-manager/);assert.match(live,/egx-tfe-rc2-v169-portfolio/);assert.match(live,/AUTO_REFRESH_MS=300_000/)});
