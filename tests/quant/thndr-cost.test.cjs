'use strict';const assert=require('node:assert/strict');const {perOrder,roundTrip}=require('../../scripts/quant/thndr-cost.cjs');
assert.equal(perOrder(99802).total,181.64);
assert.equal(perOrder(103061.06).total,187.51);
assert.equal(roundTrip(5000).total,23.50);
assert.equal(roundTrip(500).total,7.76);
assert.equal(Object.keys(perOrder(99802).lines).length,7);
assert(roundTrip(500).costPct>roundTrip(100000).costPct);
console.log('Thndr invoice cost regression PASS');
