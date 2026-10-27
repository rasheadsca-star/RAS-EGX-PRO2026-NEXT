'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const workflow=fs.readFileSync(path.join(__dirname,'../../.github/workflows/egx-verified-incremental-recovery.yml'),'utf8');
const step=workflow.split('      - name: Commit only proven data recovery')[1]||'';
test('recovery stages only verified ticker histories and source provenance',()=>{
 assert.ok(step.includes('git add "data/history/$ticker.json"'));
 assert.ok(step.includes('git add data/stable/v15-price-truth.json'));
 assert.ok(step.includes('git diff --cached --quiet'));
});
test('rebase starts clean after preserving resolver-generated uncommitted diagnostics',()=>{
 const commit=step.indexOf('git commit -m "Recover independently verified EGX current-session rows"');
 const stash=step.indexOf('git stash push --include-untracked');
 const clean=step.indexOf('DIRTY_WORKTREE_ABORT_REBASE');
 const rebase=step.indexOf('git rebase origin/main');
 assert.ok(commit>=0&&commit<stash&&stash<clean&&clean<rebase);
 assert.ok(!step.includes('git pull --rebase -X ours'));
});
test('baseline survives stash and concurrent truth changes abort publication',()=>{
 assert.equal(step.split('PRICE_TRUTH_CHANGED_ABORT_CONCURRENT_REPAIR').length-1,2);
 assert.ok(step.includes('BASE_TRUTH_BLOB=$(git hash-object /tmp/egx-recovery-before-price-truth.json)'));
 assert.ok(step.includes('REMOTE_TRUTH_BLOB=$(git rev-parse origin/main:data/stable/v15-price-truth.json)'));
 assert.ok(step.includes('cp artifacts/recovery-before-price-truth.json /tmp/egx-recovery-before-price-truth.json'));
 assert.equal(step.split('/tmp/egx-recovery-before-price-truth.json').length-1,5);
 assert.ok(step.includes('SESSION_ADVANCED_ABORT_STALE_REPAIR'));
});
test('last recovered ticker is not dropped when staging and every recovered history must be present in commit',()=>{
 assert.ok(step.includes("j.recovered.join('\\n')+'\\n'"));
 assert.equal(step.split('while IFS= read -r ticker || [ -n "$ticker" ]; do').length-1,2);
 assert.ok(step.includes('RECOVERED_HISTORY_NOT_STAGED:$ticker'));
 assert.ok(step.includes('git diff --cached --name-only -- "data/history/$ticker.json"'));
});
