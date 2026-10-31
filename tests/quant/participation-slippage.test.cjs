'use strict';const assert=require('node:assert/strict');const {estimate}=require('../../scripts/quant/participation-slippage.cjs');
const low=estimate(20000,10000000,'low'),medium=estimate(20000,10000000,'medium'),high=estimate(20000,10000000,'high');
assert(low.estimatedAllInPct<medium.estimatedAllInPct&&medium.estimatedAllInPct<high.estimatedAllInPct);
assert(estimate(100000,10000000,'medium').estimatedAllInPct>medium.estimatedAllInPct);
assert.equal(estimate(20000,0).valid,false);
assert.equal(low.calibration,'HYPOTHETICAL_NOT_OBSERVED');
console.log('Participation slippage scenarios PASS — NOT calibrated');
