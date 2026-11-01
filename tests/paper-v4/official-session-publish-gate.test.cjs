'use strict';
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const result=execFileSync(process.execPath,['scripts/paper-v4/official-session-publish-gate.cjs'],{encoding:'utf8'});
assert.match(result,/V4_PRESERVE_FROZEN_SESSION 2026-10-29/);
assert.match(result,/no new price or recommendation publication/);
console.log('Frozen session publication gate verified');
