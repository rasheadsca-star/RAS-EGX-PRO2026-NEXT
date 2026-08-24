import test from 'node:test';import assert from 'node:assert/strict';import {assertPointInTime,expectancy,walkForward} from '../src/backtest.js';
test('look-ahead fundamentals are blocked',()=>assert.deepEqual(assertPointInTime({fundamentals:{publicationDate:'2026-02-01'}},'2026-01-15').violations,['LOOKAHEAD_FUNDAMENTALS']));
test('expectancy is primary measurable outcome',()=>{const x=expectancy([{netR:2},{netR:-1},{netR:3},{netR:-1}]);assert.equal(x.expectancy,0.75);assert.equal(x.winRate,0.5);});
test('walk-forward windows are explicit',()=>assert.equal(walkForward([{train:'1-3',validate:'4',test:'5'}])[0].pointInTimeEnforced,true));
