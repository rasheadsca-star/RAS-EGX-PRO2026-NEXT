'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const workflow=fs.readFileSync(path.join(__dirname,'../../.github/workflows/egx-verified-incremental-recovery.yml'),'utf8');
const step=workflow.split('      - name: Commit only proven data recovery')[1]||'';
test('recovery publishes only verified ticker histories and provenance',()=>{
 assert.match(step,/git add "data\/history\/\$ticker\.json"/);
 assert.match(step,/git add data\/stable\/v15-price-truth\.json/);
 assert.match(step,/git diff --cached --quiet/);
});
test('rebase starts clean after preserving resolver-generated uncommitted diagnostics',()=>{
 const commit=step.indexOf('git commit -m "Recover independently verified EGX current-session rows"');
 const stash=step.indexOf('git stash push --include-untracked');
 const clean=step.indexOf('DIRTY_WORKTREE_ABORT_REBASE');
 const rebase=step.indexOf('git rebase origin/main');
 assert.ok(commit>=0&&commit<stash&&stash<clean&&clean<rebase);
 assert.doesNotMatch(step,/git pull --rebase -X ours/);
});
test('same accepted count is not enough to override a changed canonical truth',()=>{
 assert.equal((step.match(/PRICE_TRUTH_CHANGED_ABORT_CONCURRENT_REPAIR/g)||[]).length,2);
 assert.match(step,/BASE_TRUTH_BLOB=\$\(git hash-object artifacts\/recovery-before-price-truth\.json\)/);
 assert.match(step,/REMOTE_TRUTH_BLOB=\$\(git rev-parse origin\/main:data\/stable\/v15-price-truth\.json\)/);
 assert.match(step,/cp artifacts\\/recovery-before-price-truth\\.json \\/tmp\\/egx-recovery-before-price-truth\\.json/);
 assert.equal((step.match(/\\/tmp\\/egx-recovery-before-price-truth\\.json/g)||[]).length,5);
 assert.match(step,/SESSION_ADVANCED_ABORT_STALE_REPAIR/);
});
