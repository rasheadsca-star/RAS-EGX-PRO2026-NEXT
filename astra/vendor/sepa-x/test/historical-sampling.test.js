import test from 'node:test';
import assert from 'node:assert/strict';
import { selectTailAnchoredSignalDates } from '../src/historical-simulator.js';

// Regression guard: expanding the benchmark must preserve the recent sample exactly.
const dates=n=>Array.from({length:n},(_,i)=>`D${String(i+1).padStart(3,'0')}`);

test('tail-anchored signal samples are nested when maxSignalDates expands',()=>{
  const eligible=dates(60);
  const small=selectTailAnchoredSignalDates(eligible,3,8);
  const large=selectTailAnchoredSignalDates(eligible,3,15);
  assert.deepEqual(large.slice(-small.length),small);
  assert.equal(small.at(-1),eligible.at(-1));
});

test('adding an older eligible date does not phase-shift the recent sample',()=>{
  const eligible=dates(60);
  const shifted=['D000',...eligible];
  const before=selectTailAnchoredSignalDates(eligible,3,12);
  const after=selectTailAnchoredSignalDates(shifted,3,12);
  assert.deepEqual(after,before);
});